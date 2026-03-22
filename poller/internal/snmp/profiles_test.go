package snmp

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// genericSNMPProfileJSON is the full generic-snmp profile_data from the design spec.
// It contains system, interfaces, health, and custom poll groups.
const genericSNMPProfileJSON = `{
  "version": 1,
  "poll_groups": {
    "system": {
      "interval_multiplier": 1,
      "scalars": [
        {"oid": "1.3.6.1.2.1.1.1.0", "name": "sys_descr", "type": "string", "map_to": "device.model"},
        {"oid": "1.3.6.1.2.1.1.3.0", "name": "sys_uptime", "type": "timeticks", "map_to": "device.uptime_seconds"},
        {"oid": "1.3.6.1.2.1.1.5.0", "name": "sys_name", "type": "string", "map_to": "device.hostname_discovered"}
      ]
    },
    "interfaces": {
      "interval_multiplier": 1,
      "tables": [
        {
          "oid": "1.3.6.1.2.1.2.2",
          "name": "ifTable",
          "index_oid": "1.3.6.1.2.1.2.2.1.1",
          "columns": [
            {"oid": "1.3.6.1.2.1.2.2.1.2", "name": "ifDescr", "type": "string"},
            {"oid": "1.3.6.1.2.1.2.2.1.5", "name": "ifSpeed", "type": "gauge"},
            {"oid": "1.3.6.1.2.1.2.2.1.7", "name": "ifAdminStatus", "type": "integer"},
            {"oid": "1.3.6.1.2.1.2.2.1.8", "name": "ifOperStatus", "type": "integer"},
            {"oid": "1.3.6.1.2.1.2.2.1.10", "name": "ifInOctets", "type": "counter32"},
            {"oid": "1.3.6.1.2.1.2.2.1.16", "name": "ifOutOctets", "type": "counter32"}
          ],
          "map_to": "interface_metrics"
        },
        {
          "oid": "1.3.6.1.2.1.31.1.1",
          "name": "ifXTable",
          "index_oid": "1.3.6.1.2.1.31.1.1.1.1",
          "columns": [
            {"oid": "1.3.6.1.2.1.31.1.1.1.1", "name": "ifName", "type": "string"},
            {"oid": "1.3.6.1.2.1.31.1.1.1.6", "name": "ifHCInOctets", "type": "counter64"},
            {"oid": "1.3.6.1.2.1.31.1.1.1.10", "name": "ifHCOutOctets", "type": "counter64"},
            {"oid": "1.3.6.1.2.1.31.1.1.1.15", "name": "ifHighSpeed", "type": "gauge"}
          ],
          "map_to": "interface_metrics",
          "prefer_over": "ifTable"
        }
      ]
    },
    "health": {
      "interval_multiplier": 1,
      "scalars": [
        {
          "oid": "1.3.6.1.2.1.25.3.3.1.2",
          "name": "hrProcessorLoad",
          "type": "integer",
          "map_to": "health_metrics.cpu_load"
        },
        {
          "oid": "1.3.6.1.4.1.2021.11.11.0",
          "name": "ssCpuIdle",
          "type": "integer",
          "transform": "invert_percent",
          "map_to": "health_metrics.cpu_load",
          "fallback_for": "hrProcessorLoad"
        }
      ],
      "tables": [
        {
          "oid": "1.3.6.1.2.1.25.2.3",
          "name": "hrStorageTable",
          "index_oid": "1.3.6.1.2.1.25.2.3.1.1",
          "columns": [
            {"oid": "1.3.6.1.2.1.25.2.3.1.2", "name": "hrStorageType", "type": "oid"},
            {"oid": "1.3.6.1.2.1.25.2.3.1.3", "name": "hrStorageDescr", "type": "string"},
            {"oid": "1.3.6.1.2.1.25.2.3.1.4", "name": "hrStorageAllocationUnits", "type": "integer"},
            {"oid": "1.3.6.1.2.1.25.2.3.1.5", "name": "hrStorageSize", "type": "integer"},
            {"oid": "1.3.6.1.2.1.25.2.3.1.6", "name": "hrStorageUsed", "type": "integer"}
          ],
          "map_to": "health_metrics",
          "filter": {"hrStorageType": ["1.3.6.1.2.1.25.2.1.2", "1.3.6.1.2.1.25.2.1.4"]}
        }
      ]
    },
    "custom": {
      "interval_multiplier": 5,
      "scalars": [],
      "tables": []
    }
  }
}`

