package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/the-other-dude/winbox-worker/internal/session"
)

func testServer(t *testing.T, maxSessions int) *httptest.Server {
	t.Helper()
	cfg := session.Config{MaxSessions: maxSessions, DisplayMin: 100, DisplayMax: 101, WSPortMin: 10100, WSPortMax: 10101,
		IdleTimeout: 600, MaxLifetime: 7200, WinBoxPath: "/usr/bin/true", BindAddr: "127.0.0.1"}
	mgr := session.NewManager(cfg)
	srv := httptest.NewServer(buildHandler(mgr, cfg, "correct-token"))
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, srv *httptest.Server, method, path, token, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("X-Worker-Token", token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

const validBody = `{"session_id":"abc-123","tunnel_host":"tod_poller","tunnel_port":49001,"username":"u","password":"p"}`

// Anything that creates, lists or terminates sessions needs the shared
// secret; the control API is reachable by every container on the network.
func TestControlAPIRequiresSharedSecret(t *testing.T) {
	srv := testServer(t, 1)
	for _, tc := range []struct{ method, path string }{
		{"POST", "/sessions"}, {"GET", "/sessions"}, {"GET", "/sessions/x"}, {"DELETE", "/sessions/x"},
	} {
		if got := do(t, srv, tc.method, tc.path, "", validBody).StatusCode; got != http.StatusUnauthorized {
			t.Errorf("%s %s without token: %d, want 401", tc.method, tc.path, got)
		}
		if got := do(t, srv, tc.method, tc.path, "wrong", validBody).StatusCode; got != http.StatusUnauthorized {
			t.Errorf("%s %s with wrong token: %d, want 401", tc.method, tc.path, got)
		}
	}
	if got := do(t, srv, "GET", "/healthz", "", "").StatusCode; got != http.StatusOK {
		t.Errorf("/healthz must stay open for the container healthcheck: %d", got)
	}
}

func TestCreateValidatesRequest(t *testing.T) {
	srv := testServer(t, 0) // a valid body reaches the capacity check and gets 503
	cases := map[string]string{
		"traversal id":      `{"session_id":"../x","tunnel_host":"h","tunnel_port":1,"username":"u","password":"p"}`,
		"space in id":       `{"session_id":"a b","tunnel_host":"h","tunnel_port":1,"username":"u","password":"p"}`,
		"negative idle":     `{"session_id":"a","tunnel_host":"h","tunnel_port":1,"username":"u","password":"p","idle_timeout_seconds":-1}`,
		"negative lifetime": `{"session_id":"a","tunnel_host":"h","tunnel_port":1,"username":"u","password":"p","max_lifetime_seconds":-5}`,
		"port zero":         `{"session_id":"a","tunnel_host":"h","tunnel_port":0,"username":"u","password":"p"}`,
		"port too big":      `{"session_id":"a","tunnel_host":"h","tunnel_port":70000,"username":"u","password":"p"}`,
		"empty host":        `{"session_id":"a","tunnel_host":"","tunnel_port":1,"username":"u","password":"p"}`,
		"huge body":         `{"session_id":"a","tunnel_host":"h","tunnel_port":1,"username":"u","password":"` + strings.Repeat("x", 70000) + `"}`,
		"overflowing idle":  `{"session_id":"a","tunnel_host":"h","tunnel_port":1,"username":"u","password":"p","idle_timeout_seconds":9223372037}`,
	}
	for name, body := range cases {
		if got := do(t, srv, "POST", "/sessions", "correct-token", body).StatusCode; got != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, got)
		}
	}
	if got := do(t, srv, "POST", "/sessions", "correct-token", validBody).StatusCode; got != http.StatusServiceUnavailable {
		t.Errorf("valid body at zero capacity: %d, want 503", got)
	}
}
