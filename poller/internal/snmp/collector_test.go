package snmp

import (
	"context"
	"testing"

	"github.com/staack/the-other-dude/poller/internal/bus"
	poller "github.com/staack/the-other-dude/poller/internal/poller"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSNMPCollectorImplementsCollector is a compile-time interface assertion
// that SNMPCollector satisfies the poller.Collector interface.
func TestSNMPCollectorImplementsCollector(t *testing.T) {
	// This test verifies the compile-time assertion in collector.go.
	// If this compiles, SNMPCollector satisfies the Collector interface.
	var _ poller.Collector = (*SNMPCollector)(nil)
}

// TestSNMPCollectorCollect_NilProfileID verifies that Collect returns an error
// when the device has no SNMPProfileID and the profile cache is nil.
func TestSNMPCollectorCollect_NilProfileID(t *testing.T) {
	collector := NewSNMPCollector(nil, nil, nil, DefaultSNMPConfig())
	dev := store.Device{
		ID:            "test-device-001",
		TenantID:      "test-tenant-001",
		DeviceType:    "snmp",
		SNMPProfileID: nil, // no profile
	}

	err := collector.Collect(context.Background(), dev, &bus.Publisher{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no SNMP profile assigned")
}

// TestSNMPCollectorCollect_UnknownProfileID verifies that Collect returns an error
// when the device's profile ID is not found in the ProfileCache.
func TestSNMPCollectorCollect_UnknownProfileID(t *testing.T) {
	// Create a ProfileCache with no loaded profiles.
	profiles := &ProfileCache{
		profiles: make(map[string]*CompiledProfile),
	}

	collector := NewSNMPCollector(profiles, nil, nil, DefaultSNMPConfig())
	unknownID := "nonexistent-profile-uuid"
	dev := store.Device{
		ID:            "test-device-002",
		TenantID:      "test-tenant-001",
		DeviceType:    "snmp",
		SNMPProfileID: &unknownID,
	}

	err := collector.Collect(context.Background(), dev, &bus.Publisher{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "profile not found")
}

// TestSNMPCollectorNewCreatesInstance verifies NewSNMPCollector returns a properly
// initialized struct with all dependencies set.
func TestSNMPCollectorNewCreatesInstance(t *testing.T) {
	cfg := DefaultSNMPConfig()
	collector := NewSNMPCollector(nil, nil, nil, cfg)
	require.NotNil(t, collector)
	assert.Equal(t, cfg.MaxRepetitions, collector.cfg.MaxRepetitions)
}
