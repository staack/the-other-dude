package store_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/testutil"
)

func TestDeviceStore_FetchDevices_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	connStr, cleanup := testutil.SetupPostgres(t)
	defer cleanup()

	ctx := context.Background()
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	dummyCreds := []byte("dummy-encrypted-credentials")
	v7 := "7.16"
	major7 := 7

	// Insert 3 devices WITH encrypted_credentials (should be returned).
	id1 := testutil.InsertTestDevice(t, connStr, store.Device{
		TenantID:             tenantID,
		IPAddress:            "192.168.1.1",
		APIPort:              8728,
		APISSLPort:           8729,
		EncryptedCredentials: dummyCreds,
		RouterOSVersion:      &v7,
		MajorVersion:         &major7,
	})
	id2 := testutil.InsertTestDevice(t, connStr, store.Device{
		TenantID:             tenantID,
		IPAddress:            "192.168.1.2",
		APIPort:              8728,
		APISSLPort:           8729,
		EncryptedCredentials: dummyCreds,
	})
	id3 := testutil.InsertTestDevice(t, connStr, store.Device{
		TenantID:             tenantID,
		IPAddress:            "192.168.1.3",
		APIPort:              8728,
		APISSLPort:           8729,
		EncryptedCredentials: dummyCreds,
	})

	// Insert 1 device WITHOUT encrypted_credentials (should be excluded).
	_ = testutil.InsertTestDevice(t, connStr, store.Device{
		TenantID:  tenantID,
		IPAddress: "192.168.1.99",
		APIPort:   8728,
		// EncryptedCredentials is nil -> excluded by FetchDevices WHERE clause
	})

	ds, err := store.NewDeviceStore(ctx, connStr)
	require.NoError(t, err)
	defer ds.Close()

	devices, err := ds.FetchDevices(ctx)
	require.NoError(t, err)
	assert.Len(t, devices, 3, "should return only devices with encrypted_credentials")

	// Collect returned IDs for verification.
	returnedIDs := make(map[string]bool)
	for _, d := range devices {
		returnedIDs[d.ID] = true
	}
	assert.True(t, returnedIDs[id1], "device 1 should be returned")
	assert.True(t, returnedIDs[id2], "device 2 should be returned")
	assert.True(t, returnedIDs[id3], "device 3 should be returned")

	// Verify fields on the device with version info.
	for _, d := range devices {
		if d.ID == id1 {
			assert.Equal(t, tenantID, d.TenantID)
			assert.Equal(t, "192.168.1.1", d.IPAddress)
			assert.Equal(t, 8728, d.APIPort)
			assert.Equal(t, 8729, d.APISSLPort)
			assert.Equal(t, dummyCreds, d.EncryptedCredentials)
			require.NotNil(t, d.RouterOSVersion)
			assert.Equal(t, "7.16", *d.RouterOSVersion)
			require.NotNil(t, d.MajorVersion)
			assert.Equal(t, 7, *d.MajorVersion)

			// New fields: verify COALESCE defaults for existing RouterOS devices.
			assert.Equal(t, "routeros", d.DeviceType, "COALESCE should default to routeros")
			assert.Equal(t, 161, d.SNMPPort, "COALESCE should default to 161")
			assert.Nil(t, d.SNMPVersion, "SNMPVersion should be nil for RouterOS devices")
			assert.Nil(t, d.SNMPProfileID, "SNMPProfileID should be nil for RouterOS devices")
			assert.Nil(t, d.CredentialProfileID, "CredentialProfileID should be nil when not linked")
			assert.Nil(t, d.ProfileEncryptedCredentials, "ProfileEncryptedCredentials should be nil when no profile linked")
			assert.Nil(t, d.ProfileEncryptedCredentialsTransit, "ProfileEncryptedCredentialsTransit should be nil when no profile linked")
		}
	}
}

func TestDeviceStore_GetDevice_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	connStr, cleanup := testutil.SetupPostgres(t)
	defer cleanup()

	ctx := context.Background()
	tenantID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	dummyCreds := []byte("dummy-encrypted-credentials")

	id := testutil.InsertTestDevice(t, connStr, store.Device{
		TenantID:             tenantID,
		IPAddress:            "10.0.0.1",
		APIPort:              8728,
		APISSLPort:           8729,
		EncryptedCredentials: dummyCreds,
	})

	ds, err := store.NewDeviceStore(ctx, connStr)
	require.NoError(t, err)
	defer ds.Close()

	// Happy path: existing device.
	d, err := ds.GetDevice(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, id, d.ID)
	assert.Equal(t, tenantID, d.TenantID)
	assert.Equal(t, "10.0.0.1", d.IPAddress)
	assert.Equal(t, dummyCreds, d.EncryptedCredentials)

	// Sad path: nonexistent device.
	_, err = ds.GetDevice(ctx, "00000000-0000-0000-0000-000000000000")
	assert.Error(t, err)
}

func TestDeviceStore_FetchDevices_Empty_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	connStr, cleanup := testutil.SetupPostgres(t)
	defer cleanup()

	ctx := context.Background()

	ds, err := store.NewDeviceStore(ctx, connStr)
	require.NoError(t, err)
	defer ds.Close()

	devices, err := ds.FetchDevices(ctx)
	require.NoError(t, err)
	// FetchDevices returns nil slice when no rows exist (append on nil);
	// this is acceptable Go behavior. The important thing is no error.
	assert.Empty(t, devices, "should return empty result for empty database")
}
