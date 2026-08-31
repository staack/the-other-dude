package device

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

// startTestSSHServer runs a real in-process SSH server that accepts any
// password, and returns its address and host key fingerprint. Using a genuine
// server means the host key callback is exercised through the actual handshake
// rather than called directly.
func startTestSSHServer(t *testing.T) (addr string, hostKeyFP string) {
	t.Helper()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := ssh.NewSignerFromSigner(priv)
	require.NoError(t, err)

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions, error) {
			return &ssh.Permissions{}, nil
		},
	}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				sc, chans, reqs, err := ssh.NewServerConn(conn, cfg)
				if err != nil {
					_ = conn.Close()
					return
				}
				go ssh.DiscardRequests(reqs)
				go func() {
					for ch := range chans {
						_ = ch.Reject(ssh.Prohibited, "no channels in test server")
					}
				}()
				_ = sc
			}()
		}
	}()

	return ln.Addr().String(), computeFingerprint(signer.PublicKey())
}

func splitHostPort(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portStr, err := net.SplitHostPort(addr)
	require.NoError(t, err)
	port, err := strconv.Atoi(portStr)
	require.NoError(t, err)
	return host, port
}

func TestNewSSHClient_FirstConnectReportsObservedFingerprint(t *testing.T) {
	addr, wantFP := startTestSSHServer(t)
	host, port := splitHostPort(t, addr)

	client, observedFP, err := NewSSHClient(host, port, "u", "p", "", "", 5*time.Second)
	require.NoError(t, err)
	defer client.Close()

	assert.Equal(t, wantFP, observedFP, "TOFU first connect must report the host key it pinned")
}

func TestNewSSHClient_AcceptsMatchingHostKey(t *testing.T) {
	addr, fp := startTestSSHServer(t)
	host, port := splitHostPort(t, addr)

	client, _, err := NewSSHClient(host, port, "u", "p", "", fp, 5*time.Second)
	require.NoError(t, err)
	defer client.Close()
}

func TestNewSSHClient_RejectsMismatchedHostKey(t *testing.T) {
	// The point of the change: an SFTP upload to a device whose host key has
	// changed must fail rather than silently trusting the new key.
	addr, _ := startTestSSHServer(t)
	host, port := splitHostPort(t, addr)

	_, _, err := NewSSHClient(host, port, "u", "p", "",
		"SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 5*time.Second)
	require.Error(t, err)

	var sshErr *SSHError
	require.True(t, errors.As(err, &sshErr), "expected a classified SSHError, got %T", err)
	assert.Equal(t, ErrHostKeyMismatch, sshErr.Kind)
}
