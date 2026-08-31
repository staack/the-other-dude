// Package device handles RouterOS device connections and queries.
//
// probe.go implements a live connectivity probe that speaks the actual
// protocol -- TCP, then TLS, then a RouterOS API login -- rather than merely
// checking that a port is open.
//
// Why this exists: onboarding validation used to be a bare TCP connect. A
// RouterOS device with `api-ssl` enabled but `certificate=none` offers only
// anonymous-DH cipher suites, which Go's crypto/tls implements none of. The
// port is open, so the old check passed and the device onboarded green -- and
// then every subsequent poll failed forever, because polling goes through
// ConnectDevice, which cannot negotiate that handshake.
//
// The probe therefore runs ConnectDevice itself: the same function the poller
// uses. If the probe succeeds, a poll can succeed, because they are the same
// code path.

package device

import (
	"fmt"
	"net"
	"strings"
	"time"

	routeros "github.com/go-routeros/routeros/v3"
)

// ProbeStage identifies how far a probe got before failing.
type ProbeStage string

const (
	// StageTCP -- could not establish a TCP connection to the port at all.
	StageTCP ProbeStage = "tcp"
	// StageTLS -- TCP succeeded but the TLS handshake did not complete.
	StageTLS ProbeStage = "tls"
	// StageLogin -- transport succeeded but the RouterOS API login failed.
	StageLogin ProbeStage = "login"
	// StageQuery -- login succeeded but the identity query failed.
	StageQuery ProbeStage = "query"
	// StageDone -- the full handshake completed.
	StageDone ProbeStage = "done"
)

// ProbeReason is a stable machine-readable failure classification. The backend
// and UI branch on this; Message carries the human-facing text.
type ProbeReason string

const (
	ReasonOK                ProbeReason = "ok"
	ReasonUnreachable       ProbeReason = "unreachable"
	ReasonTimeout           ProbeReason = "timeout"
	ReasonTLSCipherMismatch ProbeReason = "tls_cipher_mismatch"
	ReasonTLSCertUntrusted  ProbeReason = "tls_cert_untrusted"
	ReasonTLSOther          ProbeReason = "tls_error"
	ReasonAuthFailed        ProbeReason = "auth_failed"
	ReasonProtocolError     ProbeReason = "protocol_error"
	ReasonUnknown           ProbeReason = "unknown"
)

// ProbeResult is the outcome of a live device probe.
type ProbeResult struct {
	OK      bool        `json:"ok"`
	Stage   ProbeStage  `json:"stage"`
	Reason  ProbeReason `json:"reason"`
	Message string      `json:"message"`
	Detail  string      `json:"detail,omitempty"`

	// TLSMode is the mode the probe was asked to use.
	TLSMode string `json:"tls_mode"`
	// SuggestedTLSMode is a mode that was *verified* to work when the
	// requested one did not. Empty when there is nothing to suggest.
	SuggestedTLSMode string `json:"suggested_tls_mode,omitempty"`

	// Identity fields, populated only on success.
	Identity  string `json:"identity,omitempty"`
	Version   string `json:"version,omitempty"`
	BoardName string `json:"board_name,omitempty"`

	ElapsedMS int64 `json:"elapsed_ms"`
}

