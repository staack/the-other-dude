#!/usr/bin/env bash
#
# Tests for the storage-loss guard in init.sh.
#
# The guard is the thing standing between "the Transit keys were deleted" and
# "the Transit keys were deleted and then overwritten with new ones, and the
# operator pasted the new credentials into .env.prod because the API was
# returning 403s". The first is recoverable from any backup. The second is not.
#
# Run: ./infrastructure/openbao/init_guard_test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Sourcing init.sh with this set defines its functions without running the
# initialisation flow, which needs a live OpenBao.
export OPENBAO_INIT_SOURCE_ONLY=1
# shellcheck source=/dev/null
. "${HERE}/init.sh"
set +e  # init.sh sets -e; the assertions below handle their own failures

pass=0
fail=0

ok()   { pass=$((pass + 1)); printf '  ok    %s\n' "$1"; }
notok() { fail=$((fail + 1)); printf '  FAIL  %s\n' "$1"; }

# assert_allows runs the guard in a subshell and expects it to permit init.
assert_allows() {
    local desc="$1" key="$2"
    if ( BAO_UNSEAL_KEY="$key" refuse_if_storage_was_lost >/dev/null 2>&1 ); then
        ok "$desc"
    else
        notok "$desc — the guard blocked a legitimate first run"
    fi
}

# assert_refuses expects a non-zero exit and a message naming the cause.
assert_refuses() {
    local desc="$1" key="$2"
    local output status
    output="$( BAO_UNSEAL_KEY="$key" refuse_if_storage_was_lost 2>&1 )" && status=0 || status=$?

    if [ "$status" -eq 0 ]; then
        notok "$desc — the guard allowed re-initialisation over lost storage"
        return
    fi
    case "$output" in
        *"already initialised"*|*"already initialized"*|*"storage"*)
            ok "$desc" ;;
        *)
            notok "$desc — refused, but the message does not explain why: ${output}" ;;
    esac
}

echo "init.sh storage-loss guard"

# A genuine first run has no unseal key, because one has never been generated.
assert_allows "empty BAO_UNSEAL_KEY is a first run" ""

# setup.py writes this sentinel into .env.prod before OpenBao has ever started
# (setup.py:1272-1273), so it must read as "no key yet", not as a real one.
assert_allows "PLACEHOLDER_RUN_SETUP is a first run" "PLACEHOLDER_RUN_SETUP"

# Holding a real unseal key for a store that does not exist is never a first
# run. It means the storage was destroyed or the mount path is wrong.
assert_refuses "a real unseal key with no storage is refused" "hV7v3Qw9RkT2mZx4LpN6bY8cD1sF0gJ5aH2eK7uW3iM="

# A key with surrounding whitespace is still a key.
assert_refuses "a whitespace-padded key is still a key" "  hV7v3Qw9RkT2mZx4LpN6bY8cD1sF0gJ5aH2eK7uW3iM=  "

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