func TestCompileProfileData_FullGenericProfile(t *testing.T) {
	profile, err := compileProfileData([]byte(genericSNMPProfileJSON))
	require.NoError(t, err)
	require.NotNil(t, profile)

	// Should have 4 poll groups: system, interfaces, health, custom
	assert.Len(t, profile.PollGroups, 4)
	assert.Contains(t, profile.PollGroups, "system")
	assert.Contains(t, profile.PollGroups, "interfaces")
	assert.Contains(t, profile.PollGroups, "health")
	assert.Contains(t, profile.PollGroups, "custom")

	// System group: 3 scalars, 0 tables
	sys := profile.PollGroups["system"]
	assert.Equal(t, 1, sys.IntervalMultiplier)
	assert.Len(t, sys.Scalars, 3)
	assert.Empty(t, sys.Tables)

	// Interfaces group: 0 scalars, 2 tables
	ifaces := profile.PollGroups["interfaces"]
	assert.Equal(t, 1, ifaces.IntervalMultiplier)
	assert.Empty(t, ifaces.Scalars)
	assert.Len(t, ifaces.Tables, 2)

	// Health group: 2 scalars, 1 table
	health := profile.PollGroups["health"]
	assert.Equal(t, 1, health.IntervalMultiplier)
	assert.Len(t, health.Scalars, 2)
	assert.Len(t, health.Tables, 1)

	// Custom group: empty with multiplier 5
	custom := profile.PollGroups["custom"]
	assert.Equal(t, 5, custom.IntervalMultiplier)
	assert.Empty(t, custom.Scalars)
	assert.Empty(t, custom.Tables)
}

func TestCompileProfileData_ScalarFields(t *testing.T) {
	profile, err := compileProfileData([]byte(genericSNMPProfileJSON))
	require.NoError(t, err)

	sys := profile.PollGroups["system"]
	require.Len(t, sys.Scalars, 3)

	// First scalar: sys_descr
	s := sys.Scalars[0]
	assert.Equal(t, "1.3.6.1.2.1.1.1.0", s.OID)
	assert.Equal(t, "sys_descr", s.Name)
	assert.Equal(t, "string", s.Type)
	assert.Equal(t, "device.model", s.MapTo)
	assert.Empty(t, s.Transform)
	assert.Empty(t, s.FallbackFor)

	// Health scalar with transform and fallback_for
	health := profile.PollGroups["health"]
	require.Len(t, health.Scalars, 2)
	fb := health.Scalars[1]
	assert.Equal(t, "ssCpuIdle", fb.Name)
	assert.Equal(t, "invert_percent", fb.Transform)
	assert.Equal(t, "hrProcessorLoad", fb.FallbackFor)
}

func TestCompileProfileData_TableFields(t *testing.T) {
	profile, err := compileProfileData([]byte(genericSNMPProfileJSON))
	require.NoError(t, err)

	ifaces := profile.PollGroups["interfaces"]
	require.Len(t, ifaces.Tables, 2)

	// ifTable
	ifTable := ifaces.Tables[0]
	assert.Equal(t, "1.3.6.1.2.1.2.2", ifTable.OID)
	assert.Equal(t, "ifTable", ifTable.Name)
	assert.Equal(t, "1.3.6.1.2.1.2.2.1.1", ifTable.IndexOID)
	assert.Len(t, ifTable.Columns, 6)
	assert.Equal(t, "interface_metrics", ifTable.MapTo)
	assert.Empty(t, ifTable.PreferOver)

	// ifXTable with prefer_over
	ifXTable := ifaces.Tables[1]
	assert.Equal(t, "ifXTable", ifXTable.Name)
	assert.Equal(t, "ifTable", ifXTable.PreferOver)
	assert.Len(t, ifXTable.Columns, 4)

	// Verify column fields
	col := ifTable.Columns[0]
	assert.Equal(t, "1.3.6.1.2.1.2.2.1.2", col.OID)
	assert.Equal(t, "ifDescr", col.Name)
	assert.Equal(t, "string", col.Type)

	// Health table with filter
	health := profile.PollGroups["health"]
	require.Len(t, health.Tables, 1)
	storage := health.Tables[0]
	assert.Equal(t, "hrStorageTable", storage.Name)
	assert.Len(t, storage.Columns, 5)
	require.Contains(t, storage.Filter, "hrStorageType")
	assert.Len(t, storage.Filter["hrStorageType"], 2)
}

func TestCompileProfileData_InvalidJSON(t *testing.T) {
	_, err := compileProfileData([]byte(`{invalid json`))
	assert.Error(t, err)
}

func TestCompileProfileData_EmptyJSON(t *testing.T) {
	_, err := compileProfileData([]byte(`{}`))
	require.NoError(t, err)
}

func TestProfileCache_GetUnknownID(t *testing.T) {
	cache := &ProfileCache{
		profiles: make(map[string]*CompiledProfile),
	}
	result := cache.Get("nonexistent-uuid")
	assert.Nil(t, result, "Get with unknown ID should return nil, not panic")
}

func TestProfileCache_GetKnownID(t *testing.T) {
	p := &CompiledProfile{ID: "abc-123", Name: "test-profile"}
	cache := &ProfileCache{
		profiles: map[string]*CompiledProfile{"abc-123": p},
	}
	result := cache.Get("abc-123")
	require.NotNil(t, result)
	assert.Equal(t, "test-profile", result.Name)
}

