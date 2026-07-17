package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	optaris "github.com/getoptaris/optaris-core"
	"github.com/getoptaris/optaris-core/usage"
)

// newTestStore stands up a Store in a throwaway data dir. The holder carries no
// secrets, which is all the summary path needs (capture redaction is unused here).
func newTestStore(t *testing.T, dataDir string) *Store {
	t.Helper()
	s, err := newStore(dataDir, newConfigHolder(configMeta{}))
	if err != nil {
		t.Fatalf("newStore: %v", err)
	}
	return s
}

// openReadDB opens the summary DB read-only for assertions after a store is closed.
func openReadDB(t *testing.T, dataDir string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "optaris.db"))
	if err != nil {
		t.Fatalf("open read db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func countRows(t *testing.T, db *sql.DB, reqID string) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM requests WHERE req_id = ?", reqID).Scan(&n); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return n
}

// baseEvent builds one lifecycle event for a request; per-phase callers tweak fields.
func baseEvent(phase optaris.Phase, reqID string, at time.Time) optaris.Event {
	return optaris.Event{
		Phase:      phase,
		At:         at,
		ReqID:      reqID,
		GroupID:    "grp_default",
		Model:      "gpt-4o",
		Stream:     true,
		ClientType: "claude_code",
		SessionID:  "sess-1",
	}
}

// TestStoreSeedsInProgressRow verifies that a request appears in the summary DB as soon
// as it is Received — outcome NULL (still in progress) and phase 'received' — which is
// what the control plane reads to show an in-flight request (issue #22).
func TestStoreSeedsInProgressRow(t *testing.T) {
	dir := t.TempDir()
	s := newTestStore(t, dir)

	at := time.UnixMilli(1_700_000_000_000)
	s.enqueue(baseEvent(optaris.PhaseReceived, "req-inflight", at))
	s.Close() // drains + flushes everything enqueued before Close

	db := openReadDB(t, dir)
	if got := countRows(t, db, "req-inflight"); got != 1 {
		t.Fatalf("row count = %d, want 1", got)
	}

	var (
		outcome sql.NullString
		phase   sql.NullString
		httpSt  sql.NullInt64
		atMs    int64
	)
	if err := db.QueryRow(
		"SELECT outcome, phase, http_status, at FROM requests WHERE req_id = ?", "req-inflight",
	).Scan(&outcome, &phase, &httpSt, &atMs); err != nil {
		t.Fatalf("select: %v", err)
	}
	if outcome.Valid {
		t.Errorf("outcome = %q, want NULL (in progress)", outcome.String)
	}
	if phase.String != "received" {
		t.Errorf("phase = %q, want received", phase.String)
	}
	if httpSt.Valid {
		t.Errorf("http_status = %d, want NULL while in progress", httpSt.Int64)
	}
	if atMs != at.UnixMilli() {
		t.Errorf("at = %d, want %d (request start time)", atMs, at.UnixMilli())
	}
}

