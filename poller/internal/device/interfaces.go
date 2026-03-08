// Package device provides RouterOS metric collectors for the poller.
package device

import (
	"fmt"
	"log/slog"
	"strconv"

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
