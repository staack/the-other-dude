package device

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Hardware integration tests against a real RouterOS device.
//
// Skipped unless TOD_HW_SSH_HOST is set, so the normal suite stays hermetic:
//
//	TOD_HW_SSH_HOST=10.101.0.84 TOD_HW_SSH_USER=claude \
//	TOD_HW_SSH_PASS=claude TOD_HW_SSH_KEY=/path/to/key \
//	go test ./internal/device/ -run TestHardware -v
//
// These exercise the production code paths -- RunCommand and NewSSHClient --
// rather than a standalone probe, so they prove the shipped code authenticates
// against real RouterOS rather than that the ssh library does.

type hwConfig struct {
	host, user, pass, keyPath string
	port                      int
}

func hardwareConfig(t *testing.T) hwConfig {
	t.Helper()
	host := os.Getenv("TOD_HW_SSH_HOST")
	if host == "" {
		t.Skip("TOD_HW_SSH_HOST not set; skipping hardware integration test")
	}
	port := 22
	if p := os.Getenv("TOD_HW_SSH_PORT"); p != "" {
		var err error
		port, err = strconv.Atoi(p)
		require.NoError(t, err)
	}
	return hwConfig{
		host:    host,
		user:    os.Getenv("TOD_HW_SSH_USER"),
		pass:    os.Getenv("TOD_HW_SSH_PASS"),
		keyPath: os.Getenv("TOD_HW_SSH_KEY"),
		port:    port,
	}
}

func (c hwConfig) key(t *testing.T) string {
	t.Helper()
	if c.keyPath == "" {
		t.Skip("TOD_HW_SSH_KEY not set")
	}
	pem, err := os.ReadFile(c.keyPath)
	require.NoError(t, err)
	return string(pem)
}

func TestHardware_RunCommandWithPrivateKey(t *testing.T) {
	c := hardwareConfig(t)
	ctx := context.Background()

	result, fp, err := RunCommand(ctx, c.host, c.port, c.user, "", c.key(t),
		15*time.Second, "", "/system/identity/print")
	require.NoError(t, err)

	t.Logf("key auth OK: identity=%q host_key=%s", result.Stdout, fp)
	assert.Contains(t, result.Stdout, "name:")
	assert.Contains(t, fp, "SHA256:")
}

func TestHardware_RunCommandWithPasswordStillWorks(t *testing.T) {
	// The regression that matters most: existing password deployments.
	c := hardwareConfig(t)
	ctx := context.Background()

	result, _, err := RunCommand(ctx, c.host, c.port, c.user, c.pass, "",
		15*time.Second, "", "/system/identity/print")
	require.NoError(t, err)

	t.Logf("password auth OK: identity=%q", result.Stdout)
	assert.Contains(t, result.Stdout, "name:")
}

func TestHardware_RejectedKeyFallsBackToPassword(t *testing.T) {
	// A wrong key offered before the password must not abort the auth
	// conversation, or enabling keys would break every password deployment.
	c := hardwareConfig(t)
	ctx := context.Background()

	const notInstalled = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDNPBGmNwLtplTJ5rB0FRDviQtRTfCiIvcNJZfe9RqJ0wAAAJgQ+Ne3EPjX
twAAAAtzc2gtZWQyNTUxOQAAACDNPBGmNwLtplTJ5rB0FRDviQtRTfCiIvcNJZfe9RqJ0w
AAAEBQ0/JHhRVJ1kVvBpnLTPYFHZBAqUJmVv4Y0FfSVAgLPM08EaY3Au2mVMnmsHQVEO+J
C1FN8KIi9w0ll971GonTAAAAEm5vdC1pbnN0YWxsZWQtaGVyZQECAw==
-----END OPENSSH PRIVATE KEY-----
`

	result, _, err := RunCommand(ctx, c.host, c.port, c.user, c.pass, notInstalled,
		15*time.Second, "", "/system/identity/print")
	require.NoError(t, err, "password fallback after a rejected key must succeed")

	t.Logf("fallthrough OK: identity=%q", result.Stdout)
	assert.Contains(t, result.Stdout, "name:")
}

func TestHardware_NewSSHClientPinsAndVerifiesHostKey(t *testing.T) {
	c := hardwareConfig(t)

	// First connect: TOFU accepts and reports the host key.
	client, fp, err := NewSSHClient(c.host, c.port, c.user, "", c.key(t), "", 15*time.Second)
	require.NoError(t, err)
	client.Close()
	require.Contains(t, fp, "SHA256:")
	t.Logf("SFTP path key auth OK, pinned host key=%s", fp)

	// Reconnect with the pinned fingerprint: accepted.
	client2, _, err := NewSSHClient(c.host, c.port, c.user, "", c.key(t), fp, 15*time.Second)
	require.NoError(t, err)
	client2.Close()
	t.Logf("reconnect with pinned host key accepted")

	// A different fingerprint must be rejected.
	_, _, err = NewSSHClient(c.host, c.port, c.user, "", c.key(t),
		"SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 15*time.Second)
	require.Error(t, err)
	var sshErr *SSHError
	require.True(t, errors.As(err, &sshErr))
	assert.Equal(t, ErrHostKeyMismatch, sshErr.Kind)
	t.Logf("mismatched host key correctly rejected: %v", sshErr.Kind)
}