// ProbeRouterOS performs a staged live probe of a RouterOS device.
//
// The stages are TCP reachability, then the full ConnectDevice path (TLS
// negotiation plus API login), then an identity query. Failure is attributed
// to the stage that failed and classified into a stable ProbeReason.
//
// The device need not exist in the database: all connection parameters are
// passed in, so this serves both onboarding validation and post-onboarding
// connection tests.
func ProbeRouterOS(
	ip string,
	sslPort, plainPort int,
	username, password string,
	timeout time.Duration,
	caCertPEM []byte,
	tlsMode string,
) ProbeResult {
	started := time.Now()
	res := ProbeResult{TLSMode: tlsMode}
	finish := func(r ProbeResult) ProbeResult {
		r.ElapsedMS = time.Since(started).Milliseconds()
		return r
	}

	// Which port this mode will actually use.
	port := sslPort
	portLabel := "RouterOS SSL API"
	if tlsMode == "plain" {
		port = plainPort
		portLabel = "RouterOS API"
	}

	// Stage 1: TCP. Separates "nothing is listening" from "listening but
	// unusable" -- conflating those is what made the old error useless.
	if err := tcpCheck(ip, port, tcpStageTimeout(timeout)); err != nil {
		res.Stage = StageTCP
		res.Reason, res.Message = classifyTCPError(err, ip, port, portLabel)
		res.Detail = err.Error()
		return finish(res)
	}

	// Stage 2 and 3: TLS negotiation and API login, via the exact function the
	// poller uses. Succeeding here is what makes a green device pollable.
	client, err := ConnectDevice(ip, sslPort, plainPort, username, password, timeout, caCertPEM, tlsMode)
	if err != nil {
		res.Stage, res.Reason, res.Message = classifyConnectError(err, ip, port, tlsMode)
		res.Detail = err.Error()

		// When TLS is the obstacle, find out whether the documented
		// workaround actually applies before recommending it.
		if res.Reason == ReasonTLSCipherMismatch || res.Reason == ReasonTLSOther {
			if plainPort > 0 && plainWorks(ip, plainPort, username, password, timeout) {
				res.SuggestedTLSMode = "plain"
			}
		}
		return finish(res)
	}
	defer CloseDevice(client)

	// Stage 4: prove the API answers, not just that login was accepted.
	identity, version, board, qerr := queryIdentity(client)
	if qerr != nil {
		res.Stage = StageQuery
		res.Reason = ReasonProtocolError
		res.Message = fmt.Sprintf("Logged in to %s but the RouterOS API did not answer a system query: %s", ip, qerr)
		res.Detail = qerr.Error()
		return finish(res)
	}

	res.OK = true
	res.Stage = StageDone
	res.Reason = ReasonOK
	res.Identity = identity
	res.Version = version
	res.BoardName = board
	res.Message = fmt.Sprintf("Connected to %s and completed a RouterOS API login.", ip)
	return finish(res)
}

// maxTCPStageTimeout caps how long the probe waits for a bare TCP connect.
//
// A host that silently drops packets costs this much per probe, and
// bulk adoption probes devices sequentially inside a single HTTP request that
// gunicorn kills at 120s -- which rolls back the entire batch. Keeping the TCP
// stage short bounds that blast radius. TLS and login still get the full
// timeout, because by then the host has already answered.
const maxTCPStageTimeout = 3 * time.Second

// tcpStageTimeout returns the TCP-stage budget: capped, but never larger than
// the caller's overall timeout.
func tcpStageTimeout(overall time.Duration) time.Duration {
	if overall < maxTCPStageTimeout {
		return overall
	}
	return maxTCPStageTimeout
}

// tcpCheck dials the port and immediately closes it.
func tcpCheck(ip string, port int, timeout time.Duration) error {
	addr := net.JoinHostPort(ip, fmt.Sprint(port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return err
	}
	return conn.Close()
}

// plainWorks reports whether a plain-text API login to plainPort succeeds. Used
// only to verify a suggestion before offering it, never as a silent fallback --
// auto mode's refusal to downgrade to plain text is deliberate.
func plainWorks(ip string, plainPort int, username, password string, timeout time.Duration) bool {
	client, err := ConnectDevice(ip, 0, plainPort, username, password, timeout, nil, "plain")
	if err != nil {
		return false
	}
	CloseDevice(client)
	return true
}

// queryIdentity fetches identity and version to confirm the API is usable.
func queryIdentity(client *routeros.Client) (identity, version, board string, err error) {
	if reply, rerr := client.Run("/system/identity/print"); rerr != nil {
		return "", "", "", rerr
	} else if len(reply.Re) > 0 {
		identity = reply.Re[0].Map["name"]
	}

	if reply, rerr := client.Run("/system/resource/print"); rerr == nil && len(reply.Re) > 0 {
		version = reply.Re[0].Map["version"]
		board = reply.Re[0].Map["board-name"]
	}
	return identity, version, board, nil
}

// classifyTCPError maps a dial failure to a reason and an actionable message.
func classifyTCPError(err error, ip string, port int, portLabel string) (ProbeReason, string) {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "timeout") || strings.Contains(s, "i/o timeout") || strings.Contains(s, "deadline exceeded"):
		return ReasonTimeout, fmt.Sprintf(
			"Timed out connecting to %s:%d (%s). The address may be wrong, or a firewall may be dropping the connection.",
			ip, port, portLabel)
	case strings.Contains(s, "no route to host") || strings.Contains(s, "network is unreachable"):
		return ReasonUnreachable, fmt.Sprintf(
			"No route to %s. Check the address and that this host can reach the device's network.", ip)
	default:
		return ReasonUnreachable, fmt.Sprintf(
			"Nothing is listening on %s:%d (%s). Enable the service on the device, or correct the port.",
			ip, port, portLabel)
	}
}

