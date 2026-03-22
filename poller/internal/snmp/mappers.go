package snmp

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gosnmp/gosnmp"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/device"
)

// Well-known hrStorageType OID suffixes for filtering storage rows.
const (
	hrStorageRam       = "1.3.6.1.2.1.25.2.1.2"
	hrStorageFixedDisk = "1.3.6.1.2.1.25.2.1.4"
)

// ifTableRow holds parsed column values for a single interface index
// from either ifTable or ifXTable walks.
type ifTableRow struct {
	Name       string
	RxBytes    int64
	TxBytes    int64
	OperStatus int
	Source     string // "ifTable" or "ifXTable"
}

// mapInterfaceMetrics converts walk results from ifTable and/or ifXTable into
// InterfaceStats. When both tables provide data for the same interface index,
// ifXTable (Counter64) supersedes ifTable (Counter32).
//
// tableResults maps table name -> index -> column name -> PDU.
// counterResults maps OID -> CounterResult for rate computation.
func mapInterfaceMetrics(
	tableResults map[string]map[string]map[string]gosnmp.SnmpPDU,
	counterResults map[string]CounterResult,
) []device.InterfaceStats {
	// Merge rows: ifXTable preferred over ifTable per PreferOver semantics.
	merged := make(map[string]*ifTableRow)

	// First pass: ifTable data.
	if ifTableData, ok := tableResults["ifTable"]; ok {
		for idx, cols := range ifTableData {
			row := &ifTableRow{Source: "ifTable"}
			if pdu, ok := cols["ifDescr"]; ok {
				row.Name = pduToString(pdu)
			}
			if pdu, ok := cols["ifInOctets"]; ok {
				row.RxBytes = pduToInt64(pdu)
			}
			if pdu, ok := cols["ifOutOctets"]; ok {
				row.TxBytes = pduToInt64(pdu)
			}
			if pdu, ok := cols["ifOperStatus"]; ok {
				row.OperStatus = pduToInt(pdu)
			}
			merged[idx] = row
		}
	}

	// Second pass: ifXTable supersedes ifTable for overlapping indexes.
	if ifXTableData, ok := tableResults["ifXTable"]; ok {
		for idx, cols := range ifXTableData {
			existing, exists := merged[idx]
			if !exists {
				existing = &ifTableRow{}
				merged[idx] = existing
			}
			existing.Source = "ifXTable"
			if pdu, ok := cols["ifName"]; ok {
				existing.Name = pduToString(pdu)
			}
			if pdu, ok := cols["ifHCInOctets"]; ok {
				existing.RxBytes = pduToInt64(pdu)
			}
			if pdu, ok := cols["ifHCOutOctets"]; ok {
				existing.TxBytes = pduToInt64(pdu)
			}
			// ifXTable doesn't have ifOperStatus; preserve from ifTable if available.
		}
	}

	stats := make([]device.InterfaceStats, 0, len(merged))
	for _, row := range merged {
		if row.Name == "" {
			continue
		}
		stats = append(stats, device.InterfaceStats{
			Name:    row.Name,
			RxBytes: row.RxBytes,
			TxBytes: row.TxBytes,
			Running: row.OperStatus == 1,
			Type:    "ether",
		})
	}
	return stats
}

