#!/usr/bin/env python3
"""Config Editor smoke test — hits every menu path against a live device.

Authenticates to the TOD API, picks the first online device, and systematically
tests browse on every path from the MenuTree. Also tests add/edit/delete on
safe disposable paths, and tests the CLI execute endpoint.

Usage:
    python3 scripts/test_config_editor.py [--base-url URL] [--device HOSTNAME]

Requires: requests (pip install requests)
"""

import argparse
import json
import sys
import time

import requests

# ── Config ──────────────────────────────────────────────────────────────────

DEFAULT_BASE_URL = "http://localhost:8001"
LOGIN_EMAIL = "admin@mikrotik-portal.dev"
LOGIN_PASSWORD = "changeme-in-production"

# Every leaf path from MenuTree.tsx (the ones users can actually click)
BROWSE_PATHS = [
    # interface
    "/interface",
    "/interface/bridge",
    "/interface/ethernet",
    "/interface/vlan",
    "/interface/wifi",
    "/interface/bonding",
    "/interface/list",
    # ip
    "/ip/address",
    "/ip/route",
    "/ip/dns",
    "/ip/dhcp-client",
    "/ip/dhcp-server",
    "/ip/pool",
    "/ip/service",
    "/ip/neighbor",
    # ip firewall
    "/ip/firewall/filter",
    "/ip/firewall/nat",
    "/ip/firewall/mangle",
    "/ip/firewall/raw",
    "/ip/firewall/address-list",
    "/ip/firewall/connection",
    # system
    "/system/identity",
    "/system/clock",
    "/system/ntp/client",
    "/system/ntp/server",
    "/system/resource",
    "/system/routerboard",
    "/system/scheduler",
    "/system/script",
    "/system/logging",
    "/system/package",
    # routing
    "/routing/ospf/instance",
    "/routing/ospf/area",
    "/routing/ospf/interface-template",
    "/routing/ospf/static-neighbor",
    "/routing/bgp/connection",
    "/routing/bgp/template",
    "/routing/filter/rule",
    "/routing/table",
    "/routing/rule",
    # queue
    "/queue/simple",
    "/queue/tree",
    "/queue/type",
    # tool
    "/tool/bandwidth-server",
    "/tool/e-mail",
    "/tool/graphing",
    "/tool/netwatch",
    "/tool/sniffer",
    # other
    "/user",
    "/snmp",
    "/certificate",
]

# Paths that depend on device hardware/packages — one of these will work
# but not necessarily both. Warn instead of fail.
CONDITIONAL_PATHS = [
    "/interface/wireless",  # Legacy wireless package (ROS6 or ROS7 with wifi-qcom)
]

# Container / parent paths that the tree shows as expandable folders.
# These typically can't be /print'd directly in RouterOS, so we expect
# them to fail. We test them separately so you know which are real failures
# vs expected container failures.
CONTAINER_PATHS = [
    "/ip",
    "/ip/firewall",
    "/system",
    "/routing",
    "/routing/ospf",
    "/routing/bgp",
    "/queue",
    "/tool",
]

# Safe path for testing add/edit/delete (firewall address-list is disposable)
SAFE_WRITE_PATH = "/ip/firewall/address-list"
SAFE_ADD_PROPS = {"list": "tod-smoke-test", "address": "192.0.2.1", "comment": "TOD config editor smoke test — safe to delete"}


# ── Helpers ─────────────────────────────────────────────────────────────────

class Colors:
    OK = "\033[92m"
    FAIL = "\033[91m"
    WARN = "\033[93m"
    DIM = "\033[90m"
    BOLD = "\033[1m"
    END = "\033[0m"


def ok(msg):
    print(f"  {Colors.OK}PASS{Colors.END}  {msg}")


def fail(msg, detail=""):
    extra = f" — {Colors.DIM}{detail}{Colors.END}" if detail else ""
    print(f"  {Colors.FAIL}FAIL{Colors.END}  {msg}{extra}")


def warn(msg, detail=""):
    extra = f" — {Colors.DIM}{detail}{Colors.END}" if detail else ""
    print(f"  {Colors.WARN}WARN{Colors.END}  {msg}{extra}")


def skip(msg, detail=""):
    extra = f" — {Colors.DIM}{detail}{Colors.END}" if detail else ""
    print(f"  {Colors.DIM}SKIP{Colors.END}  {msg}{extra}")


