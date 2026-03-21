package vault

import (
	"encoding/json"
	"fmt"
)

// SNMPCredential holds parsed SNMP credential fields after decryption.
type SNMPCredential struct {
	Version       string // "v1", "v2c", "v3"
	Community     string // v1/v2c only
	SecurityLevel string // v3: "no_auth_no_priv", "auth_no_priv", "auth_priv"
	Username      string // v3
	AuthProtocol  string // v3: "MD5", "SHA", "SHA224", "SHA256", "SHA384", "SHA512"
	AuthPass      string // v3
	PrivProtocol  string // v3: "DES", "AES128", "AES192", "AES256"
	PrivPass      string // v3
}

// credentialEnvelope is the JSON structure common to all credential types.
// Used to peek at the type field before choosing a type-specific parser.
type credentialEnvelope struct {
	Type string `json:"type"`
}

// routerosCredentialJSON is the JSON shape for RouterOS credentials.
type routerosCredentialJSON struct {
	Type     string `json:"type"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// snmpCredentialJSON is the JSON shape for all SNMP credential types.
type snmpCredentialJSON struct {
	Type           string `json:"type"`
	Community      string `json:"community,omitempty"`
	SecurityLevel  string `json:"security_level,omitempty"`
	Username       string `json:"username,omitempty"`
	AuthProtocol   string `json:"auth_protocol,omitempty"`
	AuthPassphrase string `json:"auth_passphrase,omitempty"`
	PrivProtocol   string `json:"priv_protocol,omitempty"`
	PrivPassphrase string `json:"priv_passphrase,omitempty"`
}

// snmpTypeToVersion maps credential type strings to SNMP version identifiers.
var snmpTypeToVersion = map[string]string{
	"snmp_v1":  "v1",
	"snmp_v2c": "v2c",
	"snmp_v3":  "v3",
}

// ParseRouterOSCredentials extracts username and password from raw credential JSON.
// It handles both typed credentials ({"type":"routeros",...}) and legacy credentials
// without a type field ({"username":"admin","password":"secret"}).
func ParseRouterOSCredentials(raw []byte) (username, password string, err error) {
	var env credentialEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return "", "", fmt.Errorf("unmarshal credential envelope: %w", err)
	}

	// Legacy credentials have no type field -- treat as routeros.
	if env.Type != "" && env.Type != "routeros" {
		return "", "", fmt.Errorf("credential type %q is not routeros", env.Type)
	}

	var creds routerosCredentialJSON
	if err := json.Unmarshal(raw, &creds); err != nil {
		return "", "", fmt.Errorf("unmarshal routeros credentials: %w", err)
	}

	return creds.Username, creds.Password, nil
}

// ParseSNMPCredentials extracts SNMP credential fields from raw credential JSON.
// Supports snmp_v1, snmp_v2c, and snmp_v3 credential types.
// Rejects RouterOS-type credentials and legacy credentials without a type field.
func ParseSNMPCredentials(raw []byte) (*SNMPCredential, error) {
	var env credentialEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("unmarshal credential envelope: %w", err)
	}

	version, ok := snmpTypeToVersion[env.Type]
	if !ok {
		return nil, fmt.Errorf("credential type %q is not an SNMP type", env.Type)
	}

	var creds snmpCredentialJSON
	if err := json.Unmarshal(raw, &creds); err != nil {
		return nil, fmt.Errorf("unmarshal SNMP credentials: %w", err)
	}

	return &SNMPCredential{
		Version:       version,
		Community:     creds.Community,
		SecurityLevel: creds.SecurityLevel,
		Username:      creds.Username,
		AuthProtocol:  creds.AuthProtocol,
		AuthPass:      creds.AuthPassphrase,
		PrivProtocol:  creds.PrivProtocol,
		PrivPass:      creds.PrivPassphrase,
	}, nil
}
