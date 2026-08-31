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

// --- ParseSSHCredentials tests ---
//
// SSH auth material may arrive as a legacy/routeros envelope (password only)
// or as an ssh_key envelope carrying a private key, optionally with a password
// retained as a fallback during migration.

func TestParseSSHCredentials_SSHKeyType(t *testing.T) {
	raw := []byte(`{"type":"ssh_key","username":"admin","private_key":"-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"}`)
	creds, err := ParseSSHCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "admin", creds.Username)
	assert.Contains(t, creds.PrivateKey, "BEGIN OPENSSH PRIVATE KEY")
	assert.Empty(t, creds.Password)
}

func TestParseSSHCredentials_SSHKeyWithPasswordFallback(t *testing.T) {
	raw := []byte(`{"type":"ssh_key","username":"admin","private_key":"KEYDATA","password":"fallback"}`)
	creds, err := ParseSSHCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "KEYDATA", creds.PrivateKey)
	assert.Equal(t, "fallback", creds.Password)
}

func TestParseSSHCredentials_RouterOSTypeStillWorks(t *testing.T) {
	// Existing password deployments must keep working untouched.
	raw := []byte(`{"type":"routeros","username":"admin","password":"secret"}`)
	creds, err := ParseSSHCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "admin", creds.Username)
	assert.Equal(t, "secret", creds.Password)
	assert.Empty(t, creds.PrivateKey)
}

func TestParseSSHCredentials_LegacyNoTypeField(t *testing.T) {
	raw := []byte(`{"username":"admin","password":"secret"}`)
	creds, err := ParseSSHCredentials(raw)
	require.NoError(t, err)
	assert.Equal(t, "admin", creds.Username)
	assert.Equal(t, "secret", creds.Password)
	assert.Empty(t, creds.PrivateKey)
}

func TestParseSSHCredentials_RejectsSNMPType(t *testing.T) {
	raw := []byte(`{"type":"snmp_v2c","community":"public"}`)
	_, err := ParseSSHCredentials(raw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not usable for SSH")
}

func TestParseSSHCredentials_MalformedJSON(t *testing.T) {
	_, err := ParseSSHCredentials([]byte(`not json`))
	require.Error(t, err)
}
