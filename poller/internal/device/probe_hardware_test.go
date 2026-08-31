package device

import (
	"os"
	"strconv"
	"testing"
	"time"
)

// Hardware integration tests for the onboarding probe.
//
// These run only when TOD_PROBE_HW_IP is set, so CI without a lab device skips
// them. To run against a RouterOS device that has api-ssl enabled with
// certificate=none -- the configuration that produces the defect:
//
//	TOD_PROBE_HW_IP=10.101.0.84 \
//	TOD_PROBE_HW_USER=claude TOD_PROBE_HW_PASS=claude \
//	go test ./internal/device/ -run TestHardwareProbe -v
//
// Optional: TOD_PROBE_HW_SSL_PORT (default 8729), TOD_PROBE_HW_PLAIN_PORT
// (default 8728).

func hardwareProbeParams(t *testing.T) (ip, user, pass string, sslPort, plainPort int) {
	t.Helper()

	ip = os.Getenv("TOD_PROBE_HW_IP")
	if ip == "" {
		t.Skip("TOD_PROBE_HW_IP not set; skipping hardware probe test")
	}
	user = os.Getenv("TOD_PROBE_HW_USER")
	pass = os.Getenv("TOD_PROBE_HW_PASS")
	if user == "" {
		t.Skip("TOD_PROBE_HW_USER not set; skipping hardware probe test")
	}

	sslPort = envPort(t, "TOD_PROBE_HW_SSL_PORT", 8729)
	plainPort = envPort(t, "TOD_PROBE_HW_PLAIN_PORT", 8728)
	return ip, user, pass, sslPort, plainPort
}

func envPort(t *testing.T, key string, fallback int) int {
	t.Helper()
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		t.Fatalf("%s=%q is not a port number: %v", key, raw, err)
	}
	return n
}

// TestHardwareProbe_AnonymousDHDeviceCannotOnboardGreen is the end-to-end proof
// on real hardware. Against a device with api-ssl enabled and no certificate,
// the probe must refuse the device in auto mode -- the mode onboarding
// defaults to -- and say why. Under the old TCP-only check this device
// onboarded green and then failed every poll.
func TestHardwareProbe_AnonymousDHDeviceCannotOnboardGreen(t *testing.T) {
	ip, user, pass, sslPort, plainPort := hardwareProbeParams(t)

	res := ProbeRouterOS(ip, sslPort, plainPort, user, pass, 10*time.Second, nil, "auto")

	t.Logf("auto-mode probe result: ok=%v stage=%s reason=%s suggested=%q elapsed=%dms",
		res.OK, res.Stage, res.Reason, res.SuggestedTLSMode, res.ElapsedMS)
	t.Logf("message: %s", res.Message)
	t.Logf("detail:  %s", res.Detail)

	if res.OK {
		t.Fatalf("probe accepted a device whose api-ssl offers only anonymous-DH ciphers; "+
			"is a certificate now installed on %s?", ip)
	}
	if res.Reason != ReasonTLSCipherMismatch {
		t.Errorf("expected reason %q, got %q", ReasonTLSCipherMismatch, res.Reason)
	}
	if res.Stage != StageTLS {
		t.Errorf("expected failure at stage %q, got %q", StageTLS, res.Stage)
	}
	if res.SuggestedTLSMode != "plain" {
		t.Errorf("expected a verified suggestion of plain mode, got %q", res.SuggestedTLSMode)
	}
}

// TestHardwareProbe_PlainModeSucceeds proves the suggestion the probe makes is
// real: the same device, onboarded in the mode the probe recommends, completes
// a full API login and answers a system query.
func TestHardwareProbe_PlainModeSucceeds(t *testing.T) {
	ip, user, pass, sslPort, plainPort := hardwareProbeParams(t)

	res := ProbeRouterOS(ip, sslPort, plainPort, user, pass, 10*time.Second, nil, "plain")

	t.Logf("plain-mode probe result: ok=%v stage=%s reason=%s elapsed=%dms",
		res.OK, res.Stage, res.Reason, res.ElapsedMS)
	t.Logf("identity=%q version=%q board=%q", res.Identity, res.Version, res.BoardName)
	t.Logf("message: %s", res.Message)

	if !res.OK {
		t.Fatalf("plain-mode probe failed: reason=%s detail=%s", res.Reason, res.Detail)
	}
	if res.Stage != StageDone {
		t.Errorf("expected stage %q, got %q", StageDone, res.Stage)
	}
	if res.Identity == "" {
		t.Error("expected the identity query to return a name")
	}
	if res.Version == "" {
		t.Error("expected the resource query to return a RouterOS version")
	}
}

// TestHardwareProbe_BadPasswordIsAuthFailure confirms the probe distinguishes
// a credential problem from a transport problem. Onboarding with a wrong
// password previously passed the TCP check just as happily as a correct one.
func TestHardwareProbe_BadPasswordIsAuthFailure(t *testing.T) {
	ip, user, _, sslPort, plainPort := hardwareProbeParams(t)

	res := ProbeRouterOS(ip, sslPort, plainPort, user, "definitely-not-the-password",
		10*time.Second, nil, "plain")

	t.Logf("bad-password probe result: ok=%v stage=%s reason=%s", res.OK, res.Stage, res.Reason)
	t.Logf("message: %s", res.Message)
	t.Logf("detail:  %s", res.Detail)

	if res.OK {
		t.Fatal("probe accepted a wrong password")
	}
	if res.Reason != ReasonAuthFailed {
		t.Errorf("expected reason %q, got %q (detail: %s)", ReasonAuthFailed, res.Reason, res.Detail)
	}
	if res.Stage != StageLogin {
		t.Errorf("expected failure at stage %q, got %q", StageLogin, res.Stage)
	}
}