// classifyConnectError maps a ConnectDevice failure to a stage, a reason, and a
// message that names both the cause and the remedy.
func classifyConnectError(err error, ip string, port int, tlsMode string) (ProbeStage, ProbeReason, string) {
	s := strings.ToLower(err.Error())

	// Anonymous-DH: the defect this probe was written for. RouterOS with
	// api-ssl enabled and certificate=none offers only anonymous suites; Go's
	// crypto/tls implements none of them, so the server rejects the
	// ClientHello with a handshake_failure alert. InsecureSkipVerify cannot
	// help -- the failure is cipher negotiation, not certificate trust.
	isCipherMismatch := strings.Contains(s, "handshake failure") ||
		strings.Contains(s, "no cipher suite") ||
		strings.Contains(s, "unsupported cipher")
	if isCipherMismatch {
		return StageTLS, ReasonTLSCipherMismatch, fmt.Sprintf(
			"TLS handshake failed with %s:%d: no cipher overlap. This device almost certainly has api-ssl "+
				"enabled without a certificate, so it offers only anonymous-DH ciphers, which Go's TLS stack "+
				"cannot negotiate. Install a certificate on the device and set it on /ip/service api-ssl, "+
				"or onboard this device in plain mode.",
			ip, port)
	}

	switch {
	case strings.Contains(s, "x509") || strings.Contains(s, "certificate signed by unknown authority") ||
		strings.Contains(s, "certificate is not trusted") || strings.Contains(s, "certificate has expired") ||
		strings.Contains(s, "certificate is valid for"):
		return StageTLS, ReasonTLSCertUntrusted, fmt.Sprintf(
			"TLS handshake with %s:%d failed certificate verification: %s. "+
				"Check the device certificate, or use a TLS mode that does not require CA verification.",
			ip, port, err)

	case strings.Contains(s, "cannot log in") || strings.Contains(s, "invalid user") ||
		strings.Contains(s, "invalid username") || strings.Contains(s, "password") ||
		strings.Contains(s, "not logged in") || strings.Contains(s, "login failed"):
		return StageLogin, ReasonAuthFailed, fmt.Sprintf(
			"Reached %s:%d but the RouterOS API rejected the login. Check the username and password, "+
				"and that the account has API access.", ip, port)

	case strings.Contains(s, "tls") || strings.Contains(s, "protocol version") ||
		strings.Contains(s, "record header") || strings.Contains(s, "first record does not look like"):
		return StageTLS, ReasonTLSOther, fmt.Sprintf(
			"TLS negotiation with %s:%d failed: %s. If this device does not have api-ssl configured with a "+
				"certificate, try plain mode.", ip, port, err)

	case strings.Contains(s, "timeout") || strings.Contains(s, "deadline exceeded"):
		return StageTLS, ReasonTimeout, fmt.Sprintf(
			"Connected to %s:%d but the handshake timed out before completing.", ip, port)

	case strings.Contains(s, "eof") || strings.Contains(s, "connection reset") ||
		strings.Contains(s, "broken pipe"):
		return StageTLS, ReasonProtocolError, fmt.Sprintf(
			"%s:%d accepted the connection then closed it without completing a handshake. "+
				"This port may not be the RouterOS API, or the service may be restricted by an "+
				"address list on the device.", ip, port)

	default:
		return StageLogin, ReasonUnknown, fmt.Sprintf(
			"Could not complete a RouterOS API handshake with %s:%d (tls_mode=%s): %s", ip, port, tlsMode, err)
	}
}
