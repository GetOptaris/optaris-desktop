package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPresentedKey covers extraction across the four inbound formats and their
// precedence (Authorization > x-api-key > x-goog-api-key > ?key=), plus the trimming
// and fall-through edge cases.
func TestPresentedKey(t *testing.T) {
	tests := []struct {
		name  string
		setup func(*http.Request)
		want  string
	}{
		{
			name:  "authorization bearer",
			setup: func(r *http.Request) { r.Header.Set("Authorization", "Bearer abc") },
			want:  "abc",
		},
		{
			name:  "authorization bearer is trimmed",
			setup: func(r *http.Request) { r.Header.Set("Authorization", "Bearer   abc  ") },
			want:  "abc",
		},
		{
			name:  "authorization without bearer prefix falls through to empty",
			setup: func(r *http.Request) { r.Header.Set("Authorization", "abc") },
			want:  "",
		},
		{
			name:  "empty bearer value falls through to empty",
			setup: func(r *http.Request) { r.Header.Set("Authorization", "Bearer ") },
			want:  "",
		},
		{
			name:  "x-api-key",
			setup: func(r *http.Request) { r.Header.Set("x-api-key", "xyz") },
			want:  "xyz",
		},
		{
			name:  "x-goog-api-key",
			setup: func(r *http.Request) { r.Header.Set("x-goog-api-key", "goo") },
			want:  "goo",
		},
		{
			name:  "query key",
			setup: func(r *http.Request) { r.URL.RawQuery = "key=qqq" },
			want:  "qqq",
		},
		{
			name: "authorization bearer wins over x-api-key",
			setup: func(r *http.Request) {
				r.Header.Set("Authorization", "Bearer first")
				r.Header.Set("x-api-key", "second")
			},
			want: "first",
		},
		{
			name: "x-api-key wins over x-goog-api-key and query",
			setup: func(r *http.Request) {
				r.Header.Set("x-api-key", "second")
				r.Header.Set("x-goog-api-key", "third")
				r.URL.RawQuery = "key=fourth"
			},
			want: "second",
		},
		{
			name:  "nothing presented",
			setup: func(*http.Request) {},
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			tt.setup(r)
			if got := presentedKey(r); got != tt.want {
				t.Fatalf("presentedKey() = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestWithAuth checks the middleware gate: an empty configured key opens the gateway,
// a correct key via any format passes through, and a wrong/missing key is rejected with
// a 401 without ever reaching the next handler.
func TestWithAuth(t *testing.T) {
	const key = "sk-optaris-secret"

	bearer := func(k string) func(*http.Request) {
		return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+k) }
	}

	tests := []struct {
		name       string
		configured string
		setup      func(*http.Request)
		wantStatus int
		wantNext   bool
	}{
		{"empty configured key opens the gateway", "", func(*http.Request) {}, http.StatusOK, true},
		{"correct key via bearer", key, bearer(key), http.StatusOK, true},
		{
			name:       "correct key via x-api-key",
			configured: key,
			setup:      func(r *http.Request) { r.Header.Set("x-api-key", key) },
			wantStatus: http.StatusOK,
			wantNext:   true,
		},
		{
			name:       "correct key via x-goog-api-key",
			configured: key,
			setup:      func(r *http.Request) { r.Header.Set("x-goog-api-key", key) },
			wantStatus: http.StatusOK,
			wantNext:   true,
		},
		{
			name:       "correct key via query",
			configured: key,
			setup:      func(r *http.Request) { r.URL.RawQuery = "key=" + key },
			wantStatus: http.StatusOK,
			wantNext:   true,
		},
		{"wrong key rejected", key, bearer("nope"), http.StatusUnauthorized, false},
		{"missing key rejected", key, func(*http.Request) {}, http.StatusUnauthorized, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nextCalled := false
			next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			})
			h := withAuth(newConfigHolder(configMeta{apiKey: tt.configured}), next)

			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			tt.setup(r)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if nextCalled != tt.wantNext {
				t.Errorf("next handler called = %v, want %v", nextCalled, tt.wantNext)
			}
			if tt.wantStatus == http.StatusUnauthorized {
				body, _ := io.ReadAll(rec.Result().Body)
				if !strings.Contains(string(body), "unauthorized") {
					t.Errorf("401 body = %q, want it to mention %q", body, "unauthorized")
				}
			}
		})
	}
}
