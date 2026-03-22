// Package bus provides NATS messaging for the poller service.
//
// discovery_responder.go implements a NATS request-reply handler for SNMP
// device discovery probes. The backend sends a request to "device.discover.snmp"
// with SNMP credentials, and receives sysObjectID, sysDescr, and sysName
// for the target device.
//
// Note: This file builds gosnmp clients inline rather than calling
// snmp.BuildSNMPClient to avoid an import cycle (snmp -> bus -> snmp).

package bus

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/gosnmp/gosnmp"
	"github.com/nats-io/nats.go"
)

// Standard MIB-II OIDs for device identification.
const (
	oidSysObjectID = "1.3.6.1.2.1.1.2.0"
	oidSysDescr    = "1.3.6.1.2.1.1.1.0"
	oidSysName     = "1.3.6.1.2.1.1.5.0"
)

// discoveryProbeTimeout is the maximum time for SNMP connect and GET operations.
const discoveryProbeTimeout = 5 * time.Second

// DiscoveryRequest is the JSON payload sent by the backend to probe a device.
// Credentials come directly in the request (the device is not yet stored).
type DiscoveryRequest struct {
	IPAddress     string `json:"ip_address"`
	SNMPPort      int    `json:"snmp_port"`
	SNMPVersion   string `json:"snmp_version"`
	Community     string `json:"community,omitempty"`
	SecurityLevel string `json:"security_level,omitempty"`
	Username      string `json:"username,omitempty"`
	AuthProtocol  string `json:"auth_protocol,omitempty"`
	AuthPass      string `json:"auth_passphrase,omitempty"`
	PrivProtocol  string `json:"priv_protocol,omitempty"`
	PrivPass      string `json:"priv_passphrase,omitempty"`
}

// DiscoveryResponse is returned to the backend with discovery results or an error.
type DiscoveryResponse struct {
	SysObjectID string `json:"sys_object_id,omitempty"`
	SysDescr    string `json:"sys_descr,omitempty"`
	SysName     string `json:"sys_name,omitempty"`
	Error       string `json:"error,omitempty"`
}

// DiscoveryResponder handles NATS request-reply for SNMP device discovery probes.
type DiscoveryResponder struct {
	nc  *nats.Conn
	sub *nats.Subscription
}

// NewDiscoveryResponder creates a discovery responder using the given NATS connection.
// No store or credential cache is needed -- credentials come in the request payload.
func NewDiscoveryResponder(nc *nats.Conn) *DiscoveryResponder {
	return &DiscoveryResponder{nc: nc}
}

// Start subscribes to "device.discover.snmp" with a queue group for load balancing
// across multiple poller instances.
func (r *DiscoveryResponder) Start() error {
	sub, err := r.nc.QueueSubscribe("device.discover.snmp", "discover-workers", r.handleRequest)
	if err != nil {
		return fmt.Errorf("subscribing to device.discover.snmp: %w", err)
	}
	r.sub = sub
	slog.Info("discovery responder subscribed", "subject", "device.discover.snmp", "queue", "discover-workers")
	return nil
}

// Stop unsubscribes from NATS.
func (r *DiscoveryResponder) Stop() {
	if r.sub != nil {
		if err := r.sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing discovery responder", "error", err)
		}
	}
}

