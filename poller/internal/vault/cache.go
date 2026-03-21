package vault

import (
	"context"
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
// It uses LRU caches with TTL to avoid redundant OpenBao calls and falls back
// to legacy AES-256-GCM decryption for credentials not yet migrated to Transit.
//
// Two caches are maintained:
//   - cache: parsed RouterOS credentials (CachedCreds) for backward compatibility
//   - rawCache: raw decrypted JSON bytes for type-agnostic credential access
type CredentialCache struct {
	cache    *expirable.LRU[string, *CachedCreds]
	rawCache *expirable.LRU[string, []byte] // raw decrypted credential JSON bytes
	transit  *TransitClient
	legacy   []byte       // legacy AES-256-GCM key (nil if not available)
	db       *pgxpool.Pool // for key_access_log inserts (nil if not available)
}

// NewCredentialCache creates a bounded LRU cache with the given size and TTL.
// transit may be nil if OpenBao is not configured. legacyKey may be nil if not available.
// db may be nil if key access logging is not needed.
func NewCredentialCache(size int, ttl time.Duration, transit *TransitClient, legacyKey []byte, db *pgxpool.Pool) *CredentialCache {
	cache := expirable.NewLRU[string, *CachedCreds](size, nil, ttl)
	rawCache := expirable.NewLRU[string, []byte](size, nil, ttl)
	return &CredentialCache{
		cache:    cache,
		rawCache: rawCache,
		transit:  transit,
		legacy:   legacyKey,
		db:       db,
	}
}

// GetRawCredentials returns raw decrypted credential JSON bytes for a device.
// It resolves credentials using the fallback chain:
//  1. Per-device transitCiphertext (highest priority)
//  2. Per-device legacyCiphertext
//  3. Profile transitCiphertext (from credential_profiles via FetchDevices JOIN)
//  4. Profile legacyCiphertext
//
// The cache key includes the source to prevent poisoning when a device
// switches from per-device to profile credentials.
func (c *CredentialCache) GetRawCredentials(
	deviceID, tenantID string,
	transitCiphertext *string,
	legacyCiphertext []byte,
	profileTransitCiphertext *string,
	profileLegacyCiphertext []byte,
) ([]byte, error) {

	// Determine which ciphertext source to use and the source label.
	var activeTransit *string
	var activeLegacy []byte
	var source string

	if transitCiphertext != nil && *transitCiphertext != "" && strings.HasPrefix(*transitCiphertext, "vault:v") {
		activeTransit = transitCiphertext
		source = "device"
	} else if len(legacyCiphertext) > 0 {
		activeLegacy = legacyCiphertext
		source = "device"
	} else if profileTransitCiphertext != nil && *profileTransitCiphertext != "" && strings.HasPrefix(*profileTransitCiphertext, "vault:v") {
		activeTransit = profileTransitCiphertext
		source = "profile"
	} else if len(profileLegacyCiphertext) > 0 {
		activeLegacy = profileLegacyCiphertext
		source = "profile"
	} else {
		return nil, fmt.Errorf("no credentials available for device %s", deviceID)
	}

	// Cache key includes source to prevent poisoning across device/profile switch.
	cacheKey := "raw:" + deviceID + ":" + source

	// Check raw cache first.
	if cached, ok := c.rawCache.Get(cacheKey); ok {
		CacheHits.Inc()
		return cached, nil
	}
	CacheMisses.Inc()

	var raw []byte

	// Decrypt using the selected ciphertext source.
	if activeTransit != nil {
		if c.transit == nil {
			return nil, fmt.Errorf("transit ciphertext present but OpenBao client not configured")
		}

		start := time.Now()
		plaintext, err := c.transit.Decrypt(tenantID, *activeTransit)
		OpenBaoLatency.Observe(time.Since(start).Seconds())

		if err != nil {
			return nil, fmt.Errorf("transit decrypt for device %s (%s): %w", deviceID, source, err)
		}
		raw = plaintext

		// Fire-and-forget key access log INSERT for audit trail.
		if c.db != nil {
			go c.logKeyAccess(deviceID, tenantID, "decrypt_credentials", "poller_poll")
		}

	} else if len(activeLegacy) > 0 {
		if c.legacy == nil {
			return nil, fmt.Errorf("legacy ciphertext present but encryption key not configured")
		}

		plaintext, err := device.DecryptRaw(activeLegacy, c.legacy)
		if err != nil {
			return nil, fmt.Errorf("legacy decrypt for device %s (%s): %w", deviceID, source, err)
		}
		raw = plaintext
		LegacyDecrypts.Inc()
	}

	// Cache the raw bytes.
	c.rawCache.Add(cacheKey, raw)

	slog.Debug("credential decrypted and cached (raw)",
		"device_id", deviceID,
		"source", source,
	)

	return raw, nil
}

// GetCredentials returns decrypted RouterOS credentials for a device, using the cache.
// This is a backward-compatible wrapper around GetRawCredentials that maintains the
// original (username, password, error) return signature. All existing callers
// (PollDevice, CmdResponder, TunnelResponder, BackupResponder, SSHRelay) continue
// to work without changes.
//
// transitCiphertext is the Transit-encrypted string (nullable),
// legacyCiphertext is the legacy BYTEA (nullable).
func (c *CredentialCache) GetCredentials(
	deviceID, tenantID string,
	transitCiphertext *string,
	legacyCiphertext []byte,
) (string, string, error) {
	raw, err := c.GetRawCredentials(deviceID, tenantID, transitCiphertext, legacyCiphertext, nil, nil)
	if err != nil {
		return "", "", err
	}
	return ParseRouterOSCredentials(raw)
}

// Invalidate removes a device's cached credentials (e.g., after credential rotation).
// Clears both the parsed credential cache and the raw credential cache.
func (c *CredentialCache) Invalidate(deviceID string) {
	c.cache.Remove(deviceID)
	// Clear all raw cache entries for this device (both device and profile sources).
	c.rawCache.Remove("raw:" + deviceID + ":device")
	c.rawCache.Remove("raw:" + deviceID + ":profile")
}

// Len returns the number of cached entries in the raw credential cache.
func (c *CredentialCache) Len() int {
	return c.rawCache.Len()
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
