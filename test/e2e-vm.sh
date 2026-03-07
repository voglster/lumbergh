#!/bin/bash
# E2E VM smoke test for Lumbergh
# Spins up a disposable QEMU VM with Debian 12, installs deps via cloud-init,
# clones the repo, starts services via bootstrap.sh, and verifies they respond.
set -euo pipefail

CACHE_DIR="$HOME/.cache/lumbergh-e2e"
DEBIAN_IMG="debian-12-generic-amd64.qcow2"
DEBIAN_URL="https://cloud.debian.org/images/cloud/bookworm/latest/${DEBIAN_IMG}"
HOST_BACKEND_PORT=18420
HOST_FRONTEND_PORT=15420
POLL_INTERVAL=10
POLL_TIMEOUT=360  # 6 minutes
QEMU_MEM="2G"
QEMU_CPUS="2"

TMPDIR_RUN=""
QEMU_PID=""

cleanup() {
    echo ""
    echo "=== Cleanup ==="
    if [[ -n "$QEMU_PID" ]] && kill -0 "$QEMU_PID" 2>/dev/null; then
        echo "Killing QEMU (PID $QEMU_PID)"
        kill "$QEMU_PID" 2>/dev/null || true
        wait "$QEMU_PID" 2>/dev/null || true
    fi
    if [[ -n "$TMPDIR_RUN" && -d "$TMPDIR_RUN" ]]; then
        echo "Removing temp dir: $TMPDIR_RUN"
        rm -rf "$TMPDIR_RUN"
    fi
    echo "Base image cached at: $CACHE_DIR/$DEBIAN_IMG"
}
trap cleanup EXIT

# ── Phase 0: Prerequisites ──────────────────────────────────────────────

echo "=== Phase 0: Prerequisites ==="

missing=()
for cmd in qemu-system-x86_64 qemu-img genisoimage curl; do
    if ! command -v "$cmd" &>/dev/null; then
        missing+=("$cmd")
    fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing required tools: ${missing[*]}"
    echo ""
    echo "Install with:"
    echo "  sudo apt install qemu-system-x86 qemu-utils genisoimage curl"
    exit 1
fi

KVM_FLAG=""
if [[ -w /dev/kvm ]]; then
    echo "KVM available - using hardware acceleration"
    KVM_FLAG="-enable-kvm"
else
    echo "WARNING: /dev/kvm not available, falling back to software emulation (slower)"
fi

# ── Phase 1: Image Prep ─────────────────────────────────────────────────

echo ""
echo "=== Phase 1: Image Prep ==="

mkdir -p "$CACHE_DIR"

if [[ ! -f "$CACHE_DIR/$DEBIAN_IMG" ]]; then
    echo "Downloading Debian 12 cloud image..."
    curl -L -o "$CACHE_DIR/$DEBIAN_IMG" "$DEBIAN_URL"
    echo "Download complete."
else
    echo "Using cached image: $CACHE_DIR/$DEBIAN_IMG"
fi

TMPDIR_RUN=$(mktemp -d /tmp/lumbergh-e2e.XXXXXX)
echo "Temp dir: $TMPDIR_RUN"

echo "Creating ephemeral overlay..."
qemu-img create -f qcow2 -b "$CACHE_DIR/$DEBIAN_IMG" -F qcow2 \
    "$TMPDIR_RUN/overlay.qcow2" 10G

# ── Phase 2: Cloud-init ─────────────────────────────────────────────────

echo ""
echo "=== Phase 2: Cloud-init ==="

cat > "$TMPDIR_RUN/meta-data" <<EOF
instance-id: lumbergh-e2e
local-hostname: lumbergh-e2e
EOF

cat > "$TMPDIR_RUN/user-data" <<'USERDATA'
#cloud-config
users:
  - name: test
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    plain_text_passwd: test

package_update: true
packages:
  - tmux
  - git
  - curl
  - python3
  - python3-venv
  - ca-certificates

