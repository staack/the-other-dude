package device

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-routeros/routeros/v3/proto"
)

// startNonTLSListener accepts and answers with plain HTTP so a TLS client fails
// with "first record does not look like a TLS handshake": a device whose
// api-ssl port is really something else.
func startNonTLSListener(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				c.SetDeadline(time.Now().Add(2 * time.Second))
				io.WriteString(c, "HTTP/1.0 400 Bad Request\r\n\r\n")
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

// plainRecorder is a fake RouterOS API port.  It records every word it receives
// and answers any /login with the auth-failure trap a real device sends, so a
// probe can learn "the plain API answers here" without the real credentials.
type plainRecorder struct {
	mu     sync.Mutex
	words  []string
	legacy bool // answer the first /login with a challenge like pre-6.43 RouterOS
}

func (r *plainRecorder) saw(s string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, w := range r.words {
		if strings.Contains(w, s) {
			return true
		}
	}
	return false
}

func startPlainRecorder(t *testing.T) (int, *plainRecorder) {
	return startPlainRecorderOpts(t, false)
}

func startPlainRecorderOpts(t *testing.T, legacy bool) (int, *plainRecorder) {
	t.Helper()
	rec := &plainRecorder{legacy: legacy}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				c.SetDeadline(time.Now().Add(3 * time.Second))
				reader, writer := proto.NewReader(c), proto.NewWriter(c)
				for {
					sentence, err := reader.ReadSentence()
					if err != nil {
						return
					}
					rec.mu.Lock()
					rec.words = append(rec.words, sentence.Word)
					hasResponse := false
					for _, w := range sentence.List {
						rec.words = append(rec.words, w.Key+"="+w.Value)
						if w.Key == "response" {
							hasResponse = true
						}
					}
					rec.mu.Unlock()
					if rec.legacy && !hasResponse {
						// Pre-6.43 devices answer the first /login with a challenge.
						writer.BeginSentence()
						writer.WriteWord("!done")
						writer.WriteWord("=ret=00112233445566778899aabbccddeeff")
						if writer.EndSentence() != nil {
							return
						}
						continue
					}
					writer.BeginSentence()
					writer.WriteWord("!trap")
					if rec.legacy {
						writer.WriteWord("=message=incorrect login")
					} else {
						writer.WriteWord("=message=invalid user name or password (6)")
					}
					if writer.EndSentence() != nil {
						return
					}
					writer.BeginSentence()
					writer.WriteWord("!done")
					if writer.EndSentence() != nil {
						return
					}
				}
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, rec
}

func selfSignedCAPEM(t *testing.T) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "probe-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

// Real credentials must never cross the network in clear text unless the
// device was explicitly configured for plain mode.  A TLS-stage failure in
// auto, insecure or portal_ca mode used to trigger a cleartext /login with
// the real username and password to "check whether plain would work".
func TestProbeRouterOS_TLSFailureNeverSendsRealCredentialsInPlain(t *testing.T) {
	for _, tc := range []struct {
		mode string
		ca   []byte
	}{
		{"auto", nil},
		{"insecure", nil},
		{"portal_ca", selfSignedCAPEM(t)},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			sslPort := startNonTLSListener(t)
			plainPort, rec := startPlainRecorder(t)

			res := ProbeRouterOS("127.0.0.1", sslPort, plainPort, "real-user", "real-secret",
				2*time.Second, tc.ca, tc.mode)

			if res.OK {
				t.Fatalf("probe unexpectedly succeeded: %#v", res)
			}
			if rec.saw("real-secret") || rec.saw("real-user") {
				t.Fatalf("real credentials were sent in clear text to the plain port (mode %s)", tc.mode)
			}
		})
	}
}

// The downgrade hint stays useful: an auth-failure trap from the plain port
// proves the API answers there, and that is learned with throwaway
// credentials.
func TestProbeRouterOS_PlainSuggestionUsesThrowawayCredentials(t *testing.T) {
	sslPort := startNonTLSListener(t)
	plainPort, rec := startPlainRecorder(t)

	res := ProbeRouterOS("127.0.0.1", sslPort, plainPort, "real-user", "real-secret",
		2*time.Second, nil, "auto")

	if res.SuggestedTLSMode != "plain" {
		t.Fatalf("expected a plain-mode suggestion, got %q (reason %s: %s)", res.SuggestedTLSMode, res.Reason, res.Message)
	}
	if !rec.saw("/login") {
		t.Fatal("no login attempt reached the plain port")
	}
	if rec.saw("real-secret") || rec.saw("real-user") {
		t.Fatal("the suggestion probe used the real credentials")
	}
}

