// Command optaris-gateway is the local sidecar gateway for the Optaris desktop
// app. It embeds the optaris-core routing engine, mounts the four inbound-format
// HTTP handlers, and forwards LLM traffic to upstream channels. The Electron main
// process spawns and supervises this binary; clients point their base_url at it.
//
// Phase 2 scope: load the channels/groups/settings config the parent writes to
// --config (hot-reloaded on change), route each request to the config-provided
// default group, and persist request events to --data-dir (SQLite summaries +
// JSONL raw capture, see store.go). The stdout readiness handshake and parent
// watchdog from phase 1 are unchanged.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	optaris "github.com/getoptaris/optaris-core"
	"github.com/getoptaris/optaris-core/settings"
)

const defaultPort = 8788

func main() {
	// All human-readable logs go to stderr. stdout is reserved exclusively for the
	// structured handshake line(s) the parent process parses.
	log.SetOutput(os.Stderr)
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[gateway] ")

	// Flag defaults: env OPTARIS_GATEWAY_PORT overrides the built-in default; an
	// explicit --port flag overrides the env.
	envPort := defaultPort
	if v := os.Getenv("OPTARIS_GATEWAY_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			envPort = p
		} else {
			log.Printf("ignoring invalid OPTARIS_GATEWAY_PORT=%q: %v", v, err)
		}
	}

	host := flag.String("host", "127.0.0.1", "host/interface to listen on")
	port := flag.Int("port", envPort, "TCP port to listen on (0 = OS-assigned)")
	parentPID := flag.Int("parent-pid", 0, "parent process id; gateway self-exits if it disappears (0 = disabled)")
	configPath := flag.String("config", "", "path to the JSON config file (channels/groups/settings); hot-reloaded on change")
	dataDir := flag.String("data-dir", "", "directory for the event store (optaris.db + capture/); empty disables persistence")
	flag.Parse()

	// Build the engine from the parent-provided config. A missing/unparsable config
	// degrades to empty channels/groups with default settings so the sidecar still
	// boots and reports ready (requests will then route to no group and be rejected,
	// which is the fail-loud behavior we want).
	cfg, meta := loadInitialConfig(*configPath)
	eng := optaris.New(cfg)
	holder := newConfigHolder(meta)

	// Persistence: with a data-dir we stand up the SQLite + JSONL pipeline; without
	// one we just surface completed-request summaries on stderr.
	var store *Store
	if *dataDir != "" {
		st, err := newStore(*dataDir, holder)
		if err != nil {
			log.Printf("persistence disabled: %v", err)
		} else {
			store = st
			log.Printf("persistence enabled: data-dir=%s", *dataDir)
		}
	} else {
		log.Printf("no --data-dir provided; persistence disabled")
	}

	// OnEvent runs synchronously in the request goroutine: it must not block. With a
	// store it only enqueues; without one it logs the completed-request summary.
	eng.OnEvent(func(ev optaris.Event) {
		if store != nil {
			store.enqueue(ev)
			return
		}
		if ev.Phase == optaris.PhaseCompleted {
			logCompleted(ev)
		}
	})

	// Route every request to the config-provided default group. The middleware reads
	// the group id from the holder on each request so hot-reload takes effect live.
	mux := http.NewServeMux()
	mux.Handle("POST /v1/chat/completions", withRoute(holder, eng.OpenAIChatHandler()))
	mux.Handle("POST /v1/responses", withRoute(holder, eng.OpenAIResponsesHandler()))
	mux.Handle("POST /v1/messages", withRoute(holder, eng.ClaudeHandler()))
	mux.Handle("POST /v1beta/models/{modelAndMethod}", withRoute(holder, eng.GeminiHandler()))
	// Read-only listing of the active group's servable models. No withRoute: it reads config
	// directly and never runs the serve/failover pipeline. Auth is inherited from withAuth.
	mux.Handle("GET /v1/models", modelsHandler(eng, holder))

	// Bind first so we can report the actually-bound port (supports --port 0).
	addr := net.JoinHostPort(*host, strconv.Itoa(*port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v", addr, err)
	}
	boundPort := ln.Addr().(*net.TCPAddr).Port

	// Handshake: a single JSON line on stdout tells the parent we are ready and on
	// which port. Keep stdout free of anything else.
	emitReady(*host, boundPort)
	log.Printf("listening on %s:%d (pid=%d)", *host, boundPort, os.Getpid())

	srv := &http.Server{Handler: withAuth(holder, mux)}

	// Shutdown is triggered by SIGINT/SIGTERM or by the parent-watchdog. Calling the
	// stop func returned by NotifyContext also cancels ctx.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if *parentPID > 0 {
		go watchParent(ctx, *parentPID, stop)
	}

	// Hot-reload the config on file change (mtime polling). Stops when ctx is done.
	if *configPath != "" {
		go holder.watch(ctx, *configPath, eng, fileModTime(*configPath))
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("graceful shutdown error: %v", err)
		}
	}()

	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}

	// Serve has returned: all in-flight requests are done, so no more OnEvent
	// callbacks can fire. Now it is safe to drain and close the store.
	if store != nil {
		store.Close()
	}
	log.Printf("gateway stopped")
}