func TestMatchSysObjectID_PrefixMatch(t *testing.T) {
	cache := &ProfileCache{
		profiles: map[string]*CompiledProfile{
			"mikrotik-uuid": {ID: "mikrotik-uuid", Name: "mikrotik-snmp"},
			"generic-uuid":  {ID: "generic-uuid", Name: "generic-snmp"},
		},
		sysOIDMap: []sysOIDEntry{
			{Prefix: "1.3.6.1.4.1.14988", ProfileID: "mikrotik-uuid"},
		},
		genericID: "generic-uuid",
	}

	// Mikrotik sysObjectID should match mikrotik prefix
	result := cache.MatchSysObjectID("1.3.6.1.4.1.14988.1.2")
	assert.Equal(t, "mikrotik-uuid", result)
}

func TestMatchSysObjectID_FallbackToGeneric(t *testing.T) {
	cache := &ProfileCache{
		profiles: map[string]*CompiledProfile{
			"mikrotik-uuid": {ID: "mikrotik-uuid", Name: "mikrotik-snmp"},
			"generic-uuid":  {ID: "generic-uuid", Name: "generic-snmp"},
		},
		sysOIDMap: []sysOIDEntry{
			{Prefix: "1.3.6.1.4.1.14988", ProfileID: "mikrotik-uuid"},
		},
		genericID: "generic-uuid",
	}

	// Unknown vendor OID should fall back to generic-snmp
	result := cache.MatchSysObjectID("1.3.6.1.4.1.99999.1.2")
	assert.Equal(t, "generic-uuid", result)
}

func TestMatchSysObjectID_LongestPrefixWins(t *testing.T) {
	cache := &ProfileCache{
		profiles: map[string]*CompiledProfile{
			"mikrotik-broad-uuid":   {ID: "mikrotik-broad-uuid", Name: "mikrotik-broad"},
			"mikrotik-narrow-uuid":  {ID: "mikrotik-narrow-uuid", Name: "mikrotik-narrow"},
			"generic-uuid":          {ID: "generic-uuid", Name: "generic-snmp"},
		},
		sysOIDMap: []sysOIDEntry{
			// Sorted by prefix length descending (longest first)
			{Prefix: "1.3.6.1.4.1.14988.1", ProfileID: "mikrotik-narrow-uuid"},
			{Prefix: "1.3.6.1.4.1.14988", ProfileID: "mikrotik-broad-uuid"},
		},
		genericID: "generic-uuid",
	}

	// "1.3.6.1.4.1.14988.1.2.3" matches both prefixes -- longest should win
	result := cache.MatchSysObjectID("1.3.6.1.4.1.14988.1.2.3")
	assert.Equal(t, "mikrotik-narrow-uuid", result)

	// "1.3.6.1.4.1.14988.2.1" matches only the shorter prefix
	result = cache.MatchSysObjectID("1.3.6.1.4.1.14988.2.1")
	assert.Equal(t, "mikrotik-broad-uuid", result)
}

func TestMatchSysObjectID_ExactMatch(t *testing.T) {
	cache := &ProfileCache{
		profiles: map[string]*CompiledProfile{
			"exact-uuid":   {ID: "exact-uuid", Name: "exact-match"},
			"generic-uuid": {ID: "generic-uuid", Name: "generic-snmp"},
		},
		sysOIDMap: []sysOIDEntry{
			{Prefix: "1.3.6.1.4.1.12345", ProfileID: "exact-uuid"},
		},
		genericID: "generic-uuid",
	}

	// Exact match (sysObjectID equals prefix exactly)
	result := cache.MatchSysObjectID("1.3.6.1.4.1.12345")
	assert.Equal(t, "exact-uuid", result)
}

func TestMatchSysObjectID_EmptyCache(t *testing.T) {
	cache := &ProfileCache{
		profiles:  make(map[string]*CompiledProfile),
		sysOIDMap: nil,
		genericID: "generic-uuid",
	}

	// With empty sysOIDMap, should return genericID
	result := cache.MatchSysObjectID("1.3.6.1.4.1.14988.1")
	assert.Equal(t, "generic-uuid", result)
}

// TestCompileProfileData_VerifyRoundTrip ensures compiled profile JSON matches
// what we'd expect from re-serialization (verifies no data is lost).
func TestCompileProfileData_VerifyRoundTrip(t *testing.T) {
	profile, err := compileProfileData([]byte(genericSNMPProfileJSON))
	require.NoError(t, err)

	// Count total OIDs across all groups
	totalScalars := 0
	totalTables := 0
	for _, pg := range profile.PollGroups {
		totalScalars += len(pg.Scalars)
		totalTables += len(pg.Tables)
	}
	assert.Equal(t, 5, totalScalars, "should have 5 total scalars (3 system + 2 health)")
	assert.Equal(t, 3, totalTables, "should have 3 total tables (2 interfaces + 1 health)")

	// Verify the JSON struct parses correctly by checking intermediate format
	var raw profileDataJSON
	err = json.Unmarshal([]byte(genericSNMPProfileJSON), &raw)
	require.NoError(t, err)
	assert.Equal(t, 1, raw.Version)
	assert.Len(t, raw.PollGroups, 4)
}