runcmd:
  - - bash
    - -c
    - |
      set -eux
      export HOME=/home/test
      export USER=test
      cd /home/test

      # Install uv
      curl -LsSf https://astral.sh/uv/install.sh | sudo -u test bash
      export PATH="/home/test/.local/bin:$PATH"

      # Install nvm + Node LTS
      sudo -u test bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
      export NVM_DIR="/home/test/.nvm"
      # nvm.sh is not compatible with set -eu, temporarily relax
      set +eu
      source "$NVM_DIR/nvm.sh"
      set -eu
      nvm install --lts

      # Clone repo
      sudo -u test git clone --depth 1 https://github.com/voglster/lumbergh.git /home/test/lumbergh
      cd /home/test/lumbergh

      # npm install in frontend
      cd frontend
      npm install
      cd ..

      # Make scripts executable
      chmod +x bootstrap.sh backend/start.sh frontend/start.sh

      # Run bootstrap.sh as the test user
      # This creates tmux session with claude/backend/frontend windows
      # claude window will fail (not installed) - that's expected
      # xdg-open will fail (headless) - that's expected
      sudo -u test bash -c 'set +eu; source /home/test/.nvm/nvm.sh; set -eu; export PATH="/home/test/.local/bin:$PATH"; cd /home/test/lumbergh && ./bootstrap.sh' || true

      # Signal that setup is complete
      echo "LUMBERGH_SETUP_COMPLETE" > /tmp/setup-done
USERDATA

echo "Generating seed ISO..."
genisoimage -output "$TMPDIR_RUN/seed.iso" -volid cidata -joliet -rock \
    "$TMPDIR_RUN/user-data" "$TMPDIR_RUN/meta-data" 2>/dev/null

# ── Phase 3: Boot QEMU ──────────────────────────────────────────────────

echo ""
echo "=== Phase 3: Boot QEMU ==="

QEMU_LOG="$TMPDIR_RUN/qemu.log"

qemu-system-x86_64 \
    -m "$QEMU_MEM" \
    -smp "$QEMU_CPUS" \
    $KVM_FLAG \
    -nographic \
    -drive file="$TMPDIR_RUN/overlay.qcow2",if=virtio \
    -drive file="$TMPDIR_RUN/seed.iso",if=virtio,media=cdrom \
    -netdev user,id=net0,hostfwd=tcp::${HOST_BACKEND_PORT}-:8420,hostfwd=tcp::${HOST_FRONTEND_PORT}-:5420 \
    -device virtio-net-pci,netdev=net0 \
    > "$QEMU_LOG" 2>&1 &

QEMU_PID=$!
echo "QEMU started (PID $QEMU_PID)"
echo "Log: $QEMU_LOG"
echo "Port mapping: host:$HOST_BACKEND_PORT -> vm:8420, host:$HOST_FRONTEND_PORT -> vm:5420"

# ── Phase 4: Poll & Verify ──────────────────────────────────────────────

echo ""
echo "=== Phase 4: Poll & Verify ==="
echo "Waiting for services (timeout: ${POLL_TIMEOUT}s, interval: ${POLL_INTERVAL}s)..."

elapsed=0
backend_ok=false
frontend_ok=false

while [[ $elapsed -lt $POLL_TIMEOUT ]]; do
    # Check QEMU is still alive
    if ! kill -0 "$QEMU_PID" 2>/dev/null; then
        echo ""
        echo "FAIL: QEMU process died unexpectedly"
        echo "--- Last 30 lines of QEMU log ---"
        tail -30 "$QEMU_LOG"
        exit 1
    fi

    # Check backend
    if [[ "$backend_ok" != "true" ]]; then
        if curl -sf "http://localhost:${HOST_BACKEND_PORT}/api/sessions" -o /dev/null 2>/dev/null; then
            backend_ok=true
            echo "  [${elapsed}s] Backend: UP"
        fi
    fi

    # Check frontend
    if [[ "$frontend_ok" != "true" ]]; then
        if curl -sf "http://localhost:${HOST_FRONTEND_PORT}/" -o /dev/null 2>/dev/null; then
            frontend_ok=true
            echo "  [${elapsed}s] Frontend: UP"
        fi
    fi

    # Both up?
    if [[ "$backend_ok" == "true" && "$frontend_ok" == "true" ]]; then
        echo ""
        echo "========================================="
        echo "  PASS - Both services responding"
        echo "========================================="
        exit 0
    fi

    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))

    # Progress indicator every 30s
    if [[ $((elapsed % 30)) -eq 0 ]]; then
        echo "  [${elapsed}s] Waiting... (backend: $backend_ok, frontend: $frontend_ok)"
    fi
done

# Timeout
echo ""
echo "========================================="
echo "  FAIL - Timeout after ${POLL_TIMEOUT}s"
echo "========================================="
echo "  Backend:  $backend_ok"
echo "  Frontend: $frontend_ok"
echo ""
echo "--- Last 50 lines of QEMU log ---"
tail -50 "$QEMU_LOG"
exit 1