// mapHealthMetrics converts scalar CPU values and hrStorageTable rows into
// a HealthMetrics struct. If hrProcessorLoad is unavailable but ssCpuIdle
// is present, the transform="invert_percent" logic computes load = 100 - idle.
//
// scalarValues maps scalar name -> PDU.
// tableResults maps table name -> index -> column name -> PDU.
func mapHealthMetrics(
	scalarValues map[string]gosnmp.SnmpPDU,
	tableResults map[string]map[string]map[string]gosnmp.SnmpPDU,
) *device.HealthMetrics {
	health := &device.HealthMetrics{}

	// CPU load: prefer hrProcessorLoad, fall back to ssCpuIdle (inverted).
	if pdu, ok := scalarValues["hrProcessorLoad"]; ok {
		health.CPULoad = strconv.Itoa(pduToInt(pdu))
	} else if pdu, ok := scalarValues["ssCpuIdle"]; ok {
		idle := pduToInt(pdu)
		health.CPULoad = strconv.Itoa(100 - idle)
	}

	// Storage metrics from hrStorageTable.
	if storageData, ok := tableResults["hrStorageTable"]; ok {
		for _, cols := range storageData {
			storageType := ""
			if pdu, ok := cols["hrStorageType"]; ok {
				storageType = pduToString(pdu)
			}

			allocUnits := int64(1)
			if pdu, ok := cols["hrStorageAllocationUnits"]; ok {
				allocUnits = pduToInt64(pdu)
				if allocUnits <= 0 {
					allocUnits = 1
				}
			}

			size := int64(0)
			if pdu, ok := cols["hrStorageSize"]; ok {
				size = pduToInt64(pdu)
			}

			used := int64(0)
			if pdu, ok := cols["hrStorageUsed"]; ok {
				used = pduToInt64(pdu)
			}

			totalBytes := size * allocUnits
			usedBytes := used * allocUnits
			freeBytes := totalBytes - usedBytes

			// Clamp free to zero if used exceeds total (shouldn't happen but be safe).
			if freeBytes < 0 {
				freeBytes = 0
			}

			switch {
			case strings.HasSuffix(storageType, hrStorageRam) || storageType == hrStorageRam:
				health.FreeMemory = strconv.FormatInt(freeBytes, 10)
				health.TotalMemory = strconv.FormatInt(totalBytes, 10)
			case strings.HasSuffix(storageType, hrStorageFixedDisk) || storageType == hrStorageFixedDisk:
				health.FreeDisk = strconv.FormatInt(freeBytes, 10)
				health.TotalDisk = strconv.FormatInt(totalBytes, 10)
			}
		}
	}

	// Temperature: empty for standard SNMP (vendor-specific, handled via custom profiles).
	health.Temperature = ""

	return health
}

// mapCustomMetrics converts scalar and table results from a poll group
// into SNMPMetricEntry structs for custom (non-standard) metrics.
func mapCustomMetrics(
	groupName string,
	scalars []ScalarOID,
	scalarValues map[string]gosnmp.SnmpPDU,
	tables []TableOID,
	tableResults map[string]map[string]map[string]gosnmp.SnmpPDU,
) []bus.SNMPMetricEntry {
	var entries []bus.SNMPMetricEntry

	// Scalar metrics.
	for _, s := range scalars {
		pdu, ok := scalarValues[s.Name]
		if !ok {
			continue
		}
		entry := bus.SNMPMetricEntry{
			MetricName:  s.Name,
			MetricGroup: groupName,
			OID:         s.OID,
		}
		if isNumericType(s.Type) {
			v := pduToFloat64(pdu)
			entry.ValueNum = &v
		} else {
			v := pduToString(pdu)
			entry.ValueText = &v
		}
		entries = append(entries, entry)
	}

	// Table metrics.
	for _, t := range tables {
		rows, ok := tableResults[t.Name]
		if !ok {
			continue
		}
		for idx, cols := range rows {
			for _, col := range t.Columns {
				pdu, ok := cols[col.Name]
				if !ok {
					continue
				}
				idxVal := idx
				entry := bus.SNMPMetricEntry{
					MetricName:  col.Name,
					MetricGroup: groupName,
					OID:         col.OID,
					IndexValue:  &idxVal,
				}
				if isNumericType(col.Type) {
					v := pduToFloat64(pdu)
					entry.ValueNum = &v
				} else {
					v := pduToString(pdu)
					entry.ValueText = &v
				}
				entries = append(entries, entry)
			}
		}
	}

	return entries
}

// mapDeviceStatus extracts sysDescr, sysName, and sysUptime from scalar values
// and returns partial DeviceStatusEvent fields for SNMP devices.
func mapDeviceStatus(scalarValues map[string]gosnmp.SnmpPDU) (boardName, uptime string) {
	if pdu, ok := scalarValues["sys_descr"]; ok {
		boardName = pduToString(pdu)
		// Truncate to reasonable length for DB storage.
		if len(boardName) > 255 {
			boardName = boardName[:255]
		}
	}

	if pdu, ok := scalarValues["sys_uptime"]; ok {
		// sysUpTime.0 is in hundredths of a second (timeticks).
		ticks := pduToInt64(pdu)
		totalSeconds := ticks / 100
		uptime = formatUptime(totalSeconds)
	}

	return boardName, uptime
}

// formatUptime converts seconds into a RouterOS-compatible uptime string
// (e.g., "5d12h30m").
func formatUptime(totalSeconds int64) string {
	if totalSeconds <= 0 {
		return "0s"
	}
	days := totalSeconds / 86400
	remaining := totalSeconds % 86400
	hours := remaining / 3600
	remaining = remaining % 3600
	minutes := remaining / 60

	var parts []string
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	return strings.Join(parts, "")
}

