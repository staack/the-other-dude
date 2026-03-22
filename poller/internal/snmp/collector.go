package snmp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/device"
	poller "github.com/staack/the-other-dude/poller/internal/poller"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// Compile-time interface assertion: SNMPCollector satisfies poller.Collector.
var _ poller.Collector = (*SNMPCollector)(nil)

// maxPDUsPerWalk is the safety valve for walkTable. If a single walk returns
// more than this many PDUs, the walk is aborted to prevent memory exhaustion
// from misbehaving devices or misconfigured OIDs.
const maxPDUsPerWalk = 10000

// SNMPCollector implements the poller.Collector interface for SNMP devices.
// It performs profile-driven OID collection via gosnmp, computes counter deltas,
// maps results to standard and custom event types, and publishes to NATS.
type SNMPCollector struct {
	profiles  *ProfileCache
	credCache *vault.CredentialCache
	counters  *CounterCache
	cfg       SNMPConfig
}

// NewSNMPCollector creates an SNMPCollector with the given dependencies.
func NewSNMPCollector(
	profiles *ProfileCache,
	credCache *vault.CredentialCache,
	counters *CounterCache,
	cfg SNMPConfig,
) *SNMPCollector {
	return &SNMPCollector{
		profiles:  profiles,
		credCache: credCache,
		counters:  counters,
		cfg:       cfg,
	}
}

