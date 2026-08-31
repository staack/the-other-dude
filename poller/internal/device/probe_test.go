package device

import (
	"fmt"
	"net"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// startAnonDHServer starts an openssl s_server that offers ONLY anonymous-DH
// cipher suites and presents no certificate.
//
// This is a faithful stand-in for a RouterOS device with `api-ssl` enabled and
// `certificate=none`: verified against a real wAP ax (RouterOS 7.23.2) on
// 2026-08-30, which negotiates ADH-AES256-SHA256 under exactly this
// configuration. Go's crypto/tls implements no anonymous cipher suites at all,
// so a Go client can never complete this handshake -- which is the defect this
// probe exists to detect and report.
//
// Skips the test if openssl is unavailable or too new to offer ADH at all.
func startAnonDHServer(t *testing.T) int {
	t.Helper()

	bin, err := exec.LookPath("openssl")
	if err != nil {
		t.Skip("openssl not available; skipping anonymous-DH fixture")
	}

	port := freePort(t)
	cmd := exec.Command(bin,
		"s_server",
		"-accept", fmt.Sprint(port),
		"-nocert",
		"-cipher", "ADH:@SECLEVEL=0",
		"-tls1_2",
		"-quiet",
	)
	if err := cmd.Start(); err != nil {
		t.Skipf("could not start openssl s_server: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	// Wait for the listener to accept connections.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return port
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Skip("openssl s_server did not become ready; skipping anonymous-DH fixture")
	return 0
}

// freePort reserves an ephemeral port and releases it for the fixture to bind.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserving port: %v", err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	if err := l.Close(); err != nil {
		t.Fatalf("releasing port: %v", err)
	}
	return port
}

// TestProbeRouterOS_AnonymousDHReportedAsCipherMismatch is the regression test
// for the "onboards green, never polls" defect. A bare TCP connect to this
// fixture succeeds -- which is exactly why the old onboarding check passed it --
// but no Go client can ever speak TLS to it.
//
// The probe must fail, and must say *why* in terms the operator can act on.
func TestProbeRouterOS_AnonymousDHReportedAsCipherMismatch(t *testing.T) {
	port := startAnonDHServer(t)

	// Establish the premise: the port is open. This is all the old
	// onboarding validation ever checked.
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 2*time.Second)
	if err != nil {
		t.Fatalf("fixture port should be open (the whole point of this test): %v", err)
	}
	_ = conn.Close()

	res := ProbeRouterOS("127.0.0.1", port, 0, "admin", "pw", 5*time.Second, nil, "insecure")

	if res.OK {
		t.Fatal("probe reported OK against a server Go cannot negotiate TLS with")
	}
	if res.Stage != StageTLS {
		t.Errorf("expected failure at stage %q, got %q", StageTLS, res.Stage)
	}
	if res.Reason != ReasonTLSCipherMismatch {
		t.Errorf("expected reason %q, got %q (detail: %s)", ReasonTLSCipherMismatch, res.Reason, res.Detail)
	}

	// The message is the deliverable: it must name the cause and the fix.
	msg := strings.ToLower(res.Message)
	for _, want := range []string{"cipher", "api-ssl", "certificate", "plain"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message should mention %q so the operator can act on it; got: %s", want, res.Message)
		}
	}
}

// TestProbeRouterOS_AutoModeAlsoReportsCipherMismatch covers the default path.
// "auto" downgrades CA-verified -> InsecureSkipVerify and then stops; neither
// tier can negotiate an anonymous suite, so the diagnosis must survive the
// fallback ladder rather than degrading into a generic error.
func TestProbeRouterOS_AutoModeAlsoReportsCipherMismatch(t *testing.T) {
	port := startAnonDHServer(t)

	res := ProbeRouterOS("127.0.0.1", port, 0, "admin", "pw", 5*time.Second, nil, "auto")

	if res.OK {
		t.Fatal("probe reported OK in auto mode against an anonymous-DH server")
	}
	if res.Reason != ReasonTLSCipherMismatch {
		t.Errorf("expected reason %q in auto mode, got %q (detail: %s)", ReasonTLSCipherMismatch, res.Reason, res.Detail)
	}
}

// TestProbeRouterOS_ClosedPortIsUnreachable distinguishes "nothing listening"
// from "listening but unusable". Conflating the two is what made the original
// error message useless.
func TestProbeRouterOS_ClosedPortIsUnreachable(t *testing.T) {
	port := freePort(t) // reserved then released: nothing is listening

	res := ProbeRouterOS("127.0.0.1", port, port, "admin", "pw", 3*time.Second, nil, "insecure")

	if res.OK {
		t.Fatal("probe reported OK against a closed port")
	}
	if res.Stage != StageTCP {
		t.Errorf("expected failure at stage %q, got %q", StageTCP, res.Stage)
	}
	if res.Reason != ReasonUnreachable {
		t.Errorf("expected reason %q, got %q (detail: %s)", ReasonUnreachable, res.Reason, res.Detail)
	}
}

// TestProbeRouterOS_PlainModeUsesPlainPort ensures the documented workaround is
// actually exercised by the probe: in plain mode the SSL port is irrelevant and
// the plain API port is what must be dialled.
func TestProbeRouterOS_PlainModeUsesPlainPort(t *testing.T) {
	sslPort := startAnonDHServer(t) // open, but must NOT be dialled in plain mode
	plainPort := freePort(t)        // closed

	res := ProbeRouterOS("127.0.0.1", sslPort, plainPort, "admin", "pw", 3*time.Second, nil, "plain")

	if res.OK {
		t.Fatal("probe reported OK against a closed plain port")
	}
	if res.Stage != StageTCP {
		t.Errorf("plain mode should fail at TCP on the closed plain port, got stage %q (detail: %s)", res.Stage, res.Detail)
	}
	if res.Reason != ReasonUnreachable {
		t.Errorf("expected reason %q, got %q (detail: %s)", ReasonUnreachable, res.Reason, res.Detail)
	}
}

// TestTCPStageTimeoutIsCapped guards a bulk-adoption hazard.
//
// bulk_add_devices probes every device sequentially inside one HTTP request,
// and gunicorn kills a worker at 120s -- which rolls back the whole batch,
// losing even the devices that did adopt. An unreachable IP costs the full TCP
// dial timeout, so that per-device cost sets how many bad IPs a batch survives.
//
// Capping the TCP stage at 3s keeps a blackholed host cheaper than the check
// this replaced (which dialled two ports at 3s each, so 6s), while leaving the
// full timeout available to TLS and login -- stages that only run once a host
// has already proven responsive.
func TestTCPStageTimeoutIsCapped(t *testing.T) {
	cases := []struct {
		overall time.Duration
		want    time.Duration
	}{
		{overall: 10 * time.Second, want: 3 * time.Second},
		{overall: 30 * time.Second, want: 3 * time.Second},
		{overall: 2 * time.Second, want: 2 * time.Second}, // never exceed the overall budget
		{overall: 500 * time.Millisecond, want: 500 * time.Millisecond},
	}
	for _, c := range cases {
		if got := tcpStageTimeout(c.overall); got != c.want {
			t.Errorf("tcpStageTimeout(%s) = %s, want %s", c.overall, got, c.want)
		}
	}
}
