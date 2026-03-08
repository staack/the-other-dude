package device

import (
	"log/slog"

	routeros "github.com/go-routeros/routeros/v3"
)

// FirmwareInfo holds firmware update status collected from a RouterOS device.
type FirmwareInfo struct {
	InstalledVersion string `json:"installed_version"`
	LatestVersion    string `json:"latest_version,omitempty"`
	Channel          string `json:"channel,omitempty"`
	Status           string `json:"status"`       // "New version is available", "System is already up to date", "check-failed"
	Architecture     string `json:"architecture"` // CPU architecture (e.g., "arm", "arm64", "mipsbe")
}

// CheckFirmwareUpdate queries a RouterOS device for firmware update status.
//
// It performs two API calls:
//  1. /system/resource/print — to get the architecture and installed version.
//  2. /system/package/update/check-for-updates + /system/package/update/print
//     — to get the latest available version from MikroTik's servers.
//
// If the device cannot reach MikroTik's servers (no internet), the function
// returns what it knows (installed version, architecture) with status "check-failed".
// This is non-fatal — the device may simply not have internet access.
func CheckFirmwareUpdate(c *routeros.Client) (FirmwareInfo, error) {
	// 1. Get architecture and installed version from /system/resource/print.
	resReply, err := c.Run("/system/resource/print")
	if err != nil {
		return FirmwareInfo{}, err
	}

	arch := ""
	installedVer := ""
	if len(resReply.Re) > 0 {
		arch = resReply.Re[0].Map["architecture-name"]
		installedVer = resReply.Re[0].Map["version"]
	}

	// 2. Trigger check-for-updates (makes outbound HTTP from device to MikroTik servers).
	_, err = c.Run("/system/package/update/check-for-updates")
	if err != nil {
		slog.Debug("firmware update check failed (device may lack internet)",
			"error", err,
			"architecture", arch,
		)
		// Non-fatal: return what we know.
		return FirmwareInfo{
			InstalledVersion: installedVer,
			Architecture:     arch,
			Status:           "check-failed",
		}, nil
	}

	// 3. Read results from /system/package/update/print.
	reply, err := c.Run("/system/package/update/print")
	if err != nil {
		return FirmwareInfo{
			InstalledVersion: installedVer,
			Architecture:     arch,
			Status:           "check-failed",
		}, nil
	}

	if len(reply.Re) == 0 {
		return FirmwareInfo{
			InstalledVersion: installedVer,
			Architecture:     arch,
			Status:           "check-failed",
		}, nil
	}

	m := reply.Re[0].Map

	info := FirmwareInfo{
		InstalledVersion: m["installed-version"],
		LatestVersion:    m["latest-version"],
		Channel:          m["channel"],
		Status:           m["status"],
		Architecture:     arch,
	}

	// Use the resource-detected values as fallback.
	if info.InstalledVersion == "" {
		info.InstalledVersion = installedVer
	}

	slog.Debug("firmware update check complete",
		"installed", info.InstalledVersion,
		"latest", info.LatestVersion,
		"channel", info.Channel,
		"status", info.Status,
		"architecture", info.Architecture,
	)

	return info, nil
}