// loadInitialConfig loads the startup config, degrading to an empty config with
// default settings on any error (missing path, unreadable/unparsable file).
func loadInitialConfig(path string) (optaris.Config, configMeta) {
	if path == "" {
		log.Printf("no --config provided; starting with empty config (default settings)")
		return optaris.Config{Settings: settings.Default()}, configMeta{}
	}
	cfg, meta, err := loadConfig(path)
	if err != nil {
		log.Printf("failed to load config %q, starting with empty config: %v", path, err)
		return optaris.Config{Settings: settings.Default()}, configMeta{}
	}
	log.Printf("loaded config: channels=%d groups=%d default_group=%q",
		len(cfg.Channels), len(cfg.Groups), meta.defaultGroupID)
	return cfg, meta
}

// withRoute injects the optaris routing context (default group id) for every
// request. WithRoute is a context helper, not an http wrapper, so we set it on the
// request context before delegating to the engine handler. The group id is read per
// request from the holder so config hot-reload takes effect without re-mounting.
func withRoute(holder *configHolder, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rc := optaris.RouteContext{GroupID: holder.defaultGroupID()}
		next.ServeHTTP(w, r.WithContext(optaris.WithRoute(r.Context(), rc)))
	})
}

// withAuth gates every inbound request on the single client-facing API key from the
// config. The key is read per request from the holder so hot-reload (and the
// dashboard's regenerate button) take effect live. An empty configured key disables
// the check — the gateway is open, matching the pre-auth behavior.
//
// This is the gateway's trust boundary against other local processes blindly probing
// 127.0.0.1: it only verifies, it does not mutate the request. The engine sets its
// own upstream credentials downstream, so the presented client key is never forwarded.
func withAuth(holder *configHolder, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		want := holder.apiKey()
		if want == "" {
			next.ServeHTTP(w, r)
			return
		}
		got := presentedKey(r)
		// Constant-time compare to avoid leaking the key via timing.
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			writeUnauthorized(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// presentedKey extracts the client-supplied key, covering the conventions of all four
// inbound formats: OpenAI/Claude `Authorization: Bearer <k>`, Anthropic `x-api-key`,
// Gemini `x-goog-api-key` header or `?key=<k>` query. The first non-empty one wins.
func presentedKey(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		if rest, ok := strings.CutPrefix(h, "Bearer "); ok {
			if k := strings.TrimSpace(rest); k != "" {
				return k
			}
		}
	}
	if k := strings.TrimSpace(r.Header.Get("x-api-key")); k != "" {
		return k
	}
	if k := strings.TrimSpace(r.Header.Get("x-goog-api-key")); k != "" {
		return k
	}
	if k := strings.TrimSpace(r.URL.Query().Get("key")); k != "" {
		return k
	}
	return ""
}

// writeUnauthorized replies with a 401 and a small OpenAI-shaped error body so clients
// surface a readable message.
func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":{"message":"invalid api key","type":"unauthorized"}}`))
}

// emitReady writes the readiness handshake as a single JSON line to stdout.
func emitReady(host string, port int) {
	payload := struct {
		Event string `json:"event"`
		Host  string `json:"host"`
		Port  int    `json:"port"`
		PID   int    `json:"pid"`
	}{Event: "ready", Host: host, Port: port, PID: os.Getpid()}

	b, err := json.Marshal(payload)
	if err != nil {
		// Should never happen for this fixed struct.
		log.Printf("failed to marshal ready payload: %v", err)
		return
	}
	fmt.Fprintln(os.Stdout, string(b))
}

// watchParent polls the parent process id and triggers shutdown if it changes,
// which happens when the parent (Electron) dies and this process is reparented.
// This guards against orphaned/zombie gateways if the parent crashes. Using
// Getppid keeps this portable and free of false positives across platforms.
func watchParent(ctx context.Context, parentPID int, shutdown func()) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if pp := os.Getppid(); pp != parentPID {
				log.Printf("parent process changed (%d -> %d), shutting down", parentPID, pp)
				shutdown()
				return
			}
		}
	}
}
