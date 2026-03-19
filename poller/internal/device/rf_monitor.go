package device

import (
	"log/slog"
	"strconv"

	routeros "github.com/go-routeros/routeros/v3"
)

// RFMonitorStats holds per-interface RF monitoring data collected from
// the RouterOS monitor command. These stats describe the RF environment
// rather than individual clients.
type RFMonitorStats struct {
	Interface         string `json:"interface"`
	NoiseFloor        int    `json:"noise_floor"`         // dBm, e.g. -105
	ChannelWidth      string `json:"channel_width"`       // e.g. "20MHz", "40MHz"
	TxPower           int    `json:"tx_power"`            // dBm, e.g. 24
	RegisteredClients int    `json:"registered_clients"`  // count from monitor
}

// CollectRFMonitor queries the RouterOS device for per-interface RF statistics
// using the monitor command.
//
// Version routing:
//   - majorVersion >= 7: runs /interface/wifi/print to list interfaces, then
//     /interface/wifi/monitor for each interface.
//   - majorVersion < 7: runs /interface/wireless/print to list interfaces,
//     then /interface/wireless/monitor for each interface.
//
// Returns nil, nil when the device has no wireless interfaces.
func CollectRFMonitor(client *routeros.Client, majorVersion int) ([]RFMonitorStats, error) {
	var printCmd, monitorCmd string

	if majorVersion >= 7 {
		printCmd = "/interface/wifi/print"
		monitorCmd = "/interface/wifi/monitor"
	} else {
		printCmd = "/interface/wireless/print"
		monitorCmd = "/interface/wireless/monitor"
	}

	// List wireless interface names.
	listReply, err := client.Run(printCmd, "=.proplist=name")
	if err != nil {
		slog.Debug("device has no wireless interfaces for RF monitor", "error", err)
		return nil, nil
	}

	if len(listReply.Re) == 0 {
		return nil, nil
	}

	stats := make([]RFMonitorStats, 0, len(listReply.Re))
	for _, s := range listReply.Re {
		ifaceName := s.Map["name"]
		if ifaceName == "" {
			continue
		}

		// Run monitor command for this interface.
		monReply, monErr := client.Run(monitorCmd, "=numbers="+ifaceName, "=once=")
		if monErr != nil {
			slog.Debug("RF monitor command failed for interface",
				"interface", ifaceName, "command", monitorCmd, "error", monErr)
			continue
		}

		if len(monReply.Re) == 0 {
			continue
		}

		m := monReply.Re[0].Map
		entry := RFMonitorStats{
			Interface: ifaceName,
		}

		// Noise floor.
		if nf, parseErr := strconv.Atoi(m["noise-floor"]); parseErr == nil {
			entry.NoiseFloor = nf
		}

		// Channel width: v6 uses "channel-width", v7 may use "channel" with width embedded.
		if majorVersion >= 7 {
			entry.ChannelWidth = m["channel"]
		} else {
			entry.ChannelWidth = m["channel-width"]
		}

		// TX power.
		if txp, parseErr := strconv.Atoi(m["tx-power"]); parseErr == nil {
			entry.TxPower = txp
		}

		// Registered clients count.
		if rc, parseErr := strconv.Atoi(m["registered-clients"]); parseErr == nil {
			entry.RegisteredClients = rc
		}

		stats = append(stats, entry)
	}

	if len(stats) == 0 {
		return nil, nil
	}

	return stats, nil
}
