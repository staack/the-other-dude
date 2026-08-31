package device

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

// testPrivateKeyPEM generates a real unencrypted ed25519 private key in OpenSSH
// PEM form. Real key material, not a fixture, so the parser is genuinely exercised.
func testPrivateKeyPEM(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	block, err := ssh.MarshalPrivateKey(priv, "")
	require.NoError(t, err)
	return string(pem.EncodeToMemory(block))
}

// methodKinds reports the concrete auth method types in order, so ordering
// (public key attempted before password) can be asserted.
func methodKinds(methods []ssh.AuthMethod) []string {
	kinds := make([]string, 0, len(methods))
	for _, m := range methods {
		kinds = append(kinds, reflect.TypeOf(m).String())
	}
	return kinds
}

func TestSSHAuthMethods_PasswordOnly(t *testing.T) {
	// The existing, overwhelmingly common case must be untouched: exactly one
	// password method, identical to the behavior before key support existed.
	methods, err := SSHAuthMethods("secret", "")
	require.NoError(t, err)
	require.Len(t, methods, 1)
	assert.Contains(t, strings.ToLower(methodKinds(methods)[0]), "password")
}

func TestSSHAuthMethods_KeyOnly(t *testing.T) {
	methods, err := SSHAuthMethods("", testPrivateKeyPEM(t))
	require.NoError(t, err)
	require.Len(t, methods, 1)
	assert.Contains(t, strings.ToLower(methodKinds(methods)[0]), "publickey")
}

func TestSSHAuthMethods_KeyIsOfferedBeforePassword(t *testing.T) {
	// Ordering matters: the key is the credential the customer mandated, the
	// password is only a migration fallback.
	methods, err := SSHAuthMethods("secret", testPrivateKeyPEM(t))
	require.NoError(t, err)
	require.Len(t, methods, 2)
	kinds := methodKinds(methods)
	assert.Contains(t, strings.ToLower(kinds[0]), "publickey")
	assert.Contains(t, strings.ToLower(kinds[1]), "password")
}

func TestSSHAuthMethods_NoCredentialsAtAll(t *testing.T) {
	_, err := SSHAuthMethods("", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no SSH credentials")
}

func TestSSHAuthMethods_MalformedPrivateKey(t *testing.T) {
	// A broken key must fail loudly rather than silently degrading to the
	// password, which would hide a misconfiguration from the operator.
	_, err := SSHAuthMethods("secret", "-----BEGIN OPENSSH PRIVATE KEY-----\ngarbage\n-----END OPENSSH PRIVATE KEY-----")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parsing SSH private key")
}

func TestSSHAuthMethods_PassphraseProtectedKeyGivesActionableError(t *testing.T) {
	// Passphrases are stripped by the API at upload; one reaching the poller is
	// a bug, and the error must say so rather than surfacing a bare parse error.
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	block, err := ssh.MarshalPrivateKeyWithPassphrase(priv, "", []byte("hunter2"))
	require.NoError(t, err)

	_, err = SSHAuthMethods("", string(pem.EncodeToMemory(block)))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "passphrase")
	// The passphrase-protected key's contents must not leak into the error.
	assert.NotContains(t, err.Error(), "hunter2")
}
