package snmp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// JSON deserialization types for profile_data JSONB column.
type profileDataJSON struct {
	Version    int                      `json:"version"`
	PollGroups map[string]pollGroupJSON `json:"poll_groups"`
}

type pollGroupJSON struct {
	IntervalMultiplier int              `json:"interval_multiplier"`
	Scalars            []scalarOIDJSON  `json:"scalars"`
	Tables             []tableOIDJSON   `json:"tables"`
}

type scalarOIDJSON struct {
	OID         string `json:"oid"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	MapTo       string `json:"map_to"`
	Transform   string `json:"transform,omitempty"`
	FallbackFor string `json:"fallback_for,omitempty"`
}

type tableOIDJSON struct {
	OID        string              `json:"oid"`
	Name       string              `json:"name"`
	IndexOID   string              `json:"index_oid"`
	Columns    []columnOIDJSON     `json:"columns"`
	MapTo      string              `json:"map_to"`
	PreferOver string              `json:"prefer_over,omitempty"`
	Filter     map[string][]string `json:"filter,omitempty"`
}

type columnOIDJSON struct {
	OID  string `json:"oid"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// sysOIDEntry maps a sysObjectID prefix to a profile UUID.
type sysOIDEntry struct {
	Prefix    string
	ProfileID string
}

// ProfileCache caches compiled SNMP profiles in memory with periodic DB refresh.
// Profile lookup by ID is O(1). sysObjectID matching uses longest-prefix-first.
type ProfileCache struct {
	mu        sync.RWMutex
	profiles  map[string]*CompiledProfile // keyed by profile UUID
	sysOIDMap []sysOIDEntry              // sorted by prefix length desc
	genericID string                      // UUID of generic-snmp (fallback)
	refreshAt time.Duration
	db        *pgxpool.Pool
}

// NewProfileCache creates a ProfileCache that refreshes from the database
// at the given interval. Call Load to perform the initial load, then
// StartRefresh to begin the background refresh goroutine.
func NewProfileCache(db *pgxpool.Pool, refreshInterval time.Duration) *ProfileCache {
	return &ProfileCache{
		profiles:  make(map[string]*CompiledProfile),
		refreshAt: refreshInterval,
		db:        db,
	}
}

// Load queries all SNMP profiles from the database, compiles their JSONB
// profile_data into typed Go structs, and replaces the in-memory cache
// atomically under a write lock.
func (c *ProfileCache) Load(ctx context.Context) error {
	const query = `SELECT id::text, name, sys_object_id, profile_data FROM snmp_profiles`

	rows, err := c.db.Query(ctx, query)
	if err != nil {
		return fmt.Errorf("querying snmp_profiles: %w", err)
	}
	defer rows.Close()

	profiles := make(map[string]*CompiledProfile)
	var entries []sysOIDEntry
	var genericID string

	for rows.Next() {
		var (
			id          string
			name        string
			sysObjectID *string
			profileData []byte
		)
		if err := rows.Scan(&id, &name, &sysObjectID, &profileData); err != nil {
			return fmt.Errorf("scanning snmp_profiles row: %w", err)
		}

		compiled, err := compileProfileData(profileData)
		if err != nil {
			slog.Warn("skipping profile with invalid profile_data",
				"profile_id", id, "name", name, "error", err)
			continue
		}
		compiled.ID = id
		compiled.Name = name
		profiles[id] = compiled

		if sysObjectID != nil && *sysObjectID != "" {
			entries = append(entries, sysOIDEntry{
				Prefix:    *sysObjectID,
				ProfileID: id,
			})
		}

		if name == "generic-snmp" {
			genericID = id
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterating snmp_profiles rows: %w", err)
	}

	// Sort sysOIDMap by prefix length descending for longest-prefix-first matching.
	sort.Slice(entries, func(i, j int) bool {
		return len(entries[i].Prefix) > len(entries[j].Prefix)
	})

	// Atomically replace the cache under write lock.
	c.mu.Lock()
	c.profiles = profiles
	c.sysOIDMap = entries
	c.genericID = genericID
	c.mu.Unlock()

	slog.Info("profile cache loaded", "profiles", len(profiles), "sysoid_entries", len(entries))
	return nil
}

// Get returns the compiled profile for the given UUID, or nil if not found.
// Lookup is O(1) from the in-memory map.
func (c *ProfileCache) Get(profileID string) *CompiledProfile {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.profiles[profileID]
}

// GetGenericID returns the profile ID of the generic-snmp fallback profile.
func (c *ProfileCache) GetGenericID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.genericID
}

// MatchSysObjectID finds the best profile for a device's sysObjectID value
// using longest-prefix matching. Returns the generic-snmp profile ID if
// no vendor-specific prefix matches.
func (c *ProfileCache) MatchSysObjectID(sysObjectID string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	for _, entry := range c.sysOIDMap {
		if strings.HasPrefix(sysObjectID, entry.Prefix) {
			return entry.ProfileID
		}
	}
	return c.genericID
}

// StartRefresh runs a background goroutine that reloads the profile cache
// from the database at the configured interval. It logs errors but does not
// stop on failure. Returns when ctx is cancelled.
func (c *ProfileCache) StartRefresh(ctx context.Context) {
	ticker := time.NewTicker(c.refreshAt)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.Load(ctx); err != nil {
				slog.Error("profile cache refresh failed", "error", err)
			}
		}
	}
}

// compileProfileData parses raw JSONB profile_data into a CompiledProfile.
// The ID and Name fields are NOT set here -- the caller populates them from
// the database row.
func compileProfileData(raw []byte) (*CompiledProfile, error) {
	var data profileDataJSON
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("unmarshalling profile_data: %w", err)
	}

	profile := &CompiledProfile{
		PollGroups: make(map[string]*PollGroup, len(data.PollGroups)),
	}

	for groupName, groupJSON := range data.PollGroups {
		pg := &PollGroup{
			IntervalMultiplier: groupJSON.IntervalMultiplier,
			Scalars:            make([]ScalarOID, len(groupJSON.Scalars)),
			Tables:             make([]TableOID, len(groupJSON.Tables)),
		}

		for i, s := range groupJSON.Scalars {
			pg.Scalars[i] = ScalarOID{
				OID:         s.OID,
				Name:        s.Name,
				Type:        s.Type,
				MapTo:       s.MapTo,
				Transform:   s.Transform,
				FallbackFor: s.FallbackFor,
			}
		}

		for i, t := range groupJSON.Tables {
			cols := make([]ColumnOID, len(t.Columns))
			for j, c := range t.Columns {
				cols[j] = ColumnOID{
					OID:  c.OID,
					Name: c.Name,
					Type: c.Type,
				}
			}
			pg.Tables[i] = TableOID{
				OID:        t.OID,
				Name:       t.Name,
				IndexOID:   t.IndexOID,
				Columns:    cols,
				MapTo:      t.MapTo,
				PreferOver: t.PreferOver,
				Filter:     t.Filter,
			}
		}

		profile.PollGroups[groupName] = pg
	}

	return profile, nil
}
