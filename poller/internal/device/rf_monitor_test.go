package device

import (
	"testing"
)

func TestRFMonitorStatsFields(t *testing.T) {
	// Compilation test: ensure RFMonitorStats has all required fields
	// with correct types.
	stats := RFMonitorStats{
		Interface:         "wlan1",
		NoiseFloor:        -105,
		ChannelWidth:      "20MHz",
		TxPower:           24,
		RegisteredClients: 15,
	}
	if stats.Interface != "wlan1" {
		t.Error("Interface field not set correctly")
	}
	if stats.NoiseFloor != -105 {
		t.Error("NoiseFloor field not set correctly")
	}
	if stats.ChannelWidth != "20MHz" {
		t.Error("ChannelWidth field not set correctly")
	}
	if stats.TxPower != 24 {
		t.Error("TxPower field not set correctly")
	}
	if stats.RegisteredClients != 15 {
		t.Error("RegisteredClients field not set correctly")
	}
}
