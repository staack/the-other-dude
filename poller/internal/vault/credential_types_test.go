package vault

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- ParseRouterOSCredentials tests ---

func TestParseRouterOSCredentials_TypedRouterOS(t *testing.T) {
	raw := []byte(`{"type":"routeros","username":"admin","password":"secret"}`)
	username, password, err := ParseRouterOSCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "admin", username)
	assert.Equal(t, "secret", password)
}

func TestParseRouterOSCredentials_LegacyNoTypeField(t *testing.T) {
	raw := []byte(`{"username":"admin","password":"secret"}`)
	username, password, err := ParseRouterOSCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "admin", username)
	assert.Equal(t, "secret", password)
}

func TestParseRouterOSCredentials_RejectsSNMPType(t *testing.T) {
	raw := []byte(`{"type":"snmp_v2c","community":"public"}`)
	_, _, err := ParseRouterOSCredentials(raw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not routeros")
}

func TestParseRouterOSCredentials_EmptyJSON(t *testing.T) {
	_, _, err := ParseRouterOSCredentials([]byte(`{}`))
	// Empty JSON has no type field, treated as legacy RouterOS.
	// Username and password will be empty strings but no error.
	require.NoError(t, err)
}

func TestParseRouterOSCredentials_MalformedJSON(t *testing.T) {
	_, _, err := ParseRouterOSCredentials([]byte(`not json`))
	require.Error(t, err)
}

// --- ParseSNMPCredentials tests ---

func TestParseSNMPCredentials_V2c(t *testing.T) {
	raw := []byte(`{"type":"snmp_v2c","community":"public"}`)
	cred, err := ParseSNMPCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "v2c", cred.Version)
	assert.Equal(t, "public", cred.Community)
}

func TestParseSNMPCredentials_V3AuthPriv(t *testing.T) {
	raw := []byte(`{"type":"snmp_v3","security_level":"auth_priv","username":"monitor","auth_protocol":"SHA256","auth_passphrase":"authpass123","priv_protocol":"AES128","priv_passphrase":"privpass456"}`)
	cred, err := ParseSNMPCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "v3", cred.Version)
	assert.Equal(t, "auth_priv", cred.SecurityLevel)
	assert.Equal(t, "monitor", cred.Username)
	assert.Equal(t, "SHA256", cred.AuthProtocol)
	assert.Equal(t, "authpass123", cred.AuthPass)
	assert.Equal(t, "AES128", cred.PrivProtocol)
	assert.Equal(t, "privpass456", cred.PrivPass)
}

func TestParseSNMPCredentials_V1(t *testing.T) {
	raw := []byte(`{"type":"snmp_v1","community":"public"}`)
	cred, err := ParseSNMPCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "v1", cred.Version)
	assert.Equal(t, "public", cred.Community)
}

func TestParseSNMPCredentials_RejectsRouterOS(t *testing.T) {
	raw := []byte(`{"type":"routeros","username":"admin","password":"secret"}`)
	_, err := ParseSNMPCredentials(raw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not an SNMP type")
}

func TestParseSNMPCredentials_RejectsLegacyNoType(t *testing.T) {
	raw := []byte(`{"username":"admin","password":"secret"}`)
	_, err := ParseSNMPCredentials(raw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not an SNMP type")
}

func TestParseSNMPCredentials_MalformedJSON(t *testing.T) {
	_, err := ParseSNMPCredentials([]byte(`not json`))
	require.Error(t, err)
}

func TestParseSNMPCredentials_EmptyJSON(t *testing.T) {
	// Empty JSON has no type field, treated as non-SNMP
	_, err := ParseSNMPCredentials([]byte(`{}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not an SNMP type")
}
