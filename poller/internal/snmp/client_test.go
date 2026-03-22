package snmp

import (
	"testing"

	"github.com/gosnmp/gosnmp"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildSNMPClient_V2c(t *testing.T) {
	dev := store.Device{
		IPAddress: "10.0.0.1",
		SNMPPort:  161,
	}
	cred := &vault.SNMPCredential{
		Version:   "v2c",
		Community: "test-community",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, gosnmp.Version2c, g.Version)
	assert.Equal(t, "test-community", g.Community)
	assert.Equal(t, "10.0.0.1", g.Target)
	assert.Equal(t, uint16(161), g.Port)
}

func TestBuildSNMPClient_V1(t *testing.T) {
	dev := store.Device{
		IPAddress: "192.168.1.1",
		SNMPPort:  161,
	}
	cred := &vault.SNMPCredential{
		Version:   "v1",
		Community: "public",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, gosnmp.Version1, g.Version)
	assert.Equal(t, "public", g.Community)
}

func TestBuildSNMPClient_V3_AuthPriv(t *testing.T) {
	dev := store.Device{
		IPAddress: "10.0.0.2",
		SNMPPort:  1161,
	}
	cred := &vault.SNMPCredential{
		Version:       "v3",
		SecurityLevel: "auth_priv",
		Username:      "admin",
		AuthProtocol:  "SHA256",
		AuthPass:      "authpass123",
		PrivProtocol:  "AES128",
		PrivPass:      "privpass456",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, gosnmp.Version3, g.Version)
	assert.Equal(t, gosnmp.UserSecurityModel, g.SecurityModel)
	assert.Equal(t, gosnmp.AuthPriv, g.MsgFlags)
	assert.Equal(t, uint16(1161), g.Port)

	usp, ok := g.SecurityParameters.(*gosnmp.UsmSecurityParameters)
	require.True(t, ok, "SecurityParameters should be *UsmSecurityParameters")
	assert.Equal(t, "admin", usp.UserName)
	assert.Equal(t, gosnmp.SHA256, usp.AuthenticationProtocol)
	assert.Equal(t, "authpass123", usp.AuthenticationPassphrase)
	assert.Equal(t, gosnmp.AES, usp.PrivacyProtocol)
	assert.Equal(t, "privpass456", usp.PrivacyPassphrase)
}

func TestBuildSNMPClient_V3_AuthNoPriv(t *testing.T) {
	dev := store.Device{
		IPAddress: "10.0.0.3",
		SNMPPort:  161,
	}
	cred := &vault.SNMPCredential{
		Version:       "v3",
		SecurityLevel: "auth_no_priv",
		Username:      "monitor",
		AuthProtocol:  "SHA",
		AuthPass:      "authonly",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, gosnmp.Version3, g.Version)
	assert.Equal(t, gosnmp.AuthNoPriv, g.MsgFlags)

	usp := g.SecurityParameters.(*gosnmp.UsmSecurityParameters)
	assert.Equal(t, "monitor", usp.UserName)
	assert.Equal(t, gosnmp.SHA, usp.AuthenticationProtocol)
}

func TestBuildSNMPClient_V3_NoAuthNoPriv(t *testing.T) {
	dev := store.Device{
		IPAddress: "10.0.0.4",
		SNMPPort:  161,
	}
	cred := &vault.SNMPCredential{
		Version:       "v3",
		SecurityLevel: "no_auth_no_priv",
		Username:      "readonly",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, gosnmp.Version3, g.Version)
	assert.Equal(t, gosnmp.NoAuthNoPriv, g.MsgFlags)

	usp := g.SecurityParameters.(*gosnmp.UsmSecurityParameters)
	assert.Equal(t, "readonly", usp.UserName)
}

func TestMapAuthProto(t *testing.T) {
	tests := []struct {
		input    string
		expected gosnmp.SnmpV3AuthProtocol
	}{
		{"MD5", gosnmp.MD5},
		{"SHA", gosnmp.SHA},
		{"SHA224", gosnmp.SHA224},
		{"SHA256", gosnmp.SHA256},
		{"SHA384", gosnmp.SHA384},
		{"SHA512", gosnmp.SHA512},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, mapAuthProto(tt.input))
		})
	}
}

func TestMapPrivProto(t *testing.T) {
	tests := []struct {
		input    string
		expected gosnmp.SnmpV3PrivProtocol
	}{
		{"DES", gosnmp.DES},
		{"AES128", gosnmp.AES},
		{"AES192", gosnmp.AES192},
		{"AES256", gosnmp.AES256},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, mapPrivProto(tt.input))
		})
	}
}

func TestBuildSNMPClient_MaxRepetitions(t *testing.T) {
	dev := store.Device{
		IPAddress: "10.0.0.1",
		SNMPPort:  161,
	}
	cred := &vault.SNMPCredential{
		Version:   "v2c",
		Community: "public",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, uint32(10), g.MaxRepetitions, "MaxRepetitions must be 10, not gosnmp default 50")
}

func TestBuildSNMPClient_Timeout(t *testing.T) {
	dev := store.Device{
		IPAddress: "10.0.0.1",
		SNMPPort:  161,
	}
	cred := &vault.SNMPCredential{
		Version:   "v2c",
		Community: "public",
	}
	cfg := DefaultSNMPConfig()

	g, err := BuildSNMPClient(dev, cred, cfg)
	require.NoError(t, err)

	assert.Equal(t, cfg.Timeout, g.Timeout, "Timeout should come from config")
	assert.Equal(t, cfg.Retries, g.Retries, "Retries should come from config")
}