// A device pinned to CA verification is never offered a downgrade.
func TestProbeRouterOS_PortalCANeverSuggestsPlain(t *testing.T) {
	sslPort := startNonTLSListener(t)
	plainPort, rec := startPlainRecorder(t)

	res := ProbeRouterOS("127.0.0.1", sslPort, plainPort, "real-user", "real-secret",
		2*time.Second, selfSignedCAPEM(t), "portal_ca")

	if res.SuggestedTLSMode != "" {
		t.Fatalf("portal_ca probe suggested %q", res.SuggestedTLSMode)
	}
	if rec.saw("/login") {
		t.Fatal("portal_ca probe touched the plain port")
	}
}

type fakeTimeout struct{}

func (fakeTimeout) Error() string   { return "i/o timeout" }
func (fakeTimeout) Timeout() bool   { return true }
func (fakeTimeout) Temporary() bool { return true }

// Every TLS-mode connect error is wrapped in text containing "TLS", which used
// to swallow timeouts and resets into the TLS bucket (and trigger the plain
// probe).  The specific causes must win over the wrapper text.
func TestClassifyConnectError_TimeoutAndResetWinOverTLSWrapper(t *testing.T) {
	timeoutErr := fmt.Errorf("TLS connection to 10.0.0.1:8729 failed (auto mode — no plain-text fallback): %w",
		&net.OpError{Op: "read", Err: fakeTimeout{}})
	if _, reason, _ := classifyConnectError(timeoutErr, "10.0.0.1", 8729, "auto"); reason != ReasonTimeout {
		t.Fatalf("timeout classified as %s", reason)
	}
	eofErr := fmt.Errorf("insecure TLS connection to 10.0.0.1:8729 failed: %w", io.EOF)
	if _, reason, _ := classifyConnectError(eofErr, "10.0.0.1", 8729, "insecure"); reason != ReasonProtocolError {
		t.Fatalf("EOF classified as %s", reason)
	}
	resetErr := fmt.Errorf("CA-verified TLS connection to 10.0.0.1:8729 failed: %w", errors.New("read: connection reset by peer"))
	if _, reason, _ := classifyConnectError(resetErr, "10.0.0.1", 8729, "portal_ca"); reason != ReasonProtocolError {
		t.Fatalf("reset classified as %s", reason)
	}
	// A real TLS-layer failure still lands in the TLS bucket.
	tlsErr := fmt.Errorf("TLS connection to 10.0.0.1:8729 failed (auto mode — no plain-text fallback): %w",
		errors.New("tls: first record does not look like a TLS handshake"))
	if _, reason, _ := classifyConnectError(tlsErr, "10.0.0.1", 8729, "auto"); reason != ReasonTLSOther {
		t.Fatalf("TLS error classified as %s", reason)
	}
	_ = bytes.MinRead
}

// Pre-6.43 RouterOS rejects a bad login with "incorrect login" after a
// challenge-response exchange; that rejection proves the plain API just as
// well as the modern trap does.
func TestProbeRouterOS_PlainSuggestionHandlesLegacyLogin(t *testing.T) {
	sslPort := startNonTLSListener(t)
	plainPort, rec := startPlainRecorderOpts(t, true)

	res := ProbeRouterOS("127.0.0.1", sslPort, plainPort, "real-user", "real-secret",
		2*time.Second, nil, "auto")

	if res.SuggestedTLSMode != "plain" {
		t.Fatalf("expected a plain-mode suggestion from the legacy rejection, got %q (%s)", res.SuggestedTLSMode, res.Message)
	}
	if !rec.saw("response=") {
		t.Fatal("the challenge-response round trip did not happen")
	}
	if rec.saw("real-secret") || rec.saw("real-user") {
		t.Fatal("the suggestion probe used the real credentials")
	}
}
