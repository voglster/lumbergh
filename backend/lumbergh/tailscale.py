"""Tailscale detection utilities."""

import json
import subprocess


def detect_tailscale() -> dict | None:
    """Detect Tailscale and return connection info.

    Returns {"ip": "100.x.y.z", "hostname": "machine.tail1234.ts.net"} or None.
    """
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    try:
        data = json.loads(result.stdout)
    except (json.JSONDecodeError, ValueError):
        return None

    self_node = data.get("Self")
    if not self_node:
        return None

    # TailscaleIPs is a list; grab the first IPv4 address
    ips = self_node.get("TailscaleIPs", [])
    ip = next((addr for addr in ips if "." in addr), None)
    if not ip:
        return None

    hostname = self_node.get("DNSName", "").rstrip(".")

    return {"ip": ip, "hostname": hostname or ip}