// Collect performs one complete SNMP poll cycle for a device:
//  1. Validate profile assignment and load compiled profile
//  2. Decrypt SNMP credentials via credential cache
//  3. Build and connect gosnmp client with timeout
//  4. For each poll group: collect scalars and tables, compute counter deltas
//  5. Map results to standard (DeviceMetricsEvent) and custom (SNMPMetricsEvent) events
//  6. Publish DeviceStatusEvent with online status
//
// Each poll group collects independently -- a failure in one group does not
// abort other groups. Returns poller.ErrDeviceOffline only when the device
// is truly unreachable (connect failure or sysUptime.0 get failure).
func (c *SNMPCollector) Collect(ctx context.Context, dev store.Device, pub *bus.Publisher) error {
	startTime := time.Now()

	// Step 1: Resolve profile. Fall back to generic-snmp if none assigned.
	profileID := ""
	if dev.SNMPProfileID != nil {
		profileID = *dev.SNMPProfileID
	} else if c.profiles != nil {
		profileID = c.profiles.GetGenericID()
		if profileID == "" {
			return fmt.Errorf("device %s: no SNMP profile assigned and no generic-snmp fallback found", dev.ID)
		}
		slog.Debug("using generic-snmp fallback profile", "device_id", dev.ID)
	} else {
		return fmt.Errorf("device %s: no SNMP profile assigned and profile cache not available", dev.ID)
	}
	profile := c.profiles.Get(profileID)
	if profile == nil {
		return fmt.Errorf("device %s: SNMP profile not found for ID %s", dev.ID, profileID)
	}

	// Step 2: Get credentials.
	raw, err := c.credCache.GetRawCredentials(
		dev.ID, dev.TenantID,
		dev.EncryptedCredentialsTransit, dev.EncryptedCredentials,
		dev.ProfileEncryptedCredentialsTransit, dev.ProfileEncryptedCredentials,
	)
	if err != nil {
		return fmt.Errorf("device %s: credential resolution failed: %w", dev.ID, err)
	}

	cred, err := vault.ParseSNMPCredentials(raw)
	if err != nil {
		return fmt.Errorf("device %s: parsing SNMP credentials: %w", dev.ID, err)
	}

	// Step 3: Build SNMP client.
	g, err := BuildSNMPClient(dev, cred, c.cfg)
	if err != nil {
		return fmt.Errorf("device %s: building SNMP client: %w", dev.ID, err)
	}

	// Step 4: Connect with timeout.
	connectCtx, connectCancel := context.WithTimeout(ctx, c.cfg.ConnTimeout)
	defer connectCancel()

	errCh := make(chan error, 1)
	go func() { errCh <- g.Connect() }()

	select {
	case err := <-errCh:
		if err != nil {
			slog.Info("SNMP device offline", "device_id", dev.ID, "ip", dev.IPAddress, "error", err)
			publishOfflineStatus(ctx, pub, dev)
			return poller.ErrDeviceOffline
		}
	case <-connectCtx.Done():
		slog.Info("SNMP device connect timeout", "device_id", dev.ID, "ip", dev.IPAddress)
		publishOfflineStatus(ctx, pub, dev)
		return poller.ErrDeviceOffline
	}

	// Step 5: Defer connection close.
	defer func() {
		if g.Conn != nil {
			g.Conn.Close()
		}
	}()

	collectedAt := time.Now().UTC().Format(time.RFC3339)

	// Accumulators for results across poll groups.
	var allInterfaceStats []device.InterfaceStats
	var healthMetrics *device.HealthMetrics
	var customMetrics []bus.SNMPMetricEntry
	var boardName, uptime string

	// Step 6: For each poll group, collect scalars and tables.
	for groupName, group := range profile.PollGroups {
		groupErr := c.collectPollGroup(ctx, g, dev, group, groupName,
			&allInterfaceStats, &healthMetrics, &customMetrics, &boardName, &uptime)
		if groupErr != nil {
			slog.Warn("SNMP poll group failed",
				"device_id", dev.ID,
				"group", groupName,
				"error", groupErr,
			)
			// Continue with other groups -- partial collection is normal for SNMP.
		}
	}

	// Step 7: Publish standard metrics.
	if len(allInterfaceStats) > 0 {
		if pubErr := pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
			DeviceID:    dev.ID,
			TenantID:    dev.TenantID,
			CollectedAt: collectedAt,
			Type:        "interfaces",
			Interfaces:  allInterfaceStats,
		}); pubErr != nil {
			slog.Warn("failed to publish SNMP interface metrics", "device_id", dev.ID, "error", pubErr)
		}
	}

	if healthMetrics != nil {
		if pubErr := pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
			DeviceID:    dev.ID,
			TenantID:    dev.TenantID,
			CollectedAt: collectedAt,
			Type:        "health",
			Health:      healthMetrics,
		}); pubErr != nil {
			slog.Warn("failed to publish SNMP health metrics", "device_id", dev.ID, "error", pubErr)
		}
	}

	if len(customMetrics) > 0 {
		if pubErr := pub.PublishSNMPMetrics(ctx, bus.SNMPMetricsEvent{
			DeviceID:    dev.ID,
			TenantID:    dev.TenantID,
			CollectedAt: collectedAt,
			Type:        "snmp_custom",
			Metrics:     customMetrics,
		}); pubErr != nil {
			slog.Warn("failed to publish SNMP custom metrics", "device_id", dev.ID, "error", pubErr)
		}
	}

	// Step 8: Publish device status as online.
	statusEvent := bus.DeviceStatusEvent{
		DeviceID:  dev.ID,
		TenantID:  dev.TenantID,
		Status:    "online",
		BoardName: boardName,
		Uptime:    uptime,
		LastSeen:  time.Now().UTC().Format(time.RFC3339),
	}

	if pubErr := pub.PublishStatus(ctx, statusEvent); pubErr != nil {
		slog.Warn("failed to publish SNMP device status", "device_id", dev.ID, "error", pubErr)
	}

	slog.Debug("SNMP poll complete",
		"device_id", dev.ID,
		"profile", profile.Name,
		"duration", time.Since(startTime).String(),
	)

	return nil
}

