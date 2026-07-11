// Command optaris-gateway is the local sidecar gateway for the Optaris desktop
// app. It embeds the optaris-core routing engine, mounts the four inbound-format
// HTTP handlers, and forwards LLM traffic to upstream channels. The Electron main
// process spawns and supervises this binary; clients point their base_url at it.
//
// Phase 1 scope: prove the sidecar boots, mounts the engine handlers, and reports
// its listening port back to the parent via a single stdout handshake line.
// Config loading and event persistence (SQLite summaries + JSONL capture) arrive
// in later phases.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
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
	flag.Parse()

	// Build the engine. Phase 1 uses an empty config (no channels/groups) with
	// default settings; this is enough to construct the engine, mount handlers, and
	// verify the optaris-core import links. Requests will resolve to "rejected"
	// because the injected group does not exist yet — that is expected until config
	// delivery lands.
	eng := optaris.New(optaris.Config{Settings: settings.Default()})

	// One summary line per request. Never log Channel.APIKey or captured bodies.
	eng.OnEvent(func(ev optaris.Event) {
		if ev.Phase != optaris.PhaseCompleted {
			return
		}
		log.Printf("request completed req_id=%s outcome=%s status=%d model=%q group=%s",
			ev.ReqID, ev.Outcome, ev.HTTPStatus, ev.Model, ev.GroupID)
	})

	// Phase 1 injects a fixed placeholder group. Real per-request routing context
	// (group resolved from auth/config) arrives with the control plane.
	const placeholderGroup = "grp_default"
	mux := http.NewServeMux()
	mux.Handle("POST /v1/chat/completions", withRoute(placeholderGroup, eng.OpenAIChatHandler()))
	mux.Handle("POST /v1/responses", withRoute(placeholderGroup, eng.OpenAIResponsesHandler()))
	mux.Handle("POST /v1/messages", withRoute(placeholderGroup, eng.ClaudeHandler()))
	mux.Handle("POST /v1beta/models/{modelAndMethod}", withRoute(placeholderGroup, eng.GeminiHandler()))

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

	srv := &http.Server{Handler: mux}

	// Shutdown is triggered by SIGINT/SIGTERM or by the parent-watchdog. Calling the
	// stop func returned by NotifyContext also cancels ctx.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if *parentPID > 0 {
		go watchParent(ctx, *parentPID, stop)
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
	log.Printf("gateway stopped")
}

// withRoute injects the optaris routing context (group id) for every request.
// WithRoute is a context helper, not an http wrapper, so we set it on the request
// context before delegating to the engine handler.
func withRoute(groupID string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rc := optaris.RouteContext{GroupID: groupID}
		next.ServeHTTP(w, r.WithContext(optaris.WithRoute(r.Context(), rc)))
	})
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
