package device

import (
	"log/slog"

	routeros "github.com/go-routeros/routeros/v3"
)

// HealthMetrics holds system resource metrics collected from a RouterOS device.
// String fields match the raw RouterOS API values so the subscriber can parse
// and validate them before inserting into TimescaleDB.
type HealthMetrics struct {
	CPULoad     string `json:"cpu_load"`
	FreeMemory  string `json:"free_memory"`
	TotalMemory string `json:"total_memory"`
	FreeDisk    string `json:"free_disk"`
	TotalDisk   string `json:"total_disk"`
	Temperature string `json:"temperature"` // empty string if device has no sensor
}

// CollectHealth gathers system health metrics for a RouterOS device.
//
// It combines data already present in DeviceInfo (CPU, memory) with additional
// disk stats from /system/resource/print and temperature from /system/health/print.
//
// Temperature handling:
//   - RouterOS v7: /system/health/print returns rows with name/value columns;
//     looks for "cpu-temperature" then "board-temperature" as a fallback.
//   - RouterOS v6: /system/health/print returns a flat map; looks for
//     "cpu-temperature" key directly.
//   - If the command fails or no temperature key is found, Temperature is set to "".
func CollectHealth(client *routeros.Client, info DeviceInfo) (HealthMetrics, error) {
	health := HealthMetrics{
		CPULoad:     info.CPULoad,
		FreeMemory:  info.FreeMemory,
		TotalMemory: info.TotalMemory,
	}

	// Collect disk stats (not included in the default /system/resource/print proplist
	// used by DetectVersion, so we query explicitly here).
	diskReply, err := client.Run(
		"/system/resource/print",
		"=.proplist=free-hdd-space,total-hdd-space",
	)
	if err != nil {
		slog.Warn("could not collect disk stats", "error", err)
	} else if len(diskReply.Re) > 0 {
		m := diskReply.Re[0].Map
		health.FreeDisk = m["free-hdd-space"]
		health.TotalDisk = m["total-hdd-space"]
	}

	// Collect temperature from /system/health/print.
	// This command may not exist on all devices, so errors are non-fatal.
	health.Temperature = collectTemperature(client, info.MajorVersion)

	return health, nil
}

// collectTemperature queries /system/health/print and extracts the temperature
// reading. Returns an empty string if the device has no temperature sensor or
// the command is not supported.
func collectTemperature(client *routeros.Client, majorVersion int) string {
	reply, err := client.Run("/system/health/print")
	if err != nil {
		slog.Debug("temperature collection not available", "error", err)
		return ""
	}

	if len(reply.Re) == 0 {
		return ""
	}

	// RouterOS v7 returns rows with "name" and "value" columns.
	// RouterOS v6 returns a flat map in a single sentence.
	if majorVersion >= 7 {
		// v7: iterate rows looking for known temperature keys.
		var fallback string
		for _, sentence := range reply.Re {
			m := sentence.Map
			name := m["name"]
			value := m["value"]
			if name == "cpu-temperature" {
				return value
			}
			if name == "board-temperature" {
				fallback = value
			}
		}
		return fallback
	}

	// v6 (or unknown version): flat map — look for cpu-temperature key directly.
	m := reply.Re[0].Map
	if temp, ok := m["cpu-temperature"]; ok {
		return temp
	}
	if temp, ok := m["board-temperature"]; ok {
		return temp
	}

	return ""
}

