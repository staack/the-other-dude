package device

import (
	"log/slog"
	"sort"
	"strconv"
	"strings"

	routeros "github.com/go-routeros/routeros/v3"
)

// WirelessStats holds aggregated metrics for each wireless interface, including idle radios.
type WirelessStats struct {
	Interface   string `json:"interface"`
	ClientCount int    `json:"client_count"`
	AvgSignal   int    `json:"avg_signal"`
	CCQ         *int   `json:"ccq"`
	Frequency   int    `json:"frequency"`
}

type wirelessRunner interface {
	Run(...string) (*routeros.Reply, error)
}

// CollectWireless enumerates interfaces before reading registrations so radios
// with zero clients remain visible. RouterOS v7 tries WiFi, then legacy wireless.
func CollectWireless(client wirelessRunner, majorVersion int) ([]WirelessStats, error) {
	paths := []string{"/interface/wireless"}
	if majorVersion >= 7 {
		paths = append([]string{"/interface/wifi"}, paths...)
	}
	for _, path := range paths {
		interfaces, err := client.Run(path+"/print", "=.proplist=.id,name,frequency,channel.frequency,disabled,running")
		if err != nil || len(interfaces.Re) == 0 {
			continue
		}
		registrations, err := client.Run(path + "/registration-table/print")
		if err != nil {
			return nil, err
		}
		rows := make([]map[string]string, 0, len(registrations.Re))
		for _, row := range registrations.Re {
			rows = append(rows, row.Map)
		}
		inventory := make([]map[string]string, 0, len(interfaces.Re))
		for _, row := range interfaces.Re {
			m := row.Map
			if path == "/interface/wifi" && m["running"] == "true" && m[".id"] != "" {
				// The configured channel may be auto/a list. Monitor reports the active one.
				monitor, err := client.Run(path+"/monitor", "=numbers="+m[".id"], "=once=", "=.proplist=channel")
				if err == nil && len(monitor.Re) > 0 {
					m["active-channel"] = monitor.Re[0].Map["channel"]
				}
				if err != nil {
					slog.Debug("could not collect active WiFi channel", "interface", m["name"], "error", err)
				}
			}
			inventory = append(inventory, m)
		}
		return aggregateWireless(inventory, rows, path == "/interface/wifi"), nil
	}
	return nil, nil
}

func aggregateWireless(interfaces, registrations []map[string]string, wifi bool) []WirelessStats {
	type aggregate struct {
		stats                      WirelessStats
		signal, signals, ccq, ccqs int
	}
	byName := make(map[string]*aggregate)
	for _, row := range interfaces {
		name := row["name"]
		if name == "" {
			continue
		}
		frequency := row["frequency"]
		if wifi {
			frequency = row["channel.frequency"]
			if active := row["active-channel"]; active != "" {
				frequency = strings.SplitN(active, "/", 2)[0]
			}
		}
		freq, _ := strconv.Atoi(frequency)
		byName[name] = &aggregate{stats: WirelessStats{Interface: name, Frequency: freq}}
	}
	for _, row := range registrations {
		a := byName[row["interface"]]
		if a == nil {
			continue
		}
		a.stats.ClientCount++
		field := "signal-strength"
		if wifi {
			field = "signal"
		}
		if row[field] != "" {
			if value, err := ParseSignalStrength(row[field]); err == nil {
				a.signal += value
				a.signals++
			}
		}
		if !wifi {
			if value, err := strconv.Atoi(row["tx-ccq"]); err == nil {
				a.ccq += value
				a.ccqs++
			}
		}
	}
	result := make([]WirelessStats, 0, len(byName))
	for _, a := range byName {
		if a.signals > 0 {
			a.stats.AvgSignal = a.signal / a.signals
		}
		if a.ccqs > 0 {
			ccq := a.ccq / a.ccqs
			a.stats.CCQ = &ccq
		}
		result = append(result, a.stats)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Interface < result[j].Interface })
	return result
}
