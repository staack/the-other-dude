package device

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	routeros "github.com/go-routeros/routeros/v3"
)

// InterfaceStats holds the traffic counters for a single RouterOS interface.
type InterfaceStats struct {
	Name    string `json:"name"`
	RxBytes int64  `json:"rx_bytes"`
	TxBytes int64  `json:"tx_bytes"`
	Running bool   `json:"running"`
	Type    string `json:"type"`
}

// CollectInterfaces queries the RouterOS device for per-interface traffic
// counters via /interface/print.
//
// Returns a slice of InterfaceStats. On error, returns an empty slice and the
// error — the caller decides whether to skip the device or log a warning.
func CollectInterfaces(client *routeros.Client) ([]InterfaceStats, error) {
	reply, err := client.Run(
		"/interface/print",
		"=.proplist=name,rx-byte,tx-byte,running,type",
	)
	if err != nil {
		return nil, fmt.Errorf("running /interface/print: %w", err)
	}

	stats := make([]InterfaceStats, 0, len(reply.Re))
	for _, sentence := range reply.Re {
		m := sentence.Map

		rxBytes, err := strconv.ParseInt(m["rx-byte"], 10, 64)
		if err != nil {
			slog.Warn("could not parse rx-byte for interface", "interface", m["name"], "value", m["rx-byte"])
			rxBytes = 0
		}

		txBytes, err := strconv.ParseInt(m["tx-byte"], 10, 64)
		if err != nil {
			slog.Warn("could not parse tx-byte for interface", "interface", m["name"], "value", m["tx-byte"])
			txBytes = 0
		}

		stats = append(stats, InterfaceStats{
			Name:    m["name"],
			RxBytes: rxBytes,
			TxBytes: txBytes,
			Running: m["running"] == "true",
			Type:    m["type"],
		})
	}

	return stats, nil
}

// InterfaceInfo holds basic interface identity data from a RouterOS device.
// This is used for link discovery — MAC addresses identify which device owns
// each end of a network link.
type InterfaceInfo struct {
	Name       string `json:"name"`
	MacAddress string `json:"mac_address"`
	Type       string `json:"type"`
	Running    bool   `json:"running"`
}

// normalizeMACAddress lowercases a MAC address for consistent matching.
func normalizeMACAddress(mac string) string {
	return strings.ToLower(mac)
}

// parseRunning converts a RouterOS "true"/"false" string to a Go bool.
func parseRunning(s string) bool {
	return s == "true"
}

// CollectInterfaceInfo queries the RouterOS device for all interfaces and
// returns their name, MAC address, type, and running status.
//
// The /interface/print command is version-agnostic (works on both v6 and v7).
// Entries with an empty mac-address (loopback, bridge without MAC) are skipped.
//
// Returns nil, nil when the device has no interfaces (matching the
// CollectWireless pattern — empty result is not an error).
func CollectInterfaceInfo(client *routeros.Client) ([]InterfaceInfo, error) {
	reply, err := client.Run("/interface/print")
	if err != nil {
		slog.Debug("failed to collect interface info", "error", err)
		return nil, nil
	}

	if len(reply.Re) == 0 {
		return nil, nil
	}

	result := make([]InterfaceInfo, 0, len(reply.Re))
	for _, s := range reply.Re {
		m := s.Map
		mac := m["mac-address"]
		if mac == "" {
			continue
		}

		result = append(result, InterfaceInfo{
			Name:       m["name"],
			MacAddress: normalizeMACAddress(mac),
			Type:       m["type"],
			Running:    parseRunning(m["running"]),
		})
	}

	if len(result) == 0 {
		return nil, nil
	}

	return result, nil
}