// TestStoreFinalizesSameRow verifies the row is UPSERTed in place across the lifecycle:
// Received → AttemptStart → Completed leaves exactly one row that ends 'done'/'success'
// with the served channel, first-token latency, usage tokens, and the original start
// time (`at` is not bumped by later phases).
func TestStoreFinalizesSameRow(t *testing.T) {
	dir := t.TempDir()
	s := newTestStore(t, dir)

	start := time.UnixMilli(1_700_000_000_000)

	s.enqueue(baseEvent(optaris.PhaseReceived, "req-1", start))

	attempt := baseEvent(optaris.PhaseAttemptStart, "req-1", start.Add(10*time.Millisecond))
	attempt.ChannelID, attempt.ChannelName = "ch1", "OpenAI-A"
	s.enqueue(attempt)

	ftms := int64(120)
	ft := baseEvent(optaris.PhaseFirstToken, "req-1", start.Add(200*time.Millisecond))
	ft.ChannelID, ft.ChannelName, ft.FirstTokenMs = "ch1", "OpenAI-A", &ftms
	s.enqueue(ft)

	done := baseEvent(optaris.PhaseCompleted, "req-1", start.Add(2*time.Second))
	done.ChannelID, done.ChannelName = "ch1", "OpenAI-A"
	done.Outcome, done.HTTPStatus, done.UpstreamsTried = "success", 200, 1
	done.Usage = &usage.Normalized{InputTokens: 42, OutputTokens: 7}
	s.enqueue(done)

	s.Close()

	db := openReadDB(t, dir)
	if got := countRows(t, db, "req-1"); got != 1 {
		t.Fatalf("row count = %d, want 1 (upsert, not insert-per-phase)", got)
	}

	var (
		outcome, phase, channel string
		httpSt, inTok, outTok   int64
		firstTokenMs, upstreams int64
		atMs                    int64
	)
	if err := db.QueryRow(`
		SELECT outcome, phase, channel_name, http_status, input_tokens, output_tokens,
		       first_token_ms, upstreams_tried, at
		FROM requests WHERE req_id = ?`, "req-1",
	).Scan(&outcome, &phase, &channel, &httpSt, &inTok, &outTok, &firstTokenMs, &upstreams, &atMs); err != nil {
		t.Fatalf("select: %v", err)
	}
	if outcome != "success" {
		t.Errorf("outcome = %q, want success", outcome)
	}
	if phase != "done" {
		t.Errorf("phase = %q, want done", phase)
	}
	if channel != "OpenAI-A" {
		t.Errorf("channel_name = %q, want OpenAI-A", channel)
	}
	if httpSt != 200 || inTok != 42 || outTok != 7 || firstTokenMs != 120 || upstreams != 1 {
		t.Errorf("finalized fields wrong: http=%d in=%d out=%d ttft=%d upstreams=%d",
			httpSt, inTok, outTok, firstTokenMs, upstreams)
	}
	if atMs != start.UnixMilli() {
		t.Errorf("at = %d, want %d (start time preserved across upserts)", atMs, start.UnixMilli())
	}
}

// TestStoreSweepsOrphansOnStart verifies that an in-progress row left by a previous
// process (outcome NULL) is finalized to 'interrupted' when a fresh store opens the
// same data dir — otherwise it would show "in progress" forever.
func TestStoreSweepsOrphansOnStart(t *testing.T) {
	dir := t.TempDir()

	// First "process": receive a request, then die without finalizing it.
	s1 := newTestStore(t, dir)
	s1.enqueue(baseEvent(optaris.PhaseReceived, "req-orphan", time.UnixMilli(1_700_000_000_000)))
	s1.Close()

	// Second "process": opening the store sweeps the orphan.
	s2 := newTestStore(t, dir)
	s2.Close()

	db := openReadDB(t, dir)
	var outcome, phase sql.NullString
	if err := db.QueryRow(
		"SELECT outcome, phase FROM requests WHERE req_id = ?", "req-orphan",
	).Scan(&outcome, &phase); err != nil {
		t.Fatalf("select: %v", err)
	}
	if outcome.String != "interrupted" {
		t.Errorf("outcome = %q (valid=%v), want interrupted", outcome.String, outcome.Valid)
	}
	if phase.String != "done" {
		t.Errorf("phase = %q, want done", phase.String)
	}
}

// captureEvent builds a lifecycle event carrying a (partial) capture: the client request A
// plus one upstream attempt's B/C. Mirrors what the engine attaches on the progress and
// Completed phases when capture is on.
func captureEvent(phase optaris.Phase, reqID string, at time.Time) optaris.Event {
	ev := baseEvent(phase, reqID, at)
	ev.Capture = &optaris.CaptureData{
		ReqHeaders: http.Header{"Content-Type": {"application/json"}},
		ReqBody:    []byte(`{"model":"gpt-4o"}`),
		Attempts: []optaris.AttemptCapture{{
			ChannelID:   "ch1",
			Model:       "gpt-4o",
			UpstreamURL: "https://upstream.example/v1/chat/completions",
			ReqHeaders:  http.Header{"Content-Type": {"application/json"}},
			ReqBody:     []byte(`{"model":"gpt-4o"}`),
			RespStatus:  200,
			RespBody:    []byte(`{"ok":true}`),
		}},
	}
	return ev
}

