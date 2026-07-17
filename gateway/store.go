package main

// Event persistence. The engine surfaces one Event per request stage synchronously
// on the request goroutine, so the OnEvent hook (enqueue) must never block: it only
// pushes the persisted lifecycle phases into a buffered channel and returns, dropping
// (and counting) when the buffer is full — logs are sacrificed before requests are
// ever slowed. A single background goroutine drains the channel and does the slow work:
//
//   - summaries → SQLite (data-dir/optaris.db), one row per request keyed on req_id
//     and UPSERTed across its lifecycle (Received seeds it with outcome NULL = "in
//     progress"; later phases advance it; Completed finalizes it), written in batched
//     transactions by a single writer connection;
//   - raw payloads → JSONL (data-dir/capture/YYYY-MM-DD.jsonl), day-rolling, only
//     when the engine attached Capture to the (Completed) event.
//
// SQLite is the pure-Go modernc.org/sqlite driver (registered as "sqlite") so the
// binary stays CGO_ENABLED=0 static. APIKeys and request/response bodies never
// enter the summary DB; capture bodies are plaintext by design but run through a
// final APIKey-redaction guard before hitting disk.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	optaris "github.com/getoptaris/optaris-core"

	_ "modernc.org/sqlite" // registers the pure-Go "sqlite" database/sql driver
)

const (
	// eventBufferSize bounds the non-blocking hand-off between request goroutines
	// and the persistence goroutine. Overflow drops the event (counted), never
	// blocks the request.
	eventBufferSize = 1024

	// SQLite summaries are flushed either when the batch reaches sqlBatchMax or when
	// sqlFlushEvery elapses, whichever comes first.
	sqlBatchMax   = 64
	sqlFlushEvery = 250 * time.Millisecond

	// dbWriteTimeout bounds a single batch transaction.
	dbWriteTimeout = 10 * time.Second

	// secretRedactMin skips redacting suspiciously short "keys" so we never nuke
	// common short substrings that merely coincide with a (mis)configured key.
	secretRedactMin = 8
	redactedMarker  = "***REDACTED***"
)

// Store owns the persistence pipeline: the buffered channel, the SQLite handle, and
// the day-rolling capture writer. Its exported surface is enqueue (hot path) and
// Close (shutdown).
type Store struct {
	holder *configHolder // read at flush time for the APIKey redaction list

	db *sql.DB

	ch      chan optaris.Event
	dropped atomic.Int64

	// Capture-writer state — only ever touched by the single consumer goroutine, so
	// it needs no locking.
	capDir  string
	capFile *os.File
	capDay  string

	wg        sync.WaitGroup
	closed    chan struct{}
	closeOnce sync.Once
}

// newStore prepares data-dir, opens the DB (WAL + busy_timeout), creates the schema,
// and starts the background consumer goroutine.
func newStore(dataDir string, holder *configHolder) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dbPath := filepath.Join(dataDir, "optaris.db")
	db, err := openDB(dbPath)
	if err != nil {
		return nil, err
	}
	if err := initSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	s := &Store{
		holder: holder,
		db:     db,
		ch:     make(chan optaris.Event, eventBufferSize),
		capDir: filepath.Join(dataDir, "capture"),
		closed: make(chan struct{}),
	}
	s.wg.Add(1)
	go s.run()
	return s, nil
}

// openDB opens the summary database with a single writer connection and WAL so that
// future readers (the control plane) never block the writer.
func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// One connection: no SQLITE_BUSY between our own goroutines, and the
	// per-connection PRAGMAs below stick for the process lifetime.
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",   // readers don't block the writer and vice versa
		"PRAGMA busy_timeout=5000",  // wait up to 5s on a lock instead of erroring
		"PRAGMA synchronous=NORMAL", // safe under WAL, much faster than FULL
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("apply %q: %w", pragma, err)
		}
	}
	// The summary DB holds no secrets, but keep it owner-only for tidiness.
	_ = os.Chmod(path, 0o600)
	return db, nil
}

const createRequestsTable = `
CREATE TABLE IF NOT EXISTS requests (
    req_id                TEXT PRIMARY KEY,
    at                    INTEGER, -- unix milliseconds (request start, seeded on the first event)
    group_id              TEXT,
    model                 TEXT,
    stream                INTEGER, -- 0/1
    channel_id            TEXT,
    channel_name          TEXT,
    outcome               TEXT,    -- success / failed / client_canceled / rejected / interrupted; NULL = still in progress
    http_status           INTEGER,
    fail_class            TEXT,
    phase                 TEXT,    -- lifecycle stage: received / connecting / streaming / failover / done
    first_token_ms        INTEGER,
    input_tokens          INTEGER,
    cache_read_tokens     INTEGER,
    cache_write_5m_tokens INTEGER,
    cache_write_1h_tokens INTEGER,
    output_tokens         INTEGER,
    reasoning_tokens      INTEGER,
    client_type           TEXT,    -- claude_code / claude_desktop / codex / "" (unknown)
    session_id            TEXT,
    upstreams_tried       INTEGER  -- distinct upstream channels attempted
);`

