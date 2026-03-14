package vault

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/staack/the-other-dude/poller/internal/device"
)

// CachedCreds holds decrypted device credentials.
type CachedCreds struct {
	Username string
	Password string
}

// Prometheus metrics for credential cache and OpenBao Transit observability.
var (
	CacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "poller_credential_cache_hits_total",
		Help: "Number of credential cache hits (no OpenBao call)",
	})
	CacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "poller_credential_cache_misses_total",
		Help: "Number of credential cache misses (OpenBao decrypt call)",
	})
	OpenBaoLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "poller_openbao_decrypt_duration_seconds",
		Help:    "Latency of OpenBao Transit decrypt calls",
		Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0},
	})
	LegacyDecrypts = promauto.NewCounter(prometheus.CounterOpts{
		Name: "poller_credential_legacy_decrypts_total",
		Help: "Number of credentials decrypted using legacy AES key (not yet migrated)",
	})
)

// CredentialCache provides cached credential decryption with dual-read support.
// It uses an LRU cache with TTL to avoid redundant OpenBao calls and falls back
// to legacy AES-256-GCM decryption for credentials not yet migrated to Transit.
type CredentialCache struct {
	cache   *expirable.LRU[string, *CachedCreds]
	transit *TransitClient
	legacy  []byte       // legacy AES-256-GCM key (nil if not available)
	db      *pgxpool.Pool // for key_access_log inserts (nil if not available)
}

// NewCredentialCache creates a bounded LRU cache with the given size and TTL.
// transit may be nil if OpenBao is not configured. legacyKey may be nil if not available.
// db may be nil if key access logging is not needed.
func NewCredentialCache(size int, ttl time.Duration, transit *TransitClient, legacyKey []byte, db *pgxpool.Pool) *CredentialCache {
	cache := expirable.NewLRU[string, *CachedCreds](size, nil, ttl)
	return &CredentialCache{
		cache:   cache,
		transit: transit,
		legacy:  legacyKey,
		db:      db,
	}
}

// GetCredentials returns decrypted credentials for a device, using the cache.
// transitCiphertext is the Transit-encrypted string (nullable), legacyCiphertext is the legacy BYTEA (nullable).
// Returns (username, password, error).
func (c *CredentialCache) GetCredentials(
	deviceID, tenantID string,
	transitCiphertext *string,
	legacyCiphertext []byte,
) (string, string, error) {
	// Check cache first
	if cached, ok := c.cache.Get(deviceID); ok {
		CacheHits.Inc()
		return cached.Username, cached.Password, nil
	}
	CacheMisses.Inc()

	var username, password string

	// Prefer Transit ciphertext if available
	if transitCiphertext != nil && *transitCiphertext != "" && strings.HasPrefix(*transitCiphertext, "vault:v") {
		if c.transit == nil {
			return "", "", fmt.Errorf("transit ciphertext present but OpenBao client not configured")
		}

		start := time.Now()
		plaintext, err := c.transit.Decrypt(tenantID, *transitCiphertext)
		OpenBaoLatency.Observe(time.Since(start).Seconds())

		if err != nil {
			return "", "", fmt.Errorf("transit decrypt for device %s: %w", deviceID, err)
		}

		var creds struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.Unmarshal(plaintext, &creds); err != nil {
			return "", "", fmt.Errorf("unmarshal transit-decrypted credentials: %w", err)
		}
		username = creds.Username
		password = creds.Password

		// Fire-and-forget key access log INSERT for audit trail
		if c.db != nil {
			go c.logKeyAccess(deviceID, tenantID, "decrypt_credentials", "poller_poll")
		}

	} else if legacyCiphertext != nil && len(legacyCiphertext) > 0 {
		// Fall back to legacy AES-256-GCM decryption
		if c.legacy == nil {
			return "", "", fmt.Errorf("legacy ciphertext present but encryption key not configured")
		}

		var err error
		username, password, err = device.DecryptCredentials(legacyCiphertext, c.legacy)
		if err != nil {
			return "", "", fmt.Errorf("legacy decrypt for device %s: %w", deviceID, err)
		}
		LegacyDecrypts.Inc()

	} else {
		return "", "", fmt.Errorf("no credentials available for device %s", deviceID)
	}

	// Cache the result
	c.cache.Add(deviceID, &CachedCreds{Username: username, Password: password})

	slog.Debug("credential decrypted and cached",
		"device_id", deviceID,
		"source", func() string {
			if transitCiphertext != nil && *transitCiphertext != "" {
				return "transit"
			}
			return "legacy"
		}(),
	)

	return username, password, nil
}

// Invalidate removes a device's cached credentials (e.g., after credential rotation).
func (c *CredentialCache) Invalidate(deviceID string) {
	c.cache.Remove(deviceID)
}

// Len returns the number of cached entries.
func (c *CredentialCache) Len() int {
	return c.cache.Len()
}

// logKeyAccess inserts an immutable audit record for a credential decryption event.
// Called as a fire-and-forget goroutine to avoid slowing down the poll cycle.
func (c *CredentialCache) logKeyAccess(deviceID, tenantID, action, justification string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	correlationID := uuid.New().String()
	_, err := c.db.Exec(ctx,
		`INSERT INTO key_access_log (tenant_id, device_id, action, resource_type, justification, correlation_id)
		 VALUES ($1::uuid, $2::uuid, $3, 'device_credentials', $4, $5)`,
		tenantID, deviceID, action, justification, correlationID,
	)
	if err != nil {
		slog.Warn("failed to log key access", "error", err, "device_id", deviceID)
	}
}
