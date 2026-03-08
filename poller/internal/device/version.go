package device

import (
	"fmt"
	"log/slog"

	routeros "github.com/go-routeros/routeros/v3"
)

// DeviceInfo holds metadata collected from /system/resource/print and
// /system/routerboard/print.
type DeviceInfo struct {
	Version         string
	MajorVersion    int
	BoardName       string
	Architecture    string
	Uptime          string
	CPULoad         string
	FreeMemory      string
	TotalMemory     string
	SerialNumber    string // from /system/routerboard serial-number
	FirmwareVersion string // from /system/routerboard current-firmware
	LastConfigChange string // from /system/resource last-config-change (RouterOS 7.x)
}

// DetectVersion queries the RouterOS device for system resource information.
//
// Runs /system/resource/print and parses the response into DeviceInfo.
// The major version is extracted from the first character of the version string
// (e.g. "6.49.10" -> 6, "7.12" -> 7).
func DetectVersion(c *routeros.Client) (DeviceInfo, error) {
	reply, err := c.Run("/system/resource/print")
	if err != nil {
		return DeviceInfo{}, fmt.Errorf("running /system/resource/print: %w", err)
	}

	if len(reply.Re) == 0 {
		return DeviceInfo{}, fmt.Errorf("/system/resource/print returned no sentences")
	}

	m := reply.Re[0].Map

	info := DeviceInfo{
		Version:      m["version"],
		BoardName:    m["board-name"],
		Architecture: m["architecture-name"],
		Uptime:       m["uptime"],
		CPULoad:      m["cpu-load"],
		FreeMemory:   m["free-memory"],
		TotalMemory:      m["total-memory"],
		LastConfigChange: m["last-config-change"],
	}

	// Extract major version from first character of version string.
	// Valid RouterOS versions start with '6' or '7'.
	if len(info.Version) > 0 {
		firstChar := info.Version[0]
		if firstChar >= '0' && firstChar <= '9' {
			info.MajorVersion = int(firstChar - '0')
		} else {
			slog.Warn("unexpected RouterOS version format", "version", info.Version)
			info.MajorVersion = 0
		}
	}

	// Query routerboard info for serial number and firmware version.
	// Non-fatal: CHR and x86 devices don't have a routerboard.
	rbReply, rbErr := c.Run("/system/routerboard/print")
	if rbErr == nil && len(rbReply.Re) > 0 {
		rb := rbReply.Re[0].Map
		info.SerialNumber = rb["serial-number"]
		info.FirmwareVersion = rb["current-firmware"]
	} else if rbErr != nil {
		slog.Debug("routerboard query failed (normal for CHR/x86)", "error", rbErr)
	}

	slog.Debug("detected RouterOS version",
		"version", info.Version,
		"major_version", info.MajorVersion,
		"board_name", info.BoardName,
		"serial", info.SerialNumber,
		"firmware", info.FirmwareVersion,
	)

	return info, nil
}
