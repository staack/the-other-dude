#!/usr/bin/env bash
# Prove a winbox-worker image can actually start a WinBox session, not just
# that `docker build` succeeded. A version bump can pass a build (the
# archive downloads, the checksum matches, unzip succeeds) and still ship a
# WinBox binary that crashes on launch -- wrong glibc, missing shared lib,
# whatever. This is the check that catches that before merge.
#
# What this does NOT do: connect the launched WinBox to a real MikroTik
# device. It points WinBox at a closed local port so the connection dialog
# itself fails -- the goal is proving the process tree launches, not
# exercising RouterOS API auth.
#
# Usage: winbox-worker/scripts/smoke_test.sh <image-ref>
set -euo pipefail

IMAGE_REF="${1:?usage: smoke_test.sh <image-ref>}"
CONTAINER_NAME="winbox-smoke-test-$$"
HOST_PORT="19090"

cleanup() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    echo "--- smoke test failed, container logs follow ---" >&2
    docker logs "$CONTAINER_NAME" 2>&1 || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

echo "starting $IMAGE_REF as $CONTAINER_NAME"
docker run -d --name "$CONTAINER_NAME" -p "${HOST_PORT}:9090" \
  -e WINBOX_WORKER_TOKEN=smoke-test-token "$IMAGE_REF" >/dev/null

echo "waiting for /healthz"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1; then
  echo "error: worker never became healthy" >&2
  exit 1
fi

echo "confirming the control API refuses requests without the shared secret"
UNAUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/sessions")"
if [ "$UNAUTH_CODE" != "401" ]; then
  echo "error: control API answered $UNAUTH_CODE without X-Worker-Token, expected 401" >&2
  exit 1
fi

echo "creating a session against the baked-in WinBox binary"
CREATE_RESPONSE="$(curl -fsS -X POST "http://127.0.0.1:${HOST_PORT}/sessions" \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Service: smoke-test' \
  -H 'X-Worker-Token: smoke-test-token' \
  -d '{"session_id":"smoke-test","tunnel_host":"127.0.0.1","tunnel_port":1,"username":"smokeuser","password":"zq8-sentinel-pw"}')"
echo "create response: $CREATE_RESPONSE"

STATUS="$(echo "$CREATE_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status", ""))')"
if [ "$STATUS" != "active" ]; then
  echo "error: session did not reach active state (got: ${STATUS:-<none>})" >&2
  exit 1
fi

echo "confirming the WinBox process is actually running inside the container"
if ! docker exec "$CONTAINER_NAME" pgrep -f WinBox >/dev/null 2>&1; then
  echo "error: xpra reported ready but no WinBox process is running -- the binary likely crashed on launch" >&2
  exit 1
fi

echo "confirming xpra's argv carries no credentials"
# Only xpra's own command line is inspected (not the shell running this
# check, and not WinBox, whose positional arguments are the credentials).
XPRA_CMDLINES="$(docker exec "$CONTAINER_NAME" sh -c 'for p in $(pgrep -x xpra); do tr "\0" " " < /proc/$p/cmdline; echo; done')"
if [ -z "$XPRA_CMDLINES" ]; then
  echo "error: no xpra process found to inspect" >&2
  exit 1
fi
if echo "$XPRA_CMDLINES" | grep -q "zq8-sentinel-pw"; then
  echo "error: the device password is visible in xpra's command line" >&2
  exit 1
fi
if ! echo "$XPRA_CMDLINES" | grep -q -- "--start-child=/tmp/winbox-sessions/smoke-test/launch.sh"; then
  echo "error: xpra was not started through the session launcher" >&2
  exit 1
fi

echo "terminating the session"
curl -fsS -X DELETE "http://127.0.0.1:${HOST_PORT}/sessions/smoke-test" \
  -H 'X-Internal-Service: smoke-test' \
  -H 'X-Worker-Token: smoke-test-token' >/dev/null

echo "confirming the process tree is gone"
for _ in $(seq 1 20); do
  if ! docker exec "$CONTAINER_NAME" pgrep -f WinBox >/dev/null 2>&1 \
     && ! docker exec "$CONTAINER_NAME" pgrep Xvfb >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if docker exec "$CONTAINER_NAME" pgrep -f WinBox >/dev/null 2>&1; then
  echo "error: WinBox survived session termination" >&2
  exit 1
fi
if docker exec "$CONTAINER_NAME" pgrep Xvfb >/dev/null 2>&1; then
  echo "error: Xvfb survived session termination" >&2
  exit 1
fi
SESSIONS_LEFT="$(curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessions", -1))')"
if [ "$SESSIONS_LEFT" != "0" ]; then
  echo "error: worker still reports $SESSIONS_LEFT session(s) after termination" >&2
  exit 1
fi

echo "smoke test passed: $IMAGE_REF starts, guards and tears down a real WinBox session"