// liveCaptureData reads the in-flight snapshot's JSON for a request, and whether a row exists.
func liveCaptureData(t *testing.T, db *sql.DB, reqID string) (string, bool) {
	t.Helper()
	var data string
	switch err := db.QueryRow("SELECT data FROM live_captures WHERE req_id = ?", reqID).Scan(&data); err {
	case nil:
		return data, true
	case sql.ErrNoRows:
		return "", false
	default:
		t.Fatalf("select live_captures: %v", err)
		return "", false
	}
}

// TestLiveCaptureWrittenWhileInProgress verifies that a request's partial capture is upserted
// into live_captures on the progress phases (so the control plane can show it step by step),
// marked partial, before any Completed event lands.
func TestLiveCaptureWrittenWhileInProgress(t *testing.T) {
	dir := t.TempDir()
	s := newTestStore(t, dir)

	at := time.UnixMilli(1_700_000_000_000)
	s.enqueue(captureEvent(optaris.PhaseReceived, "req-live", at))
	s.enqueue(captureEvent(optaris.PhaseAttemptEnd, "req-live", at.Add(time.Second)))
	s.Close()

	db := openReadDB(t, dir)
	data, ok := liveCaptureData(t, db, "req-live")
	if !ok {
		t.Fatal("live_captures row missing for an in-progress request")
	}
	var rec captureRecord
	if err := json.Unmarshal([]byte(data), &rec); err != nil {
		t.Fatalf("unmarshal live data: %v", err)
	}
	if !rec.Partial {
		t.Error("live capture Partial = false, want true")
	}
	if rec.ReqBody == "" {
		t.Error("live capture missing the client request body")
	}
	if len(rec.Attempts) != 1 {
		t.Fatalf("live capture attempts = %d, want 1", len(rec.Attempts))
	}
}

// TestLiveCaptureDeletedOnCompletion verifies the handoff: once a request completes, its
// transient live snapshot is removed (the finished capture, if any, lives in the JSONL
// archive instead) — even for a clean success, which under failed_only archives nothing.
func TestLiveCaptureDeletedOnCompletion(t *testing.T) {
	dir := t.TempDir()
	s := newTestStore(t, dir)

	at := time.UnixMilli(1_700_000_000_000)
	s.enqueue(captureEvent(optaris.PhaseReceived, "req-done", at))
	done := captureEvent(optaris.PhaseCompleted, "req-done", at.Add(time.Second))
	done.Outcome, done.HTTPStatus = "success", 200
	s.enqueue(done)
	s.Close()

	db := openReadDB(t, dir)
	if _, ok := liveCaptureData(t, db, "req-done"); ok {
		t.Error("live_captures row should be deleted once the request completes")
	}
}

// TestLiveCaptureClearedOnStart verifies that a live snapshot left behind by a process that
// died mid-request (never completing) is dropped when a fresh store opens the same data dir,
// mirroring the summary-row orphan sweep.
func TestLiveCaptureClearedOnStart(t *testing.T) {
	dir := t.TempDir()

	// First "process": a request is received and captured, then the process dies in flight.
	s1 := newTestStore(t, dir)
	s1.enqueue(captureEvent(optaris.PhaseReceived, "req-stale", time.UnixMilli(1_700_000_000_000)))
	s1.Close()

	db1 := openReadDB(t, dir)
	if _, ok := liveCaptureData(t, db1, "req-stale"); !ok {
		t.Fatal("expected a stale live_captures row after the first process")
	}

	// Second "process": opening the store clears the stale snapshot at startup.
	s2 := newTestStore(t, dir)
	s2.Close()

	db2 := openReadDB(t, dir)
	if _, ok := liveCaptureData(t, db2, "req-stale"); ok {
		t.Error("startup should clear stale live_captures rows")
	}
}
