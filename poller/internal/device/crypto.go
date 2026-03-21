package device

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"fmt"
)

// credentialsJSON is the JSON structure stored in encrypted device credentials.
// Must match the Python backend's encryption format.
type credentialsJSON struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// DecryptRaw decrypts AES-256-GCM encrypted data and returns the raw plaintext bytes.
// Used by GetRawCredentials to obtain credential JSON before type-specific parsing.
// The ciphertext layout is the same as described in DecryptCredentials.
func DecryptRaw(ciphertext []byte, key []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("encryption key must be 32 bytes, got %d", len(key))
	}
	if len(ciphertext) < 12+16 {
		return nil, fmt.Errorf("ciphertext too short: need at least 28 bytes (12 nonce + 16 tag), got %d", len(ciphertext))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM cipher: %w", err)
	}

	nonce := ciphertext[:12]
	encryptedData := ciphertext[12:]

	plaintext, err := gcm.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypting credentials (wrong key or tampered data): %w", err)
	}

	return plaintext, nil
}

// DecryptCredentials decrypts AES-256-GCM encrypted credentials and returns the
// username and password stored within.
//
// The ciphertext format MUST match what Python's cryptography.hazmat.primitives.ciphers.aead.AESGCM
// produces when called as: nonce + AESGCM.encrypt(nonce, plaintext, None)
//
// Layout on disk:
//   - bytes [0:12]   — 12-byte random nonce (GCM standard)
//   - bytes [12:]    — ciphertext + 16-byte GCM authentication tag (appended by library)
//
// Go's cipher.AEAD.Open expects the GCM tag appended to the ciphertext, which is exactly
// how Python's cryptography library stores it, so the two are directly compatible.
func DecryptCredentials(ciphertext []byte, key []byte) (username, password string, err error) {
	if len(key) != 32 {
		return "", "", fmt.Errorf("encryption key must be 32 bytes, got %d", len(key))
	}
	if len(ciphertext) < 12+16 {
		return "", "", fmt.Errorf("ciphertext too short: need at least 28 bytes (12 nonce + 16 tag), got %d", len(ciphertext))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", fmt.Errorf("creating AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", fmt.Errorf("creating GCM cipher: %w", err)
	}

	nonce := ciphertext[:12]
	encryptedData := ciphertext[12:]

	plaintext, err := gcm.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return "", "", fmt.Errorf("decrypting credentials (wrong key or tampered data): %w", err)
	}

	var creds credentialsJSON
	if err := json.Unmarshal(plaintext, &creds); err != nil {
		return "", "", fmt.Errorf("unmarshalling decrypted credentials JSON: %w", err)
	}

	return creds.Username, creds.Password, nil
}