def section(title):
    print(f"\n{Colors.BOLD}{'─' * 60}{Colors.END}")
    print(f"{Colors.BOLD}  {title}{Colors.END}")
    print(f"{Colors.BOLD}{'─' * 60}{Colors.END}")


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Config editor smoke test")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--device", default=None, help="Hostname of device to test (default: first online)")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    session = requests.Session()
    session.verify = True  # use TLS

    results = {"pass": 0, "fail": 0, "warn": 0, "skip": 0}

    # ── 1. Login ────────────────────────────────────────────────────────────
    section("Authentication")

    resp = session.post(f"{base}/api/auth/login", json={
        "email": LOGIN_EMAIL,
        "password": LOGIN_PASSWORD,
    })
    if resp.status_code != 200:
        fail(f"Login failed: HTTP {resp.status_code}")
        print(f"  Response: {resp.text[:200]}")
        sys.exit(1)

    auth_data = resp.json()
    token = auth_data.get("access_token")
    if not token:
        fail("Login response missing access_token")
        sys.exit(1)

    session.headers["Authorization"] = f"Bearer {token}"
    ok("Logged in")
    results["pass"] += 1

    # ── 2. Find tenant and device ───────────────────────────────────────────
    section("Device Discovery")

    # Get user info to find tenant
    resp = session.get(f"{base}/api/auth/me")
    if resp.status_code != 200:
        fail(f"/api/auth/me failed: HTTP {resp.status_code}")
        sys.exit(1)

    me = resp.json()
    tenant_id = me.get("tenant_id")
    if not tenant_id:
        # Super admin — need to pick a tenant that has devices
        resp = session.get(f"{base}/api/tenants")
        if resp.status_code != 200:
            fail(f"/api/tenants failed: HTTP {resp.status_code}")
            sys.exit(1)
        tenants = resp.json()
        if isinstance(tenants, dict):
            tenants = tenants.get("tenants", tenants.get("data", []))
        # Filter out system tenants, prefer tenants with devices
        non_system = [t for t in tenants if "system" not in t.get("name", "").lower()]
        if non_system:
            tenant_id = non_system[0]["id"]
            ok(f"Using tenant: {non_system[0].get('name', tenant_id)}")
        elif tenants:
            tenant_id = tenants[0]["id"]
            ok(f"Using tenant: {tenants[0].get('name', tenant_id)}")
        else:
            fail("No tenants found")
            sys.exit(1)
    else:
        ok(f"Tenant: {tenant_id}")
    results["pass"] += 1

    # Get devices to find an online device
    resp = session.get(f"{base}/api/tenants/{tenant_id}/devices")
    if resp.status_code != 200:
        fail(f"Devices endpoint failed: HTTP {resp.status_code}")
        sys.exit(1)

    devices = resp.json()
    if isinstance(devices, dict):
        devices = devices.get("items", devices.get("devices", devices.get("data", [])))

    online_devices = [d for d in devices if d.get("status") == "online"]
    if not online_devices:
        fail("No online devices found — config editor requires a live device")
        sys.exit(1)

    if args.device:
        matches = [d for d in online_devices if d.get("hostname") == args.device]
        if not matches:
            fail(f"Device '{args.device}' not found or not online")
            print(f"  Online devices: {[d.get('hostname') for d in online_devices]}")
            sys.exit(1)
        device = matches[0]
    else:
        device = online_devices[0]

    device_id = device["id"]
    hostname = device.get("hostname", "unknown")
    ok(f"Device: {hostname} ({device.get('ip_address', '?')}) — {device.get('model', '?')}")
    print(f"         {len(online_devices)} online device(s) available")
    results["pass"] += 1

    # ── 3. Browse every menu path ───────────────────────────────────────────
    section(f"Browse Tests — {len(BROWSE_PATHS)} paths")

    browse_results = {}
    for path in BROWSE_PATHS:
        try:
            resp = session.get(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/browse",
                params={"path": path},
                timeout=20,
            )
            if resp.status_code == 200:
                data = resp.json()
                entries = data.get("entries", [])
                n = len(entries)
                cols = list(entries[0].keys()) if entries else []
                col_summary = ", ".join(cols[:5]) + ("..." if len(cols) > 5 else "") if cols else "no columns"
                ok(f"{path:45s} {n:3d} entries  [{col_summary}]")
                browse_results[path] = {"status": "pass", "entries": n}
                results["pass"] += 1
            elif resp.status_code == 403:
                warn(f"{path:45s} BLOCKED (403)")
                browse_results[path] = {"status": "blocked", "detail": resp.json().get("detail", "")}
                results["warn"] += 1
            elif resp.status_code == 502:
                detail = ""
                try:
                    detail = resp.json().get("detail", "")
                except Exception:
                    detail = resp.text[:100]
                fail(f"{path:45s} 502 Bad Gateway", detail)
                browse_results[path] = {"status": "fail", "detail": detail}
                results["fail"] += 1
            else:
                detail = resp.text[:100]
                fail(f"{path:45s} HTTP {resp.status_code}", detail)
                browse_results[path] = {"status": "fail", "detail": detail}
                results["fail"] += 1
        except requests.exceptions.Timeout:
            fail(f"{path:45s} TIMEOUT (20s)")
            browse_results[path] = {"status": "fail", "detail": "timeout"}
            results["fail"] += 1
        except Exception as e:
            fail(f"{path:45s} ERROR", str(e))
            browse_results[path] = {"status": "fail", "detail": str(e)}
            results["fail"] += 1

        # Small delay to avoid rate limiting
        time.sleep(0.2)

    # ── 3b. Conditional paths (hardware-dependent, warn on failure) ────────
    section(f"Conditional Paths — {len(CONDITIONAL_PATHS)} paths (device-dependent)")

    for path in CONDITIONAL_PATHS:
        try:
            resp = session.get(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/browse",
                params={"path": path},
                timeout=20,
            )
            if resp.status_code == 200:
                data = resp.json()
                entries = data.get("entries", [])
                ok(f"{path:45s} {len(entries):3d} entries")
                results["pass"] += 1
            else:
                detail = ""
                try:
                    detail = resp.json().get("detail", "")[:80]
                except Exception:
                    detail = resp.text[:80]
                warn(f"{path:45s} not available on this device", detail)
                results["warn"] += 1
        except Exception as e:
            warn(f"{path:45s} ERROR", str(e)[:80])
            results["warn"] += 1
        time.sleep(0.2)

    # ── 4. Container paths (expected to fail on most RouterOS versions) ─────
    section(f"Container Path Tests — {len(CONTAINER_PATHS)} paths (may fail, that's OK)")

    for path in CONTAINER_PATHS:
        try:
            resp = session.get(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/browse",
                params={"path": path},
                timeout=20,
            )
            if resp.status_code == 200:
                data = resp.json()
                entries = data.get("entries", [])
                ok(f"{path:45s} {len(entries):3d} entries (container works!)")
                results["pass"] += 1
            else:
                detail = ""
                try:
                    detail = resp.json().get("detail", "")[:80]
                except Exception:
                    detail = resp.text[:80]
                skip(f"{path:45s} HTTP {resp.status_code}", detail)
                results["skip"] += 1
        except Exception as e:
            skip(f"{path:45s} ERROR", str(e)[:80])
            results["skip"] += 1
        time.sleep(0.2)

    # ── 5. Add / Edit / Delete test ─────────────────────────────────────────
    section("Write Operations (add → edit → delete)")

    added_id = None

    # Add
    try:
        resp = session.post(
            f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/add",
            json={"path": SAFE_WRITE_PATH, "properties": SAFE_ADD_PROPS},
            timeout=20,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("success"):
                # Try to find the ID of our new entry
                ok(f"ADD  {SAFE_WRITE_PATH} — success")
                results["pass"] += 1

                # Browse to find our entry's .id
                time.sleep(0.5)
                resp2 = session.get(
                    f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/browse",
                    params={"path": SAFE_WRITE_PATH},
                    timeout=20,
                )
                if resp2.status_code == 200:
                    for e in resp2.json().get("entries", []):
                        if e.get("comment") == SAFE_ADD_PROPS["comment"]:
                            added_id = e.get(".id")
                            break
                if added_id:
                    ok(f"     Found added entry: {added_id}")
                else:
                    warn("     Could not find added entry by comment — will skip edit/delete")
            else:
                fail(f"ADD  {SAFE_WRITE_PATH}", data.get("error", "unknown error"))
                results["fail"] += 1
        else:
            detail = ""
            try:
                detail = resp.json().get("detail", "")
            except Exception:
                detail = resp.text[:100]
            fail(f"ADD  {SAFE_WRITE_PATH} — HTTP {resp.status_code}", detail)
            results["fail"] += 1
    except Exception as e:
        fail(f"ADD  {SAFE_WRITE_PATH}", str(e))
        results["fail"] += 1

    # Edit
    if added_id:
        try:
            resp = session.post(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/set",
                json={
                    "path": SAFE_WRITE_PATH,
                    "entry_id": added_id,
                    "properties": {"comment": "TOD smoke test — edited"},
                },
                timeout=20,
            )
            if resp.status_code == 200 and resp.json().get("success"):
                ok(f"SET  {SAFE_WRITE_PATH} {added_id} — success")
                results["pass"] += 1
            else:
                detail = ""
                try:
                    detail = resp.json().get("detail", resp.json().get("error", ""))
                except Exception:
                    detail = resp.text[:100]
                fail(f"SET  {SAFE_WRITE_PATH} {added_id}", detail)
                results["fail"] += 1
        except Exception as e:
            fail(f"SET  {SAFE_WRITE_PATH} {added_id}", str(e))
            results["fail"] += 1
    else:
        skip("SET  — no entry ID from add step")
        results["skip"] += 1

    # Delete
    if added_id:
        try:
            resp = session.post(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/remove",
                json={
                    "path": SAFE_WRITE_PATH,
                    "entry_id": added_id,
                },
                timeout=20,
            )
            if resp.status_code == 200 and resp.json().get("success"):
                ok(f"DEL  {SAFE_WRITE_PATH} {added_id} — success (cleaned up)")
                results["pass"] += 1
            else:
                detail = ""
                try:
                    detail = resp.json().get("detail", resp.json().get("error", ""))
                except Exception:
                    detail = resp.text[:100]
                fail(f"DEL  {SAFE_WRITE_PATH} {added_id}", detail)
                results["fail"] += 1
        except Exception as e:
            fail(f"DEL  {SAFE_WRITE_PATH} {added_id}", str(e))
            results["fail"] += 1
    else:
        skip("DEL  — no entry ID from add step")
        results["skip"] += 1

    # ── 6. CLI Execute test ─────────────────────────────────────────────────
    section("CLI Execute Tests")

    cli_commands = [
        "/system/identity/print",
        "/ip/address/print",
        "/interface/print",
    ]

    for cmd in cli_commands:
        try:
            resp = session.post(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/execute",
                json={"command": cmd},
                timeout=20,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("success"):
                    n = len(data.get("data", []))
                    ok(f"{cmd:45s} {n} result(s)")
                    results["pass"] += 1
                else:
                    fail(f"{cmd:45s}", data.get("error", "unknown"))
                    results["fail"] += 1
            elif resp.status_code == 403:
                warn(f"{cmd:45s} BLOCKED (expected for some commands)")
                results["warn"] += 1
            else:
                fail(f"{cmd:45s} HTTP {resp.status_code}")
                results["fail"] += 1
        except Exception as e:
            fail(f"{cmd:45s}", str(e))
            results["fail"] += 1
        time.sleep(0.2)

    # ── 7. Blocked command tests (should all be 403) ────────────────────────
    section("Security Blocklist Tests (all should be blocked)")

    blocked_cmds = [
        "/system/reset-configuration",
        "/system/reboot",
        "/user/print",
        "/export",
    ]

    for cmd in blocked_cmds:
        try:
            resp = session.post(
                f"{base}/api/tenants/{tenant_id}/devices/{device_id}/config-editor/execute",
                json={"command": cmd},
                timeout=10,
            )
            if resp.status_code == 403:
                ok(f"{cmd:45s} correctly blocked (403)")
                results["pass"] += 1
            else:
                fail(f"{cmd:45s} NOT BLOCKED — HTTP {resp.status_code}")
                results["fail"] += 1
        except Exception as e:
            fail(f"{cmd:45s}", str(e))
            results["fail"] += 1
        time.sleep(0.1)

    # ── Summary ─────────────────────────────────────────────────────────────
    section("Summary")

    total = results["pass"] + results["fail"] + results["warn"] + results["skip"]
    print(f"  {Colors.OK}PASS: {results['pass']}{Colors.END}")
    print(f"  {Colors.FAIL}FAIL: {results['fail']}{Colors.END}")
    print(f"  {Colors.WARN}WARN: {results['warn']}{Colors.END}")
    print(f"  {Colors.DIM}SKIP: {results['skip']}{Colors.END}")
    print(f"  Total: {total}")

    if results["fail"] > 0:
        print(f"\n  {Colors.FAIL}Some tests failed — see FAIL lines above for details.{Colors.END}")
        sys.exit(1)
    else:
        print(f"\n  {Colors.OK}All tests passed (warnings are informational).{Colors.END}")


if __name__ == "__main__":
    main()
