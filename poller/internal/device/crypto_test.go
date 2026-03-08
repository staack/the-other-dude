package device

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// encrypt is a test helper that encrypts using the same format as Python's AESGCM.
// This verifies Go-side decryption is compatible with Python-side encryption.
func encrypt(t *testing.T, plaintext []byte, key []byte) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)
	nonce := make([]byte, 12)
	_, err = rand.Read(nonce)
	require.NoError(t, err)
	// gcm.Seal appends ciphertext+tag after nonce
	return gcm.Seal(nonce, nonce, plaintext, nil)
}

func TestDecryptCredentials_RoundTrip(t *testing.T) {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)

	creds := credentialsJSON{Username: "admin", Password: "secret123"}
	plaintext, err := json.Marshal(creds)
	require.NoError(t, err)

	ciphertext := encrypt(t, plaintext, key)

	username, password, err := DecryptCredentials(ciphertext, key)
	require.NoError(t, err)
	assert.Equal(t, "admin", username)
	assert.Equal(t, "secret123", password)
}

func TestDecryptCredentials_WrongKey(t *testing.T) {
	key1 := make([]byte, 32)
	key2 := make([]byte, 32)
	_, _ = rand.Read(key1)
	_, _ = rand.Read(key2)

	creds := credentialsJSON{Username: "admin", Password: "secret"}
	plaintext, _ := json.Marshal(creds)
	ciphertext := encrypt(t, plaintext, key1)

	_, _, err := DecryptCredentials(ciphertext, key2)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "wrong key or tampered")
}

func TestDecryptCredentials_ShortCiphertext(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)

	_, _, err := DecryptCredentials([]byte("short"), key)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "too short")
}

func TestDecryptCredentials_WrongKeyLength(t *testing.T) {
	_, _, err := DecryptCredentials(make([]byte, 50), make([]byte, 16))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "32 bytes")
}

func TestDecryptCredentials_TamperedCiphertext(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)

	creds := credentialsJSON{Username: "admin", Password: "secret"}
	plaintext, _ := json.Marshal(creds)
	ciphertext := encrypt(t, plaintext, key)

	// Flip a byte in the encrypted portion (after 12-byte nonce)
	tampered := make([]byte, len(ciphertext))
	copy(tampered, ciphertext)
	tampered[15] ^= 0xFF

	_, _, err := DecryptCredentials(tampered, key)
	assert.Error(t, err)
}
