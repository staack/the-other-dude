package device

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHErrorKind classifies SSH connection and command errors.
type SSHErrorKind string

const (
	// ErrAuthFailed indicates the SSH credentials were rejected.
	ErrAuthFailed SSHErrorKind = "auth_failed"
	// ErrHostKeyMismatch indicates a TOFU host key verification failure.
	ErrHostKeyMismatch SSHErrorKind = "host_key_mismatch"
	// ErrTimeout indicates the connection or command timed out.
	ErrTimeout SSHErrorKind = "timeout"
	// ErrTruncatedOutput indicates the command timed out mid-stream, producing partial output.
	ErrTruncatedOutput SSHErrorKind = "truncated_output"
	// ErrConnectionRefused indicates the remote host refused the TCP connection.
	ErrConnectionRefused SSHErrorKind = "connection_refused"
	// ErrUnknown indicates an unclassified error.
	ErrUnknown SSHErrorKind = "unknown"
)

// SSHError wraps an SSH-related error with a classification kind.
type SSHError struct {
	Kind    SSHErrorKind
	Err     error
	Message string
}

// Error implements the error interface.
func (e *SSHError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s", e.Message, e.Err.Error())
	}
	return e.Message
}

// Unwrap returns the underlying error for errors.Is/As support.
func (e *SSHError) Unwrap() error {
	return e.Err
}

// CommandResult holds the output of a remote SSH command execution.
type CommandResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Duration time.Duration
}

// RunCommand executes a command on a remote device via SSH with TOFU host key verification.
//
// Parameters:
//   - knownFingerprint: empty string for first connect (TOFU accepts any key), or a
//     previously stored "SHA256:base64(...)" fingerprint for verification.
//   - command: the RouterOS CLI command to execute (e.g., "/export")
//
// Returns:
//   - result: command output (stdout, stderr, exit code, duration)
//   - observedFingerprint: the SSH host key fingerprint observed during connection
//   - err: classified SSHError on failure, nil on success
func RunCommand(ctx context.Context, ip string, port int, username, password string,
	timeout time.Duration, knownFingerprint string, command string) (*CommandResult, string, error) {

	cb, fpCh := tofuHostKeyCallback(knownFingerprint)

	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: cb,
		Timeout:         timeout,
	}

	addr := fmt.Sprintf("%s:%d", ip, port)

	// Context-aware dial
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, "", &SSHError{
			Kind:    classifySSHError(err),
			Err:     err,
			Message: fmt.Sprintf("TCP dial to %s failed", addr),
		}
	}

	// SSH handshake over the raw connection
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		conn.Close()
		return nil, "", &SSHError{
			Kind:    classifySSHError(err),
			Err:     err,
			Message: fmt.Sprintf("SSH handshake to %s failed", addr),
		}
	}

	client := ssh.NewClient(sshConn, chans, reqs)
	defer client.Close()

	// Read the observed fingerprint (will be available after handshake)
	var observedFP string
	select {
	case fp := <-fpCh:
		observedFP = fp
	default:
		// Channel already drained or callback didn't fire (shouldn't happen)
	}

	session, err := client.NewSession()
	if err != nil {
		return nil, observedFP, &SSHError{
			Kind:    ErrUnknown,
			Err:     err,
			Message: "creating SSH session failed",
		}
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	start := time.Now()

	// Run with context cancellation for timeout detection
	done := make(chan error, 1)
	go func() {
		done <- session.Run(command)
	}()

	var runErr error
	select {
	case <-ctx.Done():
		// Context cancelled/timed out mid-execution
		session.Close()
		return &CommandResult{
			Stdout:   stdout.String(),
			Stderr:   stderr.String(),
			ExitCode: -1,
			Duration: time.Since(start),
		}, observedFP, &SSHError{
			Kind:    ErrTruncatedOutput,
			Err:     ctx.Err(),
			Message: "command timed out mid-execution, output may be truncated",
		}
	case runErr = <-done:
	}

	duration := time.Since(start)

	result := &CommandResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExitCode: 0,
		Duration: duration,
	}

	if runErr != nil {
		// Check for exit status errors
		if exitErr, ok := runErr.(*ssh.ExitError); ok {
			result.ExitCode = exitErr.ExitStatus()
			return result, observedFP, nil // Non-zero exit is not an SSH error
		}
		return result, observedFP, &SSHError{
			Kind:    classifySSHError(runErr),
			Err:     runErr,
			Message: "SSH command execution failed",
		}
	}

	return result, observedFP, nil
}

// tofuHostKeyCallback returns an SSH host key callback implementing Trust-On-First-Use.
//
// If knownFingerprint is empty, any key is accepted and its fingerprint is sent on the channel.
// If knownFingerprint matches the presented key, the connection is accepted.
// If knownFingerprint does not match, the connection is rejected with ErrHostKeyMismatch.
func tofuHostKeyCallback(knownFingerprint string) (ssh.HostKeyCallback, chan string) {
	fpCh := make(chan string, 1)

	cb := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := computeFingerprint(key)

		if knownFingerprint == "" {
			// First connect: accept and report fingerprint
			fpCh <- fp
			return nil
		}

		fpCh <- fp

		if fp != knownFingerprint {
			return &SSHError{
				Kind:    ErrHostKeyMismatch,
				Err:     fmt.Errorf("expected %s, got %s", knownFingerprint, fp),
				Message: fmt.Sprintf("host key mismatch for %s", hostname),
			}
		}

		return nil
	}

	return cb, fpCh
}

// computeFingerprint computes the SSH host key fingerprint in the same format as ssh-keygen:
// "SHA256:" followed by the base64-encoded (no padding) SHA256 hash of the public key bytes.
func computeFingerprint(key ssh.PublicKey) string {
	h := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(h[:])
}

// classifySSHError inspects an error and returns the appropriate SSHErrorKind.
func classifySSHError(err error) SSHErrorKind {
	if err == nil {
		return ErrUnknown
	}

	errStr := err.Error()

	// Check for timeout (net.Error interface)
	var netErr net.Error
	if ok := errorAs(err, &netErr); ok && netErr.Timeout() {
		return ErrTimeout
	}

	if strings.Contains(errStr, "i/o timeout") {
		return ErrTimeout
	}

	if strings.Contains(errStr, "unable to authenticate") ||
		strings.Contains(errStr, "no supported methods remain") {
		return ErrAuthFailed
	}

	if strings.Contains(errStr, "host key") {
		return ErrHostKeyMismatch
	}

	if strings.Contains(errStr, "connection refused") {
		return ErrConnectionRefused
	}

	return ErrUnknown
}

// errorAs is a helper that wraps errors.As for interface targets.
func errorAs[T any](err error, target *T) bool {
	for err != nil {
		if t, ok := err.(T); ok {
			*target = t
			return true
		}
		if u, ok := err.(interface{ Unwrap() error }); ok {
			err = u.Unwrap()
		} else {
			return false
		}
	}
	return false
}