// handleRequest processes a single SNMP discovery probe request.
func (r *DiscoveryResponder) handleRequest(msg *nats.Msg) {
	var req DiscoveryRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		r.respond(msg, DiscoveryResponse{Error: fmt.Sprintf("invalid request: %s", err)})
		return
	}

	// Validate required fields.
	if req.IPAddress == "" {
		r.respond(msg, DiscoveryResponse{Error: "ip_address is required"})
		return
	}
	switch req.SNMPVersion {
	case "v1", "v2c", "v3":
		// valid
	default:
		r.respond(msg, DiscoveryResponse{Error: fmt.Sprintf("unsupported snmp_version: %q (must be v1, v2c, or v3)", req.SNMPVersion)})
		return
	}

	// Default port.
	if req.SNMPPort == 0 {
		req.SNMPPort = 161
	}

	slog.Info("discovery probe starting", "ip", req.IPAddress, "version", req.SNMPVersion)

	// Build gosnmp client inline (avoids snmp -> bus import cycle).
	g := &gosnmp.GoSNMP{
		Target:  req.IPAddress,
		Port:    uint16(req.SNMPPort),
		Timeout: discoveryProbeTimeout,
		Retries: 1,
	}

	switch req.SNMPVersion {
	case "v1":
		g.Version = gosnmp.Version1
		g.Community = req.Community
	case "v2c":
		g.Version = gosnmp.Version2c
		g.Community = req.Community
	case "v3":
		g.Version = gosnmp.Version3
		g.SecurityModel = gosnmp.UserSecurityModel
		g.MsgFlags = discoveryMapSecurityLevel(req.SecurityLevel)
		g.SecurityParameters = &gosnmp.UsmSecurityParameters{
			UserName:                 req.Username,
			AuthenticationProtocol:   discoveryMapAuthProto(req.AuthProtocol),
			AuthenticationPassphrase: req.AuthPass,
			PrivacyProtocol:          discoveryMapPrivProto(req.PrivProtocol),
			PrivacyPassphrase:        req.PrivPass,
		}
	}

	// Connect with 5-second timeout.
	connDone := make(chan error, 1)
	go func() {
		connDone <- g.Connect()
	}()

	select {
	case err := <-connDone:
		if err != nil {
			r.respond(msg, DiscoveryResponse{Error: fmt.Sprintf("snmp probe failed: %s", err)})
			return
		}
	case <-time.After(discoveryProbeTimeout):
		r.respond(msg, DiscoveryResponse{Error: "snmp probe failed: connection timeout"})
		return
	}
	defer g.Conn.Close()

	// GET sysObjectID, sysDescr, sysName with 5-second timeout.
	type getResult struct {
		pkt *gosnmp.SnmpPacket
		err error
	}
	getDone := make(chan getResult, 1)
	go func() {
		pkt, err := g.Get([]string{oidSysObjectID, oidSysDescr, oidSysName})
		getDone <- getResult{pkt, err}
	}()

	var result getResult
	select {
	case result = <-getDone:
	case <-time.After(discoveryProbeTimeout):
		r.respond(msg, DiscoveryResponse{Error: "snmp probe failed: get timeout"})
		return
	}

	if result.err != nil {
		r.respond(msg, DiscoveryResponse{Error: fmt.Sprintf("snmp probe failed: %s", result.err)})
		return
	}

	// Parse PDU results.
	resp := DiscoveryResponse{}
	for _, pdu := range result.pkt.Variables {
		switch pdu.Name {
		case "." + oidSysObjectID:
			if pdu.Type == gosnmp.ObjectIdentifier {
				resp.SysObjectID = pdu.Value.(string)
			}
		case "." + oidSysDescr:
			if pdu.Type == gosnmp.OctetString {
				resp.SysDescr = string(pdu.Value.([]byte))
			}
		case "." + oidSysName:
			if pdu.Type == gosnmp.OctetString {
				resp.SysName = string(pdu.Value.([]byte))
			}
		}
	}

	slog.Info("discovery probe complete", "ip", req.IPAddress, "sys_object_id", resp.SysObjectID)
	r.respond(msg, resp)
}

// respond sends a JSON-encoded DiscoveryResponse to a NATS request.
func (r *DiscoveryResponder) respond(msg *nats.Msg, resp DiscoveryResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		slog.Error("failed to marshal discovery response", "error", err)
		return
	}
	if err := msg.Respond(data); err != nil {
		slog.Error("failed to respond to discovery request", "error", err)
	}
}

// discoveryMapSecurityLevel maps security level strings to gosnmp v3 message flags.
func discoveryMapSecurityLevel(level string) gosnmp.SnmpV3MsgFlags {
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

// discoveryMapAuthProto maps auth protocol strings to gosnmp v3 auth protocol constants.
func discoveryMapAuthProto(proto string) gosnmp.SnmpV3AuthProtocol {
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

// discoveryMapPrivProto maps privacy protocol strings to gosnmp v3 privacy protocol constants.
func discoveryMapPrivProto(proto string) gosnmp.SnmpV3PrivProtocol {
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