// collectPollGroup executes one poll group's scalars and tables, routing results
// to the appropriate accumulators based on map_to values.
func (c *SNMPCollector) collectPollGroup(
	ctx context.Context,
	g *gosnmp.GoSNMP,
	dev store.Device,
	group *PollGroup,
	groupName string,
	interfaceStats *[]device.InterfaceStats,
	healthMetrics **device.HealthMetrics,
	customMetrics *[]bus.SNMPMetricEntry,
	boardName *string,
	uptime *string,
) error {
	// Collect scalar OIDs.
	scalarValues := make(map[string]gosnmp.SnmpPDU)
	customScalars := make([]ScalarOID, 0)

	if len(group.Scalars) > 0 {
		oids := make([]string, len(group.Scalars))
		oidNameMap := make(map[string]ScalarOID)
		for i, s := range group.Scalars {
			oids[i] = s.OID
			oidNameMap[s.OID] = s
		}

		cmdCtx, cancel := context.WithTimeout(ctx, c.cfg.CmdTimeout)
		result, err := withTimeout(cmdCtx, func() (*gosnmp.SnmpPacket, error) {
			return g.Get(oids)
		})
		cancel()
		if err != nil {
			return fmt.Errorf("scalar GET: %w", err)
		}

		for _, pdu := range result.Variables {
			if pdu.Type == gosnmp.NoSuchObject || pdu.Type == gosnmp.NoSuchInstance {
				continue
			}
			scalar, ok := oidNameMap[pdu.Name]
			if !ok {
				// Try trimming leading dot (gosnmp sometimes adds it).
				scalar, ok = oidNameMap[strings.TrimPrefix(pdu.Name, ".")]
			}
			if !ok {
				continue
			}
			scalarValues[scalar.Name] = pdu

			if !isStandardMapTo(scalar.MapTo) {
				customScalars = append(customScalars, scalar)
			}
		}

		// Handle fallback scalars: if a primary is present, remove fallback.
		for _, s := range group.Scalars {
			if s.FallbackFor != "" {
				if _, primaryExists := scalarValues[s.FallbackFor]; primaryExists {
					delete(scalarValues, s.Name)
				}
			}
		}
	}

	// Collect table OIDs.
	tableResults := make(map[string]map[string]map[string]gosnmp.SnmpPDU)
	counterInputs := make(map[string]CounterInput)
	customTables := make([]TableOID, 0)

	for _, table := range group.Tables {
		rows, err := walkTable(ctx, g, table, c.cfg.CmdTimeout)
		if err != nil {
			slog.Warn("SNMP table walk failed",
				"device_id", dev.ID,
				"table", table.Name,
				"error", err,
			)
			continue
		}
		tableResults[table.Name] = rows

		// Extract counter inputs for delta computation.
		for idx, cols := range rows {
			for _, col := range table.Columns {
				pdu, ok := cols[col.Name]
				if !ok {
					continue
				}
				if col.Type == "counter32" || col.Type == "counter64" {
					val, bits := pduToUint64(pdu)
					if bits > 0 {
						counterOID := col.OID + "." + idx
						counterInputs[counterOID] = CounterInput{Value: val, Bits: bits}
					}
				}
			}
		}

		if !isStandardMapTo(table.MapTo) {
			customTables = append(customTables, table)
		}
	}

	// Compute counter deltas.
	var counterResults map[string]CounterResult
	if len(counterInputs) > 0 && c.counters != nil {
		deltas, err := c.counters.ComputeDeltas(ctx, dev.ID, counterInputs)
		if err != nil {
			slog.Warn("counter delta computation failed", "device_id", dev.ID, "error", err)
		} else {
			counterResults = make(map[string]CounterResult, len(deltas))
			for _, d := range deltas {
				counterResults[d.OID] = d
			}
		}
	}

	// Route results through mappers based on map_to field.

	// Interface metrics.
	hasInterfaceTable := false
	for _, table := range group.Tables {
		if table.MapTo == "interface_metrics" {
			hasInterfaceTable = true
			break
		}
	}
	if hasInterfaceTable {
		stats := mapInterfaceMetrics(tableResults, counterResults)
		*interfaceStats = append(*interfaceStats, stats...)
	}

	// Health metrics.
	hasHealthScalar := false
	hasHealthTable := false
	for _, s := range group.Scalars {
		if strings.HasPrefix(s.MapTo, "health_metrics") {
			hasHealthScalar = true
			break
		}
	}
	for _, t := range group.Tables {
		if strings.HasPrefix(t.MapTo, "health_metrics") {
			hasHealthTable = true
			break
		}
	}
	if hasHealthScalar || hasHealthTable {
		h := mapHealthMetrics(scalarValues, tableResults)
		*healthMetrics = h
	}

	// Device status from system scalars.
	hasDeviceScalar := false
	for _, s := range group.Scalars {
		if strings.HasPrefix(s.MapTo, "device.") {
			hasDeviceScalar = true
			break
		}
	}
	if hasDeviceScalar {
		bn, ut := mapDeviceStatus(scalarValues)
		if bn != "" {
			*boardName = bn
		}
		if ut != "" {
			*uptime = ut
		}
	}

	// Custom metrics (non-standard map_to).
	if len(customScalars) > 0 || len(customTables) > 0 {
		entries := mapCustomMetrics(groupName, customScalars, scalarValues, customTables, tableResults)
		*customMetrics = append(*customMetrics, entries...)
	}

	return nil
}

