package main

// Event persistence. The engine surfaces one Event per request stage synchronously
// on the request goroutine, so the OnEvent hook (enqueue) must never block: it only
// pushes PhaseCompleted events into a buffered channel and returns, dropping (and
// counting) when the buffer is full — logs are sacrificed before requests are ever
// slowed. A single background goroutine drains the channel and does the slow work:
//
//   - summaries → SQLite (data-dir/optaris.db), one row per completed request,
//     written in batched transactions by a single writer connection;
//   - raw payloads → JSONL (data-dir/capture/YYYY-MM-DD.jsonl), day-rolling, only
//     when the engine attached Capture to the event.
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
    at                    INTEGER, -- unix milliseconds
    group_id              TEXT,
    model                 TEXT,
    stream                INTEGER, -- 0/1
    channel_id            TEXT,
    channel_name          TEXT,
    outcome               TEXT,    -- success / failed / client_canceled / rejected
    http_status           INTEGER,
    fail_class            TEXT,
    first_token_ms        INTEGER,
    input_tokens          INTEGER,
    cache_read_tokens     INTEGER,
    cache_write_5m_tokens INTEGER,
    cache_write_1h_tokens INTEGER,
    output_tokens         INTEGER,
    reasoning_tokens      INTEGER
);`

func initSchema(db *sql.DB) error {
	if _, err := db.Exec(createRequestsTable); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	return nil
}

// enqueue is the OnEvent callback body. It runs synchronously in the request
// goroutine, so it must not block: it filters to the one phase we persist and hands
// the event off through the buffered channel, dropping and counting on overflow.
func (s *Store) enqueue(ev optaris.Event) {
	if ev.Phase != optaris.PhaseCompleted {
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
		logCompleted(ev)
		if ev.Capture != nil {
			s.writeCapture(ev)
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

const insertRequest = `
INSERT OR IGNORE INTO requests (
    req_id, at, group_id, model, stream,
    channel_id, channel_name, outcome, http_status, fail_class,
    first_token_ms,
    input_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
    output_tokens, reasoning_tokens
) VALUES (?,?,?,?,?, ?,?,?,?,?, ?, ?,?,?,?, ?,?);`

// writeSummaries inserts a batch of completed-request rows in one transaction.
// Persistence is best-effort: any DB error is logged and the batch is dropped
// rather than crashing the gateway.
func (s *Store) writeSummaries(batch []optaris.Event) {
	ctx, cancel := context.WithTimeout(context.Background(), dbWriteTimeout)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("summary tx begin failed, dropping %d row(s): %v", len(batch), err)
		return
	}
	stmt, err := tx.PrepareContext(ctx, insertRequest)
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
			r.firstTokenMs,
			r.inputTokens, r.cacheReadTokens, r.cacheWrite5m, r.cacheWrite1h,
			r.outputTokens, r.reasoningTokens,
		); err != nil {
			log.Printf("summary insert failed req_id=%s: %v", r.reqID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("summary commit failed, %d row(s) lost: %v", len(batch), err)
	}
}

// reqRow is the DB row for one request. The nullable columns use `any`: a nil value
// binds as SQL NULL, so Usage columns stay NULL on non-success and first_token_ms
// stays NULL when the engine never reported one.
type reqRow struct {
	reqID       string
	at          int64
	groupID     string
	model       string
	stream      int
	channelID   string
	channelName string
	outcome     string
	httpStatus  int
	failClass   string

	firstTokenMs any

	inputTokens     any
	cacheReadTokens any
	cacheWrite5m    any
	cacheWrite1h    any
	outputTokens    any
	reasoningTokens any
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
		outcome:     ev.Outcome,
		httpStatus:  ev.HTTPStatus,
		failClass:   ev.FailClass,
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
