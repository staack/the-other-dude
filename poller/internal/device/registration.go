package device

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	routeros "github.com/go-routeros/routeros/v3"
)

// RegistrationEntry holds per-client wireless registration data from a single
// row of the RouterOS registration-table. Each connected wireless client
// produces one entry.
type RegistrationEntry struct {
	Interface        string `json:"interface"`
	MacAddress       string `json:"mac_address"`
	SignalStrength   int    `json:"signal_strength"`    // dBm, parsed from signal-strength or signal
	TxCCQ            int    `json:"tx_ccq"`             // 0-100, 0 if unavailable (v7)
	TxRate           string `json:"tx_rate"`             // e.g. "130Mbps"
	RxRate           string `json:"rx_rate"`             // e.g. "130Mbps"
	Uptime           string `json:"uptime"`             // RouterOS duration format e.g. "3d12h5m"
	Distance         int    `json:"distance"`           // meters, 0 if unavailable
	LastIP           string `json:"last_ip"`            // client IP if available
	TxSignalStrength int    `json:"tx_signal_strength"` // dBm, 0 if unavailable
	Bytes            string `json:"bytes"`              // "tx,rx" format string from RouterOS
}

// ParseSignalStrength parses a RouterOS signal strength string into an integer dBm value.
//
// RouterOS returns signal strength in several formats:
//   - "-67"          (plain integer)
//   - "-67@5GHz"     (with frequency suffix)
//   - "-67@HT40"     (with HT width suffix)
//   - "-80@5GHz-Ce/a/ac/an" (with complex suffix)
//
// The function strips everything from the first '@' character onward and
// parses the remaining string as an integer. An empty string returns 0, nil
// (zero value for missing data).
func ParseSignalStrength(s string) (int, error) {
	if s == "" {
		return 0, nil
	}

	// Strip everything from @ onward.
	if idx := strings.IndexByte(s, '@'); idx >= 0 {
		s = s[:idx]
	}

	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("parsing signal strength %q: %w", s, err)
	}
	return v, nil
}

// CollectRegistrations queries the RouterOS device for the wireless
// registration-table and returns one RegistrationEntry per connected client.
//
// Version routing:
//   - majorVersion >= 7: tries /interface/wifi/registration-table/print first;
//     falls back to /interface/wireless/registration-table/print if that fails.
//   - majorVersion < 7 (including 0 for unknown): uses the classic wireless path.
//
// Returns nil, nil when the device has no wireless interfaces (same pattern
// as CollectWireless).
func CollectRegistrations(client *routeros.Client, majorVersion int) ([]RegistrationEntry, error) {
	var rows []map[string]string
	var useV7WiFi bool

	if majorVersion >= 7 {
		// Try the v7 WiFi API first.
		reply, err := client.Run("/interface/wifi/registration-table/print")
		if err == nil {
			useV7WiFi = true
			for _, s := range reply.Re {
				rows = append(rows, s.Map)
			}
		} else {
			slog.Debug("v7 wifi registration-table not available, falling back to wireless", "error", err)
			reply, err = client.Run("/interface/wireless/registration-table/print")
			if err != nil {
				slog.Debug("device has no wireless interfaces", "error", err)
				return nil, nil
			}
			for _, s := range reply.Re {
				rows = append(rows, s.Map)
			}
		}
	} else {
		reply, err := client.Run("/interface/wireless/registration-table/print")
		if err != nil {
			slog.Debug("device has no wireless interfaces", "error", err)
			return nil, nil
		}
		for _, s := range reply.Re {
			rows = append(rows, s.Map)
		}
	}

	if len(rows) == 0 {
		return nil, nil
	}

	entries := make([]RegistrationEntry, 0, len(rows))
	for _, r := range rows {
		entry := RegistrationEntry{
			Interface:  r["interface"],
			MacAddress: r["mac-address"],
			TxRate:     r["tx-rate"],
			RxRate:     r["rx-rate"],
			Uptime:     r["uptime"],
			LastIP:     r["last-ip"],
			Bytes:      r["bytes"],
		}

		// Signal strength: v7 wifi uses "signal", v6 wireless uses "signal-strength".
		sigField := "signal-strength"
		if useV7WiFi {
			sigField = "signal"
		}
		if sig, err := ParseSignalStrength(r[sigField]); err != nil {
			slog.Debug("could not parse signal strength", "value", r[sigField], "error", err)
		} else {
			entry.SignalStrength = sig
		}

		// TX signal strength (may not be present).
		if txSig, err := ParseSignalStrength(r["tx-signal-strength"]); err != nil {
			slog.Debug("could not parse tx-signal-strength", "value", r["tx-signal-strength"], "error", err)
		} else {
			entry.TxSignalStrength = txSig
		}

		// TX CCQ: available in v6 wireless, not in v7 wifi package.
		if !useV7WiFi {
			if ccq, err := strconv.Atoi(r["tx-ccq"]); err == nil {
				entry.TxCCQ = ccq
			}
		}

		// Distance.
		if dist, err := strconv.Atoi(r["distance"]); err == nil {
			entry.Distance = dist
		}

		entries = append(entries, entry)
	}

	return entries, nil
}