// walkTable performs an SNMP table walk and returns results organized as
// map[index]map[columnName]PDU. Uses BulkWalk for v2c/v3 and Walk for v1.
// The walk is wrapped in a timeout to prevent indefinite hangs.
func walkTable(
	ctx context.Context,
	g *gosnmp.GoSNMP,
	table TableOID,
	cmdTimeout time.Duration,
) (map[string]map[string]gosnmp.SnmpPDU, error) {
	rows := make(map[string]map[string]gosnmp.SnmpPDU)
	pduCount := 0

	// Build column OID -> name lookup.
	colLookup := make(map[string]string, len(table.Columns))
	for _, col := range table.Columns {
		colLookup[col.OID] = col.Name
	}

	// PDU handler shared by Walk and BulkWalk.
	handler := func(pdu gosnmp.SnmpPDU) error {
		pduCount++
		if pduCount > maxPDUsPerWalk {
			return errors.New("safety valve: exceeded 10000 PDUs in single walk")
		}

		// Match PDU to a column.
		for colOID, colName := range colLookup {
			prefix := colOID + "."
			if strings.HasPrefix(pdu.Name, prefix) || strings.HasPrefix(pdu.Name, "."+prefix) {
				idx := extractIndex(strings.TrimPrefix(pdu.Name, "."), colOID)
				if _, ok := rows[idx]; !ok {
					rows[idx] = make(map[string]gosnmp.SnmpPDU)
				}
				rows[idx][colName] = pdu
				return nil
			}
		}

		// Also try the table OID itself as a parent (for indexed walks).
		tablePrefix := table.OID + "."
		if strings.HasPrefix(pdu.Name, tablePrefix) || strings.HasPrefix(pdu.Name, "."+tablePrefix) {
			// PDU is under this table but doesn't match any known column.
			return nil
		}

		return nil
	}

	cmdCtx, cancel := context.WithTimeout(ctx, cmdTimeout)
	defer cancel()

	if g.Version == gosnmp.Version1 {
		// SNMPv1: use Walk (no BulkWalk support).
		_, err := withTimeout(cmdCtx, func() (struct{}, error) {
			return struct{}{}, g.Walk(table.OID, handler)
		})
		if err != nil {
			return nil, fmt.Errorf("walk %s: %w", table.Name, err)
		}
	} else {
		// SNMPv2c/v3: use BulkWalk with timeout protection.
		_, err := withTimeout(cmdCtx, func() (struct{}, error) {
			return struct{}{}, g.BulkWalk(table.OID, handler)
		})
		if err != nil {
			return nil, fmt.Errorf("bulkwalk %s: %w", table.Name, err)
		}
	}

	return rows, nil
}

// withTimeout runs fn in a goroutine and returns its result, or a timeout error
// if ctx expires first. This wraps gosnmp calls that don't accept a context
// parameter, enforcing per-command timeouts to prevent indefinite blocking.
func withTimeout[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	type result struct {
		val T
		err error
	}
	ch := make(chan result, 1)
	go func() {
		v, e := fn()
		ch <- result{v, e}
	}()
	select {
	case r := <-ch:
		return r.val, r.err
	case <-ctx.Done():
		var zero T
		return zero, fmt.Errorf("command timed out: %w", ctx.Err())
	}
}

// publishOfflineStatus publishes a DeviceStatusEvent with status="offline".
func publishOfflineStatus(ctx context.Context, pub *bus.Publisher, dev store.Device) {
	offlineEvent := bus.DeviceStatusEvent{
		DeviceID: dev.ID,
		TenantID: dev.TenantID,
		Status:   "offline",
		LastSeen: time.Now().UTC().Format(time.RFC3339),
	}
	if pubErr := pub.PublishStatus(ctx, offlineEvent); pubErr != nil {
		slog.Warn("failed to publish SNMP offline event", "device_id", dev.ID, "error", pubErr)
	}
}
