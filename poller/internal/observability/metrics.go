// Package observability provides Prometheus metrics and health endpoints for the poller.
package observability

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// PollDuration tracks the duration of individual device poll cycles.
var PollDuration = promauto.NewHistogram(prometheus.HistogramOpts{
	Name:    "mikrotik_poll_duration_seconds",
	Help:    "Duration of a single device poll cycle in seconds.",
	Buckets: []float64{0.5, 1, 2, 5, 10, 30, 60},
})

// PollTotal counts the total number of poll cycles by status.
// Status labels: "success", "error", "skipped".
var PollTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "mikrotik_poll_total",
	Help: "Total number of poll cycles.",
}, []string{"status"})

// DevicesActive tracks the number of devices currently being polled.
var DevicesActive = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "mikrotik_devices_active",
	Help: "Number of devices currently being polled.",
})

// DeviceConnectionErrors counts total device connection failures.
var DeviceConnectionErrors = promauto.NewCounter(prometheus.CounterOpts{
	Name: "mikrotik_device_connection_errors_total",
	Help: "Total device connection failures.",
})

// NATSPublishTotal counts NATS publish operations by subject and status.
// Subject labels: "status", "metrics", "firmware".
// Status labels: "success", "error".
var NATSPublishTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "mikrotik_nats_publish_total",
	Help: "Total NATS publish operations.",
}, []string{"subject", "status"})

// RedisLockTotal counts Redis lock operations by status.
// Status labels: "obtained", "not_obtained", "error".
var RedisLockTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "mikrotik_redis_lock_total",
	Help: "Total Redis lock operations.",
}, []string{"status"})

// CircuitBreakerSkips counts polls skipped due to circuit breaker backoff.
var CircuitBreakerSkips = promauto.NewCounter(prometheus.CounterOpts{
	Name: "mikrotik_circuit_breaker_skips_total",
	Help: "Total polls skipped because the device is in circuit breaker backoff.",
})

// CircuitBreakerResets counts circuit breaker resets (device recovered after failures).
var CircuitBreakerResets = promauto.NewCounter(prometheus.CounterOpts{
	Name: "mikrotik_circuit_breaker_resets_total",
	Help: "Total circuit breaker resets when a device recovers.",
})

// ConfigBackupTotal counts config backup operations by status.
// Status labels: "success", "error", "skipped_offline", "skipped_auth_blocked", "skipped_hostkey_blocked".
var ConfigBackupTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "mikrotik_config_backup_total",
	Help: "Total config backup operations.",
}, []string{"status"})

// ConfigBackupDuration tracks the duration of individual config backup operations.
var ConfigBackupDuration = promauto.NewHistogram(prometheus.HistogramOpts{
	Name:    "mikrotik_config_backup_duration_seconds",
	Help:    "Duration of a single config backup operation in seconds.",
	Buckets: []float64{1, 5, 10, 30, 60, 120, 300},
})

// ConfigBackupActive tracks the number of concurrent config backup jobs running.
var ConfigBackupActive = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "mikrotik_config_backup_active",
	Help: "Number of concurrent config backup jobs running.",
})
