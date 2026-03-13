package device

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

func TestClassifySSHError_AuthFailed(t *testing.T) {
	err := fmt.Errorf("ssh: unable to authenticate")
	kind := classifySSHError(err)
	assert.Equal(t, ErrAuthFailed, kind)
}

func TestClassifySSHError_HostKeyMismatch(t *testing.T) {
	err := fmt.Errorf("ssh: host key mismatch")
	kind := classifySSHError(err)
	assert.Equal(t, ErrHostKeyMismatch, kind)
}

func TestClassifySSHError_Timeout(t *testing.T) {
	err := &net.OpError{
		Op:  "dial",
		Err: &timeoutError{},
	}
	kind := classifySSHError(err)
	assert.Equal(t, ErrTimeout, kind)
}

func TestClassifySSHError_ConnectionRefused(t *testing.T) {
	err := fmt.Errorf("dial tcp 10.0.0.1:22: connection refused")
	kind := classifySSHError(err)
	assert.Equal(t, ErrConnectionRefused, kind)
}

func TestClassifySSHError_Unknown(t *testing.T) {
	err := fmt.Errorf("some random error")
	kind := classifySSHError(err)
	assert.Equal(t, ErrUnknown, kind)
}

func TestSSHError_Error(t *testing.T) {
	sshErr := &SSHError{
		Kind:    ErrAuthFailed,
		Err:     fmt.Errorf("underlying"),
		Message: "auth failed for device",
	}
	assert.Contains(t, sshErr.Error(), "auth failed for device")
	assert.Contains(t, sshErr.Error(), "underlying")
}

func TestSSHError_Unwrap(t *testing.T) {
	inner := fmt.Errorf("inner error")
	sshErr := &SSHError{
		Kind: ErrUnknown,
		Err:  inner,
	}
	assert.True(t, errors.Is(sshErr, inner))
}

func TestCommandResult_Fields(t *testing.T) {
	result := &CommandResult{
		Stdout:   "output",
		Stderr:   "err",
		ExitCode: 0,
	}
	require.NotNil(t, result)
	assert.Equal(t, "output", result.Stdout)
	assert.Equal(t, "err", result.Stderr)
	assert.Equal(t, 0, result.ExitCode)
}

func TestTOFUCallback_FirstConnect(t *testing.T) {
	cb, fpCh := tofuHostKeyCallback("")
	// Simulate first connect with any key
	key := generateTestPublicKey(t)
	err := cb("10.0.0.1:22", nil, key)
	assert.NoError(t, err, "first connect should accept any key")

	fp := <-fpCh
	assert.NotEmpty(t, fp, "should return a fingerprint")
	assert.Contains(t, fp, "SHA256:", "fingerprint should have SHA256 prefix")
}

func TestTOFUCallback_MatchingFingerprint(t *testing.T) {
	key := generateTestPublicKey(t)
	fp := computeFingerprint(key)

	cb, _ := tofuHostKeyCallback(fp)
	err := cb("10.0.0.1:22", nil, key)
	assert.NoError(t, err, "matching fingerprint should be accepted")
}

func TestTOFUCallback_MismatchedFingerprint(t *testing.T) {
	key := generateTestPublicKey(t)

	cb, _ := tofuHostKeyCallback("SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	err := cb("10.0.0.1:22", nil, key)
	require.Error(t, err, "mismatched fingerprint should be rejected")

	var sshErr *SSHError
	require.True(t, errors.As(err, &sshErr))
	assert.Equal(t, ErrHostKeyMismatch, sshErr.Kind)
}

// generateTestPublicKey creates an ed25519 public key for testing.
func generateTestPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	pub, err := ssh.NewPublicKey(priv.Public())
	require.NoError(t, err)
	return pub
}

// timeoutError implements net.Error with Timeout() returning true.
type timeoutError struct{}

func (e *timeoutError) Error() string   { return "i/o timeout" }
func (e *timeoutError) Timeout() bool   { return true }
func (e *timeoutError) Temporary() bool { return false }
