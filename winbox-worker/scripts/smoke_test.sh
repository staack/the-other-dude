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
docker run -d --name "$CONTAINER_NAME" -p "${HOST_PORT}:9090" "$IMAGE_REF" >/dev/null

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

echo "creating a session against the baked-in WinBox binary"
CREATE_RESPONSE="$(curl -fsS -X POST "http://127.0.0.1:${HOST_PORT}/sessions" \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Service: smoke-test' \
  -d '{"session_id":"smoke-test","tunnel_host":"127.0.0.1","tunnel_port":1,"username":"smoke","password":"smoke"}')"
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

echo "terminating the session"
curl -fsS -X DELETE "http://127.0.0.1:${HOST_PORT}/sessions/smoke-test" \
  -H 'X-Internal-Service: smoke-test' >/dev/null

echo "smoke test passed: $IMAGE_REF starts a real WinBox session"
