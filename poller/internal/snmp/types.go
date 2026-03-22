// Package snmp provides SNMP collection primitives for the poller.
package snmp

import "time"

// SNMPConfig holds SNMP client configuration defaults.
type SNMPConfig struct {
	Timeout        time.Duration
	Retries        int
	MaxRepetitions uint32
	ConnTimeout    time.Duration
	CmdTimeout     time.Duration
}

// DefaultSNMPConfig returns sensible SNMP defaults.
func DefaultSNMPConfig() SNMPConfig {
	return SNMPConfig{
		Timeout:        5 * time.Second,
		Retries:        1,
		MaxRepetitions: 10,
		ConnTimeout:    5 * time.Second,
		CmdTimeout:     10 * time.Second,
	}
}

// CompiledProfile is an in-memory representation of an snmp_profiles row
// with its JSONB profile_data parsed into typed Go structs.
type CompiledProfile struct {
	ID         string
	Name       string
	PollGroups map[string]*PollGroup
}

// PollGroup is a named collection of OIDs polled at a specific interval multiplier.
type PollGroup struct {
	IntervalMultiplier int
	Scalars            []ScalarOID
	Tables             []TableOID
}

// ScalarOID describes a single scalar SNMP object to poll.
type ScalarOID struct {
	OID         string
	Name        string
	Type        string
	MapTo       string
	Transform   string
	FallbackFor string
}

// TableOID describes an SNMP table to walk.
type TableOID struct {
	OID        string
	Name       string
	IndexOID   string
	Columns    []ColumnOID
	MapTo      string
	PreferOver string
	Filter     map[string][]string
}

// ColumnOID describes a single column within a table walk.
type ColumnOID struct {
	OID  string
	Name string
	Type string
}
