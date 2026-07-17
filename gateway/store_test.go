package main

import (
	"database/sql"
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
