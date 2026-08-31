package sshrelay

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return rc, mr
}

func TestValidateToken_Valid(t *testing.T) {
	rc, _ := setupRedis(t)
	s := &Server{redis: rc, sessions: make(map[string]*Session)}

	payload := TokenPayload{DeviceID: "d1", TenantID: "t1", UserID: "u1", Cols: 80, Rows: 24, CreatedAt: time.Now().Unix()}
	data, _ := json.Marshal(payload)
	rc.Set(context.Background(), "ssh:token:abc123", string(data), 120*time.Second)

	result, err := s.validateToken(context.Background(), "abc123")
	require.NoError(t, err)
	assert.Equal(t, "d1", result.DeviceID)

	// Token consumed — second use should fail
	_, err = s.validateToken(context.Background(), "abc123")
	assert.Error(t, err)
}

func TestValidateToken_Expired(t *testing.T) {
	rc, mr := setupRedis(t)
	s := &Server{redis: rc, sessions: make(map[string]*Session)}

	payload := TokenPayload{DeviceID: "d1", TenantID: "t1", UserID: "u1"}
	data, _ := json.Marshal(payload)
	rc.Set(context.Background(), "ssh:token:expired", string(data), 1*time.Millisecond)
	mr.FastForward(2 * time.Second)

	_, err := s.validateToken(context.Background(), "expired")
	assert.Error(t, err)
}

func TestCheckLimits_MaxSessions(t *testing.T) {
	s := &Server{
		sessions:     make(map[string]*Session),
		maxSessions:  2,
		maxPerUser:   10,
		maxPerDevice: 10,
	}
	s.sessions["s1"] = &Session{UserID: "u1", DeviceID: "d1"}
	s.sessions["s2"] = &Session{UserID: "u2", DeviceID: "d2"}

	err := s.checkLimits("u3", "d3")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "max sessions exceeded")
}

func TestCheckLimits_MaxPerUser(t *testing.T) {
	s := &Server{
		sessions:     make(map[string]*Session),
		maxSessions:  100,
		maxPerUser:   2,
		maxPerDevice: 100,
	}
	s.sessions["s1"] = &Session{UserID: "u1", DeviceID: "d1"}
	s.sessions["s2"] = &Session{UserID: "u1", DeviceID: "d2"}

	err := s.checkLimits("u1", "d3")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "per user")
}

func TestCheckLimits_MaxPerDevice(t *testing.T) {
	s := &Server{
		sessions:     make(map[string]*Session),
		maxSessions:  100,
		maxPerUser:   100,
		maxPerDevice: 1,
	}
	s.sessions["s1"] = &Session{UserID: "u1", DeviceID: "d1"}

	err := s.checkLimits("u2", "d1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "per device")
}

func TestSessionList(t *testing.T) {
	s := &Server{sessions: make(map[string]*Session)}
	s.sessions["s1"] = &Session{ID: "s1", DeviceID: "d1", StartTime: time.Now(), LastActive: time.Now().UnixNano()}
	s.sessions["s2"] = &Session{ID: "s2", DeviceID: "d1", StartTime: time.Now(), LastActive: time.Now().UnixNano()}
	s.sessions["s3"] = &Session{ID: "s3", DeviceID: "d2", StartTime: time.Now(), LastActive: time.Now().UnixNano()}

	list := s.SessionList("d1")
	assert.Len(t, list, 2)
}

// ---------------------------------------------------------------------------
// /healthz dependency reporting
//
// The handler used to write {"status":"ok"} unconditionally, so a poller that
// had lost NATS and was dropping every metric still passed its container
// healthcheck. These tests pin the handler to the actual state of its probes.
// ---------------------------------------------------------------------------

func healthResponse(t *testing.T, s *Server) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.handleHealth(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return rec.Code, body
}

func TestHandleHealth_AllProbesPass(t *testing.T) {
	s := &Server{probes: map[string]HealthProbe{
		"redis": func(context.Context) error { return nil },
		"nats":  func(context.Context) error { return nil },
	}}

	code, body := healthResponse(t, s)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "ok", body["status"])
	assert.Equal(t, "ok", body["checks"].(map[string]any)["redis"])
	assert.Equal(t, "ok", body["checks"].(map[string]any)["nats"])
}

func TestHandleHealth_FailingProbeIsReportedAndReturns503(t *testing.T) {
	s := &Server{probes: map[string]HealthProbe{
		"redis": func(context.Context) error { return nil },
		"nats":  func(context.Context) error { return errors.New("not connected") },
	}}

	code, body := healthResponse(t, s)
	assert.Equal(t, http.StatusServiceUnavailable, code)
	assert.Equal(t, "degraded", body["status"])

	checks := body["checks"].(map[string]any)
	assert.Equal(t, "ok", checks["redis"])
	assert.Contains(t, checks["nats"], "not connected",
		"the failing dependency must be named in the body, not just implied by the status code")
}

// The point of the whole change: the probe has to track the real dependency,
// not a constant. Same server, same handler, Redis pulled out from under it.
func TestHandleHealth_RedisProbeTracksRealRedis(t *testing.T) {
	rc, mr := setupRedis(t)
	s := &Server{probes: map[string]HealthProbe{
		"redis": func(ctx context.Context) error { return rc.Ping(ctx).Err() },
	}}

	code, body := healthResponse(t, s)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "ok", body["status"])

	mr.Close()

	code, body = healthResponse(t, s)
	assert.Equal(t, http.StatusServiceUnavailable, code)
	assert.Equal(t, "degraded", body["status"])
}

// A Server built without probes (as several tests in this file do) must not
// start reporting itself unhealthy.
func TestHandleHealth_NoProbesConfigured(t *testing.T) {
	code, body := healthResponse(t, &Server{})
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "ok", body["status"])
}
