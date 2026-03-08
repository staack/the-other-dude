package device

import (
	"log/slog"
	"strconv"

	routeros "github.com/go-routeros/routeros/v3"
)

// WirelessStats holds aggregated wireless metrics for a single wireless interface.
// Metrics are aggregated across all registered clients on that interface.
type WirelessStats struct {
	Interface   string `json:"interface"`
	ClientCount int    `json:"client_count"`
	AvgSignal   int    `json:"avg_signal"`  // dBm (negative), e.g. -67
	CCQ         int    `json:"ccq"`         // 0–100 percentage; 0 if not available (v7)
	Frequency   int    `json:"frequency"`   // MHz
}

// CollectWireless queries the RouterOS device for wireless registration-table
// entries and aggregates them per interface.
//
// Version routing:
//   - majorVersion >= 7: tries /interface/wifi/registration-table/print first;
//     falls back to /interface/wireless/registration-table/print if that fails.
//   - majorVersion < 7 (including 0 for unknown): uses the classic wireless path.
//
// Returns an empty slice (not an error) when the device has no wireless interfaces.
func CollectWireless(client *routeros.Client, majorVersion int) ([]WirelessStats, error) {
	var registrations []map[string]string
	var useV7WiFi bool

	if majorVersion >= 7 {
		// Try the v7 WiFi API first.
		regReply, err := client.Run("/interface/wifi/registration-table/print")
		if err == nil {
			useV7WiFi = true
			for _, s := range regReply.Re {
				registrations = append(registrations, s.Map)
			}
		} else {
			slog.Debug("v7 wifi registration-table not available, falling back to wireless", "error", err)
			// Fall back to classic wireless path.
			regReply, err = client.Run("/interface/wireless/registration-table/print")
			if err != nil {
				slog.Debug("device has no wireless interfaces", "error", err)
				return nil, nil
			}
			for _, s := range regReply.Re {
				registrations = append(registrations, s.Map)
			}
		}
	} else {
		regReply, err := client.Run("/interface/wireless/registration-table/print")
		if err != nil {
			slog.Debug("device has no wireless interfaces", "error", err)
			return nil, nil
		}
		for _, s := range regReply.Re {
			registrations = append(registrations, s.Map)
		}
	}

	if len(registrations) == 0 {
		return nil, nil
	}

	// Collect frequency per interface so we can include it in the stats.
	frequencies := collectWirelessFrequencies(client, majorVersion, useV7WiFi)

	// Aggregate registration-table rows per interface.
	type ifaceAgg struct {
		count  int
		signal int
		ccq    int
	}

	agg := make(map[string]*ifaceAgg)
	for _, r := range registrations {
		iface := r["interface"]
		if iface == "" {
			continue
		}
		if _, ok := agg[iface]; !ok {
			agg[iface] = &ifaceAgg{}
		}
		a := agg[iface]
		a.count++

		if sig, err := strconv.Atoi(r["signal-strength"]); err == nil {
			a.signal += sig
		}
		if ccq, err := strconv.Atoi(r["tx-ccq"]); err == nil {
			a.ccq += ccq
		}
	}

	result := make([]WirelessStats, 0, len(agg))
	for iface, a := range agg {
		avgSignal := 0
		avgCCQ := 0
		if a.count > 0 {
			avgSignal = a.signal / a.count
			avgCCQ = a.ccq / a.count
		}
		result = append(result, WirelessStats{
			Interface:   iface,
			ClientCount: a.count,
			AvgSignal:   avgSignal,
			CCQ:         avgCCQ,
			Frequency:   frequencies[iface],
		})
	}

	return result, nil
}

// collectWirelessFrequencies returns a map of interface name → frequency (MHz).
// Uses the v7 WiFi API or the classic wireless API based on the useV7WiFi flag.
func collectWirelessFrequencies(client *routeros.Client, majorVersion int, useV7WiFi bool) map[string]int {
	freqs := make(map[string]int)

	var cmd string
	if useV7WiFi {
		cmd = "/interface/wifi/print"
	} else {
		cmd = "/interface/wireless/print"
	}

	reply, err := client.Run(cmd, "=.proplist=name,frequency")
	if err != nil {
		slog.Debug("could not collect wireless frequencies", "command", cmd, "error", err)
		return freqs
	}

	for _, s := range reply.Re {
		m := s.Map
		name := m["name"]
		if freq, err := strconv.Atoi(m["frequency"]); err == nil {
			freqs[name] = freq
		}
	}

	return freqs
}
