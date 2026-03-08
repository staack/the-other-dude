// Package device handles RouterOS device connections and queries.
package device

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"time"

	routeros "github.com/go-routeros/routeros/v3"
)

// buildTLSConfig creates a TLS config using the portal CA cert for verification.
// Falls back to InsecureSkipVerify if caCertPEM is empty or invalid.
func buildTLSConfig(caCertPEM []byte) *tls.Config {
	if len(caCertPEM) == 0 {
		return &tls.Config{InsecureSkipVerify: true} //nolint:gosec // no CA cert available
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caCertPEM) {
		slog.Warn("failed to parse CA cert PEM, falling back to insecure TLS")
		return &tls.Config{InsecureSkipVerify: true} //nolint:gosec // invalid CA cert
	}
	return &tls.Config{RootCAs: pool}
}

// ConnectDevice establishes a connection to a RouterOS device.
//
// Connection strategy is governed by tlsMode:
//
//   - "auto" (default): Try CA-verified TLS (if caCertPEM provided) ->
//     InsecureSkipVerify -> STOP. No plain-text fallback.
//   - "portal_ca": Try CA-verified TLS only (strict).
//   - "insecure": Skip directly to InsecureSkipVerify TLS (no CA check).
//   - "plain": Explicit opt-in for plain-text API connection.
//
// Callers must call CloseDevice when done.
func ConnectDevice(ip string, sslPort, plainPort int, username, password string, timeout time.Duration, caCertPEM []byte, tlsMode string) (*routeros.Client, error) {
	sslAddr := fmt.Sprintf("%s:%d", ip, sslPort)

	switch tlsMode {
	case "plain":
		// Explicit opt-in: plain-text connection only
		plainAddr := fmt.Sprintf("%s:%d", ip, plainPort)
		slog.Debug("connecting to RouterOS device (plain — explicit opt-in)", "address", plainAddr)
		client, err := routeros.DialTimeout(plainAddr, username, password, timeout)
		if err != nil {
			return nil, fmt.Errorf("plain-text connection to %s failed: %w", plainAddr, err)
		}
		slog.Debug("connected to RouterOS device (plain — explicit opt-in)", "address", plainAddr)
		return client, nil

	case "insecure":
		// Skip CA verification, go straight to InsecureSkipVerify
		insecureTLS := &tls.Config{InsecureSkipVerify: true} //nolint:gosec // insecure mode requested
		slog.Debug("connecting to RouterOS device (insecure TLS)", "address", sslAddr)
		client, err := routeros.DialTLSTimeout(sslAddr, username, password, insecureTLS, timeout)
		if err != nil {
			return nil, fmt.Errorf("insecure TLS connection to %s failed: %w", sslAddr, err)
		}
		slog.Debug("connected with insecure TLS", "address", sslAddr)
		return client, nil

	case "portal_ca":
		// Strict CA-verified TLS only
		verifiedTLS := buildTLSConfig(caCertPEM)
		if verifiedTLS.RootCAs == nil {
			return nil, fmt.Errorf("portal_ca mode requires a valid CA cert but none available for %s", sslAddr)
		}
		slog.Debug("connecting to RouterOS device (CA-verified TLS)", "address", sslAddr)
		client, err := routeros.DialTLSTimeout(sslAddr, username, password, verifiedTLS, timeout)
		if err != nil {
			return nil, fmt.Errorf("CA-verified TLS connection to %s failed: %w", sslAddr, err)
		}
		slog.Debug("connected with CA-verified TLS", "address", sslAddr)
		return client, nil

	default:
		// "auto" mode: CA-verified -> InsecureSkipVerify -> STOP (no plain-text)

		// Tier 1: CA-verified TLS (if CA cert available)
		if len(caCertPEM) > 0 {
			verifiedTLS := buildTLSConfig(caCertPEM)
			if verifiedTLS.RootCAs != nil { // only try if PEM parsed OK
				slog.Debug("connecting to RouterOS device (CA-verified TLS)", "address", sslAddr)
				client, err := routeros.DialTLSTimeout(sslAddr, username, password, verifiedTLS, timeout)
				if err == nil {
					slog.Debug("connected with CA-verified TLS", "address", sslAddr)
					return client, nil
				}
				slog.Debug("CA-verified TLS failed, trying insecure TLS", "address", sslAddr, "error", err)
			}
		}

		// Tier 2: InsecureSkipVerify TLS (fallback)
		insecureTLS := &tls.Config{InsecureSkipVerify: true} //nolint:gosec // fallback for unprovisioned devices
		slog.Debug("connecting to RouterOS device (insecure TLS)", "address", sslAddr)
		client, err := routeros.DialTLSTimeout(sslAddr, username, password, insecureTLS, timeout)
		if err != nil {
			// NO plain-text fallback in auto mode — this is the key security change
			return nil, fmt.Errorf("TLS connection to %s failed (auto mode — no plain-text fallback): %w", sslAddr, err)
		}
		slog.Debug("connected with insecure TLS", "address", sslAddr)
		return client, nil
	}
}

// CloseDevice closes a RouterOS client connection. Safe to call on a nil client.
func CloseDevice(c *routeros.Client) {
	if c == nil {
		return
	}
	c.Close()
}