// pduToUint64 extracts a counter value and bit width from a PDU.
// Counter32 returns bits=32, Counter64 returns bits=64.
// Non-counter types return (0, 0).
func pduToUint64(pdu gosnmp.SnmpPDU) (uint64, int) {
	switch pdu.Type {
	case gosnmp.Counter32:
		switch v := pdu.Value.(type) {
		case uint:
			return uint64(v), 32
		case uint32:
			return uint64(v), 32
		case uint64:
			return v, 32
		case int:
			return uint64(v), 32
		}
	case gosnmp.Counter64:
		switch v := pdu.Value.(type) {
		case uint64:
			return v, 64
		case uint:
			return uint64(v), 64
		}
	}
	return 0, 0
}

// pduToString extracts a string representation from a PDU.
// Handles OctetString ([]byte), Integer, Gauge32, Counter32, Counter64,
// TimeTicks, ObjectIdentifier, and IPAddress types.
func pduToString(pdu gosnmp.SnmpPDU) string {
	switch pdu.Type {
	case gosnmp.OctetString:
		switch v := pdu.Value.(type) {
		case []byte:
			return string(v)
		case string:
			return v
		}
	case gosnmp.ObjectIdentifier:
		if v, ok := pdu.Value.(string); ok {
			return v
		}
	case gosnmp.IPAddress:
		if v, ok := pdu.Value.(string); ok {
			return v
		}
	case gosnmp.Integer:
		return fmt.Sprintf("%d", pdu.Value)
	case gosnmp.Gauge32:
		return fmt.Sprintf("%d", pdu.Value)
	case gosnmp.Counter32:
		return fmt.Sprintf("%d", pdu.Value)
	case gosnmp.Counter64:
		return fmt.Sprintf("%d", pdu.Value)
	case gosnmp.TimeTicks:
		return fmt.Sprintf("%d", pdu.Value)
	}
	if pdu.Value != nil {
		return fmt.Sprintf("%v", pdu.Value)
	}
	return ""
}

// pduToInt extracts an integer value from a PDU. Returns 0 for non-integer types.
func pduToInt(pdu gosnmp.SnmpPDU) int {
	switch v := pdu.Value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case uint:
		return int(v)
	case uint32:
		return int(v)
	case uint64:
		return int(v)
	}
	return 0
}

// pduToInt64 extracts an int64 value from a PDU. Handles all gosnmp numeric types.
func pduToInt64(pdu gosnmp.SnmpPDU) int64 {
	switch v := pdu.Value.(type) {
	case int:
		return int64(v)
	case int64:
		return v
	case uint:
		return int64(v)
	case uint32:
		return int64(v)
	case uint64:
		return int64(v)
	}
	return 0
}

// pduToFloat64 extracts a float64 value from a PDU. Used for custom metrics.
func pduToFloat64(pdu gosnmp.SnmpPDU) float64 {
	switch v := pdu.Value.(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case uint:
		return float64(v)
	case uint32:
		return float64(v)
	case uint64:
		return float64(v)
	case float64:
		return v
	}
	return 0
}

// extractIndex returns the row index from a full OID given the table column OID prefix.
// For example, given "1.3.6.1.2.1.2.2.1.10.5" and prefix "1.3.6.1.2.1.2.2.1.10",
// returns "5".
func extractIndex(fullOID, columnOID string) string {
	// Ensure prefix match.
	prefix := columnOID + "."
	if strings.HasPrefix(fullOID, prefix) {
		return fullOID[len(prefix):]
	}
	// Fallback: return the last dotted segment.
	if idx := strings.LastIndex(fullOID, "."); idx >= 0 {
		return fullOID[idx+1:]
	}
	return fullOID
}

// isNumericType returns true for SNMP types that should be stored as numeric values.
func isNumericType(typeName string) bool {
	switch typeName {
	case "integer", "gauge", "gauge32", "counter32", "counter64", "timeticks":
		return true
	}
	return false
}

// isStandardMapTo returns true if the map_to value targets a standard metric type
// (interface_metrics, health_metrics.*, device.*).
func isStandardMapTo(mapTo string) bool {
	if mapTo == "interface_metrics" {
		return true
	}
	if strings.HasPrefix(mapTo, "health_metrics") {
		return true
	}
	if strings.HasPrefix(mapTo, "device.") {
		return true
	}
	return false
}