func initSchema(db *sql.DB) error {
	if _, err := db.Exec(createRequestsTable); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	if err := migrateRequests(db); err != nil {
		return err
	}
	return sweepOrphans(db)
}

// sweepOrphans finalizes rows left "in progress" (outcome NULL) by a previous process.
// A fresh process means any request that was in flight last time is now dead — the
// gateway crashed or was killed before its Completed event landed, or that event was
// dropped on buffer overflow — so those rows would otherwise show "in progress"
// forever. We mark them interrupted here, once, at startup (before the consumer
// goroutine begins writing new rows).
func sweepOrphans(db *sql.DB) error {
	if _, err := db.Exec("UPDATE requests SET outcome = 'interrupted', phase = 'done' WHERE outcome IS NULL"); err != nil {
		return fmt.Errorf("sweep interrupted requests: %w", err)
	}
	return nil
}

// migrateRequests adds columns introduced after the initial schema to a pre-existing database:
// createRequestsTable uses CREATE TABLE IF NOT EXISTS, which never alters an already-created table,
// so upgraded installs need an explicit ALTER TABLE for each newer column. Existing rows get NULL
// for the new columns; new requests populate them normally.
func migrateRequests(db *sql.DB) error {
	have, err := existingColumns(db, "requests")
	if err != nil {
		return fmt.Errorf("inspect requests schema: %w", err)
	}
	// Columns added after the original schema, in the order they were introduced.
	for _, c := range []struct{ name, ddl string }{
		{"client_type", "TEXT"},
		{"session_id", "TEXT"},
		{"upstreams_tried", "INTEGER"},
		{"phase", "TEXT"},
	} {
		if _, ok := have[c.name]; ok {
			continue
		}
		if _, err := db.Exec("ALTER TABLE requests ADD COLUMN " + c.name + " " + c.ddl); err != nil {
			return fmt.Errorf("add column %s: %w", c.name, err)
		}
	}
	return nil
}

