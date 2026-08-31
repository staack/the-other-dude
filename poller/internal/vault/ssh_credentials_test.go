package vault

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/staack/the-other-dude/poller/internal/device"
)

// encryptLegacy produces an AES-256-GCM ciphertext in the layout DecryptRaw
// expects (12-byte nonce prefix). Real encryption, so the cache's decrypt path
// is genuinely exercised rather than stubbed.
func encryptLegacy(t *testing.T, key, plaintext []byte) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)
	nonce := make([]byte, 12)
	_, err = rand.Read(nonce)
	require.NoError(t, err)
	return append(nonce, gcm.Seal(nil, nonce, plaintext, nil)...)
}

func newTestCache(legacyKey []byte) *CredentialCache {
	return NewCredentialCache(16, time.Minute, nil, legacyKey, nil)
}

func TestGetSSHCredentials_DeviceLevelSSHKey(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	ct := encryptLegacy(t, key, []byte(`{"type":"ssh_key","username":"admin","private_key":"KEYDATA"}`))

	creds, err := newTestCache(key).GetSSHCredentials("dev-1", "tenant-1", nil, ct, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, "admin", creds.Username)
	assert.Equal(t, "KEYDATA", creds.PrivateKey)
}

func TestGetSSHCredentials_LegacyPasswordCredentialsUnaffected(t *testing.T) {
	// The regression that matters most: existing password-only deployments.
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	ct := encryptLegacy(t, key, []byte(`{"username":"admin","password":"secret"}`))

	creds, err := newTestCache(key).GetSSHCredentials("dev-2", "tenant-1", nil, ct, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, "admin", creds.Username)
	assert.Equal(t, "secret", creds.Password)
	assert.Empty(t, creds.PrivateKey)
}

func TestGetSSHCredentials_FallsBackToCredentialProfileKey(t *testing.T) {
	// A key attached to a credential profile must reach every device that
	// points at the profile, with no per-device credential of its own.
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	profileCT := encryptLegacy(t, key, []byte(`{"type":"ssh_key","username":"svc","private_key":"PROFILEKEY"}`))

	creds, err := newTestCache(key).GetSSHCredentials("dev-3", "tenant-1", nil, nil, nil, profileCT)
	require.NoError(t, err)
	assert.Equal(t, "svc", creds.Username)
	assert.Equal(t, "PROFILEKEY", creds.PrivateKey)
}

func TestGetSSHCredentials_DeviceCredentialOverridesProfile(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	deviceCT := encryptLegacy(t, key, []byte(`{"type":"ssh_key","username":"dev","private_key":"DEVICEKEY"}`))
	profileCT := encryptLegacy(t, key, []byte(`{"type":"ssh_key","username":"svc","private_key":"PROFILEKEY"}`))

	creds, err := newTestCache(key).GetSSHCredentials("dev-4", "tenant-1", nil, deviceCT, nil, profileCT)
	require.NoError(t, err)
	assert.Equal(t, "DEVICEKEY", creds.PrivateKey)
}

func TestGetSSHCredentials_NoCredentialsIsAnError(t *testing.T) {
	_, err := newTestCache(nil).GetSSHCredentials("dev-5", "tenant-1", nil, nil, nil, nil)
	require.Error(t, err)
}

// TestGetCredentials_ResolvesCredentialProfile guards a defect found while
// wiring key auth: GetCredentials hardcoded nil for both profile ciphertexts,
// so a device whose credentials live only on a credential profile could not be
// polled at all — it failed with "no credentials available".
func TestGetCredentials_ResolvesCredentialProfile(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	profileCT := encryptLegacy(t, key, []byte(`{"type":"routeros","username":"svc","password":"profilepass"}`))

	username, password, err := newTestCache(key).GetCredentials("dev-6", "tenant-1", nil, nil, nil, profileCT)
	require.NoError(t, err)
	assert.Equal(t, "svc", username)
	assert.Equal(t, "profilepass", password)
}

// TestHardware_EnvelopeFromBackendAuthenticates closes the loop across the two
// languages: the backend writes a credential envelope from a customer's
// passphrase-protected key, this parser reads it, and the key authenticates to
// a real RouterOS device. Field-name drift between the Python writer and the Go
// reader would be invisible to either side's unit tests.
//
//	TOD_HW_ENVELOPE=/tmp/sshkeyauth/envelope.json TOD_HW_SSH_HOST=10.101.0.84 \
//	go test ./internal/vault/ -run TestHardware_Envelope -v
func TestHardware_EnvelopeFromBackendAuthenticates(t *testing.T) {
	envelopePath := os.Getenv("TOD_HW_ENVELOPE")
	host := os.Getenv("TOD_HW_SSH_HOST")
	if envelopePath == "" || host == "" {
		t.Skip("TOD_HW_ENVELOPE / TOD_HW_SSH_HOST not set; skipping hardware test")
	}

	raw, err := os.ReadFile(envelopePath)
	require.NoError(t, err)

	creds, err := ParseSSHCredentials(raw)
	require.NoError(t, err)
	require.NotEmpty(t, creds.PrivateKey, "backend envelope must carry a private key")
	t.Logf("parsed backend envelope: username=%q private_key=%d bytes password_empty=%v",
		creds.Username, len(creds.PrivateKey), creds.Password == "")

	result, fp, err := device.RunCommand(
		context.Background(), host, 22,
		creds.Username, creds.Password, creds.PrivateKey,
		15*time.Second, "", "/system/identity/print",
	)
	require.NoError(t, err)
	t.Logf("authenticated to %s with the backend-written key: identity=%q host_key=%s",
		host, result.Stdout, fp)
	assert.Contains(t, result.Stdout, "name:")
}
