// Package vault provides OpenBao Transit integration for credential encryption/decryption.
//
// The TransitClient communicates with the OpenBao Transit secrets engine via HTTP,
// enabling per-tenant encryption keys managed by OpenBao rather than a static
// application-level AES key.
package vault

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// TransitClient communicates with OpenBao Transit secrets engine via HTTP.
type TransitClient struct {
	httpClient *http.Client
	addr       string
	token      string
}

// NewTransitClient creates a Transit client with sensible defaults.
func NewTransitClient(addr, token string) *TransitClient {
	return &TransitClient{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		addr:       addr,
		token:      token,
	}
}

// transitDecryptResponse is the JSON response from Transit decrypt endpoint.
type transitDecryptResponse struct {
	Data struct {
		Plaintext string `json:"plaintext"`
	} `json:"data"`
	Errors []string `json:"errors,omitempty"`
}

// Decrypt decrypts a Transit ciphertext (vault:v1:...) and returns plaintext bytes.
func (c *TransitClient) Decrypt(tenantID, ciphertext string) ([]byte, error) {
	payload, err := json.Marshal(map[string]string{"ciphertext": ciphertext})
	if err != nil {
		return nil, fmt.Errorf("marshal decrypt request: %w", err)
	}

	url := fmt.Sprintf("%s/v1/transit/decrypt/tenant_%s", c.addr, tenantID)
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create decrypt request: %w", err)
	}
	req.Header.Set("X-Vault-Token", c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openbao transit decrypt: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read decrypt response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openbao transit decrypt failed (status %d): %s", resp.StatusCode, string(body))
	}

	var result transitDecryptResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal decrypt response: %w", err)
	}

	plaintext, err := base64.StdEncoding.DecodeString(result.Data.Plaintext)
	if err != nil {
		return nil, fmt.Errorf("decode plaintext base64: %w", err)
	}

	return plaintext, nil
}

// Encrypt encrypts plaintext bytes via Transit engine. Returns ciphertext string.
func (c *TransitClient) Encrypt(tenantID string, plaintext []byte) (string, error) {
	payload, err := json.Marshal(map[string]string{
		"plaintext": base64.StdEncoding.EncodeToString(plaintext),
	})
	if err != nil {
		return "", fmt.Errorf("marshal encrypt request: %w", err)
	}

	url := fmt.Sprintf("%s/v1/transit/encrypt/tenant_%s", c.addr, tenantID)
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create encrypt request: %w", err)
	}
	req.Header.Set("X-Vault-Token", c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("openbao transit encrypt: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read encrypt response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("openbao transit encrypt failed (status %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data struct {
			Ciphertext string `json:"ciphertext"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("unmarshal encrypt response: %w", err)
	}

	return result.Data.Ciphertext, nil
}
