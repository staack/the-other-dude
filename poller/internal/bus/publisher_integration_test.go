package bus_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/mikrotik-portal/poller/internal/bus"
	"github.com/mikrotik-portal/poller/internal/testutil"
)

func TestPublisher_PublishStatus_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	natsURL, cleanup := testutil.SetupNATS(t)
	defer cleanup()

	pub, err := bus.NewPublisher(natsURL)
	require.NoError(t, err)
	defer pub.Close()

	// Create a direct NATS consumer to receive messages.
	nc, err := nats.Connect(natsURL)
	require.NoError(t, err)
	defer nc.Close()

	js, err := jetstream.New(nc)
	require.NoError(t, err)

	ctx := context.Background()

	// Create a consumer on the DEVICE_EVENTS stream.
	cons, err := js.CreateOrUpdateConsumer(ctx, "DEVICE_EVENTS", jetstream.ConsumerConfig{
		FilterSubject: "device.status.>",
		AckPolicy:     jetstream.AckNonePolicy,
	})
	require.NoError(t, err)

	// Publish a status event.
	event := bus.DeviceStatusEvent{
		DeviceID: "dev-abc-123",
		TenantID: "tenant-xyz",
		Status:   "online",
		LastSeen: time.Now().UTC().Format(time.RFC3339),
	}
	err = pub.PublishStatus(ctx, event)
	require.NoError(t, err)

	// Consume the message with timeout.
	msgBatch, err := cons.Fetch(1, jetstream.FetchMaxWait(5*time.Second))
	require.NoError(t, err)

	var received *jetstream.Msg
	for msg := range msgBatch.Messages() {
		received = &msg
		break
	}

	require.NotNil(t, received, "should receive a message within 5 seconds")

	var got bus.DeviceStatusEvent
	err = json.Unmarshal((*received).Data(), &got)
	require.NoError(t, err)
	assert.Equal(t, event.DeviceID, got.DeviceID)
	assert.Equal(t, event.TenantID, got.TenantID)
	assert.Equal(t, event.Status, got.Status)
}

func TestPublisher_PublishMetrics_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	natsURL, cleanup := testutil.SetupNATS(t)
	defer cleanup()

	pub, err := bus.NewPublisher(natsURL)
	require.NoError(t, err)
	defer pub.Close()

	nc, err := nats.Connect(natsURL)
	require.NoError(t, err)
	defer nc.Close()

	js, err := jetstream.New(nc)
	require.NoError(t, err)

	ctx := context.Background()

	// Create a consumer filtering on metrics subjects.
	cons, err := js.CreateOrUpdateConsumer(ctx, "DEVICE_EVENTS", jetstream.ConsumerConfig{
		FilterSubject: "device.metrics.>",
		AckPolicy:     jetstream.AckNonePolicy,
	})
	require.NoError(t, err)

	// Publish a metrics event.
	event := bus.DeviceMetricsEvent{
		DeviceID:    "dev-metrics-456",
		TenantID:    "tenant-xyz",
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		Type:        "health",
	}
	err = pub.PublishMetrics(ctx, event)
	require.NoError(t, err)

	// Consume the message.
	msgBatch, err := cons.Fetch(1, jetstream.FetchMaxWait(5*time.Second))
	require.NoError(t, err)

	var received *jetstream.Msg
	for msg := range msgBatch.Messages() {
		received = &msg
		break
	}

	require.NotNil(t, received, "should receive metrics message within 5 seconds")

	// Verify the subject includes the type and device_id.
	assert.Equal(t, "device.metrics.health.dev-metrics-456", (*received).Subject())

	var got bus.DeviceMetricsEvent
	err = json.Unmarshal((*received).Data(), &got)
	require.NoError(t, err)
	assert.Equal(t, event.DeviceID, got.DeviceID)
	assert.Equal(t, event.TenantID, got.TenantID)
	assert.Equal(t, event.Type, got.Type)
}

func TestPublisher_PublishFirmware_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	natsURL, cleanup := testutil.SetupNATS(t)
	defer cleanup()

	pub, err := bus.NewPublisher(natsURL)
	require.NoError(t, err)
	defer pub.Close()

	nc, err := nats.Connect(natsURL)
	require.NoError(t, err)
	defer nc.Close()

	js, err := jetstream.New(nc)
	require.NoError(t, err)

	ctx := context.Background()

	cons, err := js.CreateOrUpdateConsumer(ctx, "DEVICE_EVENTS", jetstream.ConsumerConfig{
		FilterSubject: "device.firmware.>",
		AckPolicy:     jetstream.AckNonePolicy,
	})
	require.NoError(t, err)

	event := bus.DeviceFirmwareEvent{
		DeviceID:         "dev-fw-789",
		TenantID:         "tenant-xyz",
		InstalledVersion: "7.15",
		LatestVersion:    "7.16",
		Channel:          "stable",
		Status:           "update_available",
		Architecture:     "arm64",
	}
	err = pub.PublishFirmware(ctx, event)
	require.NoError(t, err)

	msgBatch, err := cons.Fetch(1, jetstream.FetchMaxWait(5*time.Second))
	require.NoError(t, err)

	var received *jetstream.Msg
	for msg := range msgBatch.Messages() {
		received = &msg
		break
	}

	require.NotNil(t, received, "should receive firmware message within 5 seconds")
	assert.Equal(t, "device.firmware.dev-fw-789", (*received).Subject())

	var got bus.DeviceFirmwareEvent
	err = json.Unmarshal((*received).Data(), &got)
	require.NoError(t, err)
	assert.Equal(t, event.DeviceID, got.DeviceID)
	assert.Equal(t, event.InstalledVersion, got.InstalledVersion)
	assert.Equal(t, event.LatestVersion, got.LatestVersion)
	assert.Equal(t, event.Status, got.Status)
}

func TestPublisher_NewPublisher_StreamCreation_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	natsURL, cleanup := testutil.SetupNATS(t)
	defer cleanup()

	pub, err := bus.NewPublisher(natsURL)
	require.NoError(t, err)
	defer pub.Close()

	// Verify the DEVICE_EVENTS stream was created with correct config.
	nc, err := nats.Connect(natsURL)
	require.NoError(t, err)
	defer nc.Close()

	js, err := jetstream.New(nc)
	require.NoError(t, err)

	ctx := context.Background()
	stream, err := js.Stream(ctx, "DEVICE_EVENTS")
	require.NoError(t, err, "DEVICE_EVENTS stream should exist")

	info, err := stream.Info(ctx)
	require.NoError(t, err)

	assert.Equal(t, "DEVICE_EVENTS", info.Config.Name)
	assert.Contains(t, info.Config.Subjects, "device.status.>",
		"stream should cover device.status.> subjects")
	assert.Contains(t, info.Config.Subjects, "device.metrics.>",
		"stream should cover device.metrics.> subjects")
	assert.Contains(t, info.Config.Subjects, "device.firmware.>",
		"stream should cover device.firmware.> subjects")
}