// existingColumns returns the set of column names on a table via PRAGMA table_info.
func existingColumns(db *sql.DB, table string) (map[string]struct{}, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := map[string]struct{}{}
	for rows.Next() {
		var (
			cid, notnull, pk int
			name, ctype      string
			dflt             any
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols[name] = struct{}{}
	}
	return cols, rows.Err()
}

// persistedPhase reports whether an event's phase produces a summary-row write. We
// persist every progress milestone so the control plane can show an in-flight request
// live (issue #22): Received seeds the row (outcome NULL = "in progress"), the middle
// phases advance its `phase` column, and Completed finalizes it. AttemptEnd is skipped
// — it carries nothing the surrounding AttemptStart/Committed/Completed don't already,
// so persisting it would just be a redundant UPSERT.
func persistedPhase(p optaris.Phase) bool {
	switch p {
	case optaris.PhaseReceived,
		optaris.PhaseAttemptStart,
		optaris.PhaseFirstToken,
		optaris.PhaseCommitted,
		optaris.PhaseFailover,
		optaris.PhaseCompleted:
		return true
	default:
		return false
	}
}

// enqueue is the OnEvent callback body. It runs synchronously in the request
// goroutine, so it must not block: it filters to the phases we persist and hands the
// event off through the buffered channel, dropping and counting on overflow.
func (s *Store) enqueue(ev optaris.Event) {
	if !persistedPhase(ev.Phase) {
		return
	}
	select {
	case s.ch <- ev:
	default:
		s.dropped.Add(1)
	}
}

// run is the single consumer goroutine: it batches summaries, appends captures, and
// drains cleanly on Close.
func (s *Store) run() {
	defer s.wg.Done()

	batch := make([]optaris.Event, 0, sqlBatchMax)
	ticker := time.NewTicker(sqlFlushEvery)
	defer ticker.Stop()

	var lastDropReport int64
	flush := func() {
		if len(batch) > 0 {
			s.writeSummaries(batch)
			batch = batch[:0]
		}
		if d := s.dropped.Load(); d != lastDropReport {
			log.Printf("event pipeline dropped %d event(s) total (buffer full)", d)
			lastDropReport = d
		}
	}

	consume := func(ev optaris.Event) {
		// Progress events (Received … Failover) only advance the summary row; the
		// stderr line and the raw capture belong to the terminal Completed event.
		if ev.Phase == optaris.PhaseCompleted {
			logCompleted(ev)
			if ev.Capture != nil {
				s.writeCapture(ev)
			}
		}
		batch = append(batch, ev)
		if len(batch) >= sqlBatchMax {
			flush()
		}
	}

	for {
		select {
		case <-s.closed:
			// Drain whatever is still buffered, then flush and exit.
			for {
				select {
				case ev := <-s.ch:
					consume(ev)
				default:
					flush()
					return
				}
			}
		case ev := <-s.ch:
			consume(ev)
		case <-ticker.C:
			flush()
		}
	}
}

// upsertRequest writes (or advances) one request's summary row. A request is written
// several times across its lifecycle — once per persisted phase — keyed on req_id, so
// the first event (Received) inserts the row and later phases UPDATE it in place:
//
//   - at:           kept from the first write (request start time), so elapsed = now-at.
//   - phase:        always advanced to the latest stage.
//   - channel_*:    only overwritten by a non-empty value, so Received's empty channel
//     can't wipe a chosen upstream and failover's new channel still wins.
//   - outcome, http_status, fail_class, upstreams_tried, usage tokens, first_token_ms:
//     COALESCE(new, existing) — these are meaningful only at the terminal
//     (or first-token) phase, so progress events bind NULL and leave the
//     stored value untouched. outcome therefore stays NULL until Completed,
//     which is exactly the "in progress" signal the control plane reads.
//   - group_id, model, stream, client_type, session_id: same value every phase; a plain
//     overwrite is harmless and keeps the statement simple.
const upsertRequest = `
INSERT INTO requests (
    req_id, at, group_id, model, stream,
    channel_id, channel_name, outcome, http_status, fail_class,
    phase, first_token_ms,
    input_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
    output_tokens, reasoning_tokens,
    client_type, session_id, upstreams_tried
) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?,?, ?,?,?)
ON CONFLICT(req_id) DO UPDATE SET
    group_id              = excluded.group_id,
    model                 = excluded.model,
    stream                = excluded.stream,
    channel_id            = CASE WHEN excluded.channel_id   <> '' THEN excluded.channel_id   ELSE requests.channel_id   END,
    channel_name          = CASE WHEN excluded.channel_name <> '' THEN excluded.channel_name ELSE requests.channel_name END,
    outcome               = COALESCE(excluded.outcome, requests.outcome),
    http_status           = COALESCE(excluded.http_status, requests.http_status),
    fail_class            = COALESCE(excluded.fail_class, requests.fail_class),
    phase                 = excluded.phase,
    first_token_ms        = COALESCE(excluded.first_token_ms, requests.first_token_ms),
    input_tokens          = COALESCE(excluded.input_tokens, requests.input_tokens),
    cache_read_tokens     = COALESCE(excluded.cache_read_tokens, requests.cache_read_tokens),
    cache_write_5m_tokens = COALESCE(excluded.cache_write_5m_tokens, requests.cache_write_5m_tokens),
    cache_write_1h_tokens = COALESCE(excluded.cache_write_1h_tokens, requests.cache_write_1h_tokens),
    output_tokens         = COALESCE(excluded.output_tokens, requests.output_tokens),
    reasoning_tokens      = COALESCE(excluded.reasoning_tokens, requests.reasoning_tokens),
    client_type           = excluded.client_type,
    session_id            = excluded.session_id,
    upstreams_tried       = COALESCE(excluded.upstreams_tried, requests.upstreams_tried);`

// writeSummaries upserts a batch of request rows in one transaction. Persistence is
// best-effort: any DB error is logged and the batch is dropped rather than crashing
// the gateway.
func (s *Store) writeSummaries(batch []optaris.Event) {
	ctx, cancel := context.WithTimeout(context.Background(), dbWriteTimeout)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("summary tx begin failed, dropping %d row(s): %v", len(batch), err)
		return
	}
	stmt, err := tx.PrepareContext(ctx, upsertRequest)
	if err != nil {
		log.Printf("summary prepare failed, dropping %d row(s): %v", len(batch), err)
		_ = tx.Rollback()
		return
	}
	defer stmt.Close()

	for i := range batch {
		r := summaryRow(&batch[i])
		if _, err := stmt.ExecContext(ctx,
			r.reqID, r.at, r.groupID, r.model, r.stream,
			r.channelID, r.channelName, r.outcome, r.httpStatus, r.failClass,
			r.phase, r.firstTokenMs,
			r.inputTokens, r.cacheReadTokens, r.cacheWrite5m, r.cacheWrite1h,
			r.outputTokens, r.reasoningTokens,
			r.clientType, r.sessionID, r.upstreamsTried,
		); err != nil {
			log.Printf("summary upsert failed req_id=%s: %v", r.reqID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("summary commit failed, %d row(s) lost: %v", len(batch), err)
	}
}

// reqRow is the DB row for one request. The nullable columns use `any`: a nil value
// binds as SQL NULL. Beyond the Usage columns (NULL until a successful Completed), the
// terminal-only fields — outcome, httpStatus, upstreamsTried — also bind nil on the
// progress phases so the UPSERT's COALESCE preserves the not-yet-known value and
// outcome stays NULL (= "in progress") until Completed lands.
type reqRow struct {
	reqID       string
	at          int64
	groupID     string
	model       string
	stream      int
	channelID   string
	channelName string
	outcome     any
	httpStatus  any
	failClass   string
	phase       string

	firstTokenMs any

	inputTokens     any
	cacheReadTokens any
	cacheWrite5m    any
	cacheWrite1h    any
	outputTokens    any
	reasoningTokens any

	clientType     string
	sessionID      string
	upstreamsTried any
}

// phaseString maps a lifecycle Phase to the short label stored in the `phase` column
// and read by the control plane to show where an in-flight request currently is.
func phaseString(p optaris.Phase) string {
	switch p {
	case optaris.PhaseReceived:
		return "received"
	case optaris.PhaseAttemptStart:
		return "connecting"
	case optaris.PhaseFirstToken, optaris.PhaseCommitted:
		return "streaming"
	case optaris.PhaseFailover:
		return "failover"
	case optaris.PhaseCompleted:
		return "done"
	default:
		return ""
	}
}

// summaryRow projects an Event onto the requests row. It reads only scalar summary
// fields — never Channel.APIKey, never request/response bodies.
func summaryRow(ev *optaris.Event) reqRow {
	r := reqRow{
		reqID:       ev.ReqID,
		at:          ev.At.UnixMilli(),
		groupID:     ev.GroupID,
		model:       ev.Model,
		stream:      boolToInt(ev.Stream),
		channelID:   ev.ChannelID,
		channelName: ev.ChannelName,
		failClass:   ev.FailClass,
		phase:       phaseString(ev.Phase),
		clientType:  ev.ClientType,
		sessionID:   ev.SessionID,
	}
	// Terminal-only fields: set them only on Completed, so a progress event binds NULL
	// and the COALESCE upsert keeps outcome/status NULL until the request truly ends.
	if ev.Phase == optaris.PhaseCompleted {
		r.outcome = ev.Outcome
		r.httpStatus = ev.HTTPStatus
		r.upstreamsTried = ev.UpstreamsTried
	}
	if ev.FirstTokenMs != nil {
		r.firstTokenMs = *ev.FirstTokenMs
	}
	// Usage is non-nil only on success (see optaris-core); on any other outcome the
	// token columns remain NULL.
	if u := ev.Usage; u != nil {
		r.inputTokens = u.InputTokens
		r.cacheReadTokens = u.CacheReadTokens
		r.cacheWrite5m = u.CacheWrite5mTokens
		r.cacheWrite1h = u.CacheWrite1hTokens
		r.outputTokens = u.OutputTokens
		r.reasoningTokens = u.ReasoningTokens
	}
	return r
}

// captureRecord is one JSONL line: request identity plus the full-chain raw
// payload. Bodies render as strings (readable JSON) rather than base64. It carries
// NO channel APIKey field by construction — the engine already redacts auth
// material, and redactSecrets is the final guard.
type captureRecord struct {
	ReqID      string `json:"req_id"`
	At         int64  `json:"at"`
	GroupID    string `json:"group_id"`
	Model      string `json:"model"`
	Stream     bool   `json:"stream"`
	Outcome    string `json:"outcome"`
	HTTPStatus int    `json:"http_status"`

	ReqHeaders http.Header `json:"req_headers"`
	ReqBody    string      `json:"req_body"`

	Attempts []attemptRecord `json:"attempts"`

	StrippedUsage       bool `json:"stripped_usage"`
	CommittedThenFailed bool `json:"committed_then_failed"`
}

type attemptRecord struct {
	ChannelID   string `json:"channel_id"`
	Model       string `json:"model"`
	UpstreamURL string `json:"upstream_url"`

	ReqHeaders http.Header `json:"req_headers"`
	ReqBody    string      `json:"req_body"`

	RespStatus        int         `json:"resp_status"`
	RespHeaders       http.Header `json:"resp_headers"`
	RespBody          string      `json:"resp_body"`
	RespBodyTruncated bool        `json:"resp_body_truncated"`

	Success      bool   `json:"success"`
	FailureClass string `json:"failure_class"`
	PassedCommit bool   `json:"passed_commit"`
}

// writeCapture appends one capture line to today's JSONL file. Called only when
// ev.Capture != nil (the engine decides that from CaptureEnabled + CaptureMode).
func (s *Store) writeCapture(ev optaris.Event) {
	capt := ev.Capture
	rec := captureRecord{
		ReqID:               ev.ReqID,
		At:                  ev.At.UnixMilli(),
		GroupID:             ev.GroupID,
		Model:               ev.Model,
		Stream:              ev.Stream,
		Outcome:             ev.Outcome,
		HTTPStatus:          ev.HTTPStatus,
		ReqHeaders:          capt.ReqHeaders,
		ReqBody:             string(capt.ReqBody),
		StrippedUsage:       capt.StrippedUsage,
		CommittedThenFailed: capt.CommittedThenFailed,
	}
	for i := range capt.Attempts {
		a := &capt.Attempts[i]
		rec.Attempts = append(rec.Attempts, attemptRecord{
			ChannelID:         a.ChannelID,
			Model:             a.Model,
			UpstreamURL:       a.UpstreamURL,
			ReqHeaders:        a.ReqHeaders,
			ReqBody:           string(a.ReqBody),
			RespStatus:        a.RespStatus,
			RespHeaders:       a.RespHeaders,
			RespBody:          string(a.RespBody),
			RespBodyTruncated: a.RespBodyTruncated,
			Success:           a.Success,
			FailureClass:      a.FailureClass,
			PassedCommit:      a.PassedCommit,
		})
	}

	line, err := json.Marshal(&rec)
	if err != nil {
		log.Printf("capture marshal failed req_id=%s: %v", ev.ReqID, err)
		return
	}
	// Final defense: never let a plaintext upstream APIKey reach disk, even if a
	// future core change stopped redacting it somewhere upstream of us.
	line = redactSecrets(line, s.holder.secrets())

	f, err := s.captureFileFor(ev.At)
	if err != nil {
		log.Printf("capture open failed: %v", err)
		return
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		log.Printf("capture write failed req_id=%s: %v", ev.ReqID, err)
	}
}

// captureFileFor returns today's append-only JSONL handle, rolling to a new file
// when the day changes. The handle is cached between calls on the same day.
func (s *Store) captureFileFor(at time.Time) (*os.File, error) {
	day := at.Format("2006-01-02")
	if s.capFile != nil && s.capDay == day {
		return s.capFile, nil
	}
	if s.capFile != nil {
		_ = s.capFile.Close()
		s.capFile = nil
	}
	if err := os.MkdirAll(s.capDir, 0o700); err != nil {
		return nil, fmt.Errorf("create capture dir: %w", err)
	}
	path := filepath.Join(s.capDir, day+".jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	s.capFile = f
	s.capDay = day
	return f, nil
}

// redactSecrets replaces any occurrence of a known plaintext APIKey in b with a
// marker. Defensive backstop only: the engine already strips auth material from
// capture. Keys shorter than secretRedactMin are skipped.
func redactSecrets(b []byte, secrets []string) []byte {
	for _, secret := range secrets {
		if len(secret) < secretRedactMin {
			continue
		}
		sb := []byte(secret)
		if bytes.Contains(b, sb) {
			b = bytes.ReplaceAll(b, sb, []byte(redactedMarker))
		}
	}
	return b
}

// Close stops accepting events, drains and flushes the buffer, then releases the DB
// and capture file. Idempotent.
func (s *Store) Close() {
	s.closeOnce.Do(func() {
		close(s.closed)
		s.wg.Wait()
		if s.capFile != nil {
			_ = s.capFile.Close()
		}
		if err := s.db.Close(); err != nil {
			log.Printf("db close error: %v", err)
		}
		if d := s.dropped.Load(); d > 0 {
			log.Printf("event pipeline dropped %d event(s) total over the session", d)
		}
	})
}

// logCompleted writes a one-line stderr summary for a completed request. It never
// includes APIKeys or bodies. Called from the consumer goroutine (off the request
// hot path).
func logCompleted(ev optaris.Event) {
	log.Printf("request completed req_id=%s outcome=%s status=%d model=%q group=%s channel=%s",
		ev.ReqID, ev.Outcome, ev.HTTPStatus, ev.Model, ev.GroupID, ev.ChannelID)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
