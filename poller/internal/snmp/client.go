package snmp

import (
	"fmt"

	"github.com/gosnmp/gosnmp"

	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// BuildSNMPClient constructs a gosnmp.GoSNMP struct configured for the given
// device and credential. It does NOT call Connect — the caller is responsible
// for establishing the UDP session and closing it when done.
//
// This supports SNMP v1, v2c, and all three v3 security levels.
func BuildSNMPClient(dev store.Device, cred *vault.SNMPCredential, cfg SNMPConfig) (*gosnmp.GoSNMP, error) {
	g := &gosnmp.GoSNMP{
		Target:         dev.IPAddress,
		Port:           uint16(dev.SNMPPort),
		Timeout:        cfg.Timeout,
		Retries:        cfg.Retries,
		MaxRepetitions: cfg.MaxRepetitions,
	}

	switch cred.Version {
	case "v1":
		g.Version = gosnmp.Version1
		g.Community = cred.Community

	case "v2c":
		g.Version = gosnmp.Version2c
		g.Community = cred.Community

	case "v3":
		g.Version = gosnmp.Version3
		g.SecurityModel = gosnmp.UserSecurityModel
		g.MsgFlags = mapSecurityLevel(cred.SecurityLevel)
		g.SecurityParameters = &gosnmp.UsmSecurityParameters{
			UserName:                 cred.Username,
			AuthenticationProtocol:   mapAuthProto(cred.AuthProtocol),
			AuthenticationPassphrase: cred.AuthPass,
			PrivacyProtocol:          mapPrivProto(cred.PrivProtocol),
			PrivacyPassphrase:        cred.PrivPass,
		}

	default:
		return nil, fmt.Errorf("unsupported SNMP version: %q", cred.Version)
	}

	return g, nil
}

// mapSecurityLevel maps credential security level strings to gosnmp v3 message flags.
func mapSecurityLevel(level string) gosnmp.SnmpV3MsgFlags {
	switch level {
	case "auth_priv":
		return gosnmp.AuthPriv
	case "auth_no_priv":
		return gosnmp.AuthNoPriv
	case "no_auth_no_priv":
		return gosnmp.NoAuthNoPriv
	default:
		return gosnmp.NoAuthNoPriv
	}
}

// mapAuthProto maps credential auth protocol strings to gosnmp v3 auth protocol constants.
func mapAuthProto(proto string) gosnmp.SnmpV3AuthProtocol {
	switch proto {
	case "MD5":
		return gosnmp.MD5
	case "SHA":
		return gosnmp.SHA
	case "SHA224":
		return gosnmp.SHA224
	case "SHA256":
		return gosnmp.SHA256
	case "SHA384":
		return gosnmp.SHA384
	case "SHA512":
		return gosnmp.SHA512
	default:
		return gosnmp.NoAuth
	}
}

// mapPrivProto maps credential privacy protocol strings to gosnmp v3 privacy protocol constants.
func mapPrivProto(proto string) gosnmp.SnmpV3PrivProtocol {
	switch proto {
	case "DES":
		return gosnmp.DES
	case "AES128":
		return gosnmp.AES
	case "AES192":
		return gosnmp.AES192
	case "AES256":
		return gosnmp.AES256
	default:
		return gosnmp.NoPriv
	}
}
