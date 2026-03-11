#!/bin/bash
# E2E VM smoke test for Lumbergh
# Spins up a disposable QEMU VM with Debian 12, installs pylumbergh from PyPI,
# starts the server, and verifies it responds.
set -euo pipefail

CACHE_DIR="$HOME/.cache/lumbergh-e2e"
DEBIAN_IMG="debian-12-generic-amd64.qcow2"
DEBIAN_URL="https://cloud.debian.org/images/cloud/bookworm/latest/${DEBIAN_IMG}"
HOST_PORT=18420
POLL_INTERVAL=10
POLL_TIMEOUT=360  # 6 minutes
QEMU_MEM="2G"
QEMU_CPUS="2"
INSTALL_PRE="${INSTALL_PRE:-}"  # set to "--pre" to test alpha builds

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

cat > "$TMPDIR_RUN/user-data" <<USERDATA
#cloud-config
users:
  - name: test
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    plain_text_passwd: test

package_update: true
packages:
  - git
  - tmux
  - python3
  - python3-pip
  - python3-venv

runcmd:
  - - bash
    - -c
    - |
      set -eux
      export HOME=/home/test
      export USER=test

      # Install pylumbergh from PyPI
      sudo -u test python3 -m pip install --break-system-packages pylumbergh ${INSTALL_PRE}

      # Fake claude binary (blocks on stdin like real claude)
      printf '#!/bin/bash\nexec cat\n' > /usr/local/bin/claude
      chmod +x /usr/local/bin/claude

      # Create test git repos for E2E tests
      for repo in test-repo test-repo-2 git-test-repo; do
        sudo -u test mkdir -p /home/test/\$repo
        cd /home/test/\$repo
        sudo -u test git init
        sudo -u test git config user.name "E2E Test"
        sudo -u test git config user.email "test@localhost"
        sudo -u test bash -c "echo '# \$repo' > README.md"
        sudo -u test git add README.md
        sudo -u test git commit -m "Initial commit"
        sudo -u test bash -c "echo 'uncommitted change' >> README.md"
      done

      # Start lumbergh (log output for debugging)
      sudo -u test bash -c '/home/test/.local/bin/lumbergh > /tmp/lumbergh.log 2>&1 &'

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
    -netdev user,id=net0,hostfwd=tcp::${HOST_PORT}-:8420 \
    -device virtio-net-pci,netdev=net0 \
    > "$QEMU_LOG" 2>&1 &

QEMU_PID=$!
echo "QEMU started (PID $QEMU_PID)"
echo "Log: $QEMU_LOG"
echo "Port mapping: host:$HOST_PORT -> vm:8420"

# ── Phase 4: Poll & Verify ──────────────────────────────────────────────

echo ""
echo "=== Phase 4: Poll & Verify ==="
echo "Waiting for service (timeout: ${POLL_TIMEOUT}s, interval: ${POLL_INTERVAL}s)..."

elapsed=0

while [[ $elapsed -lt $POLL_TIMEOUT ]]; do
    # Check QEMU is still alive
    if ! kill -0 "$QEMU_PID" 2>/dev/null; then
        echo ""
        echo "FAIL: QEMU process died unexpectedly"
        echo "--- Last 30 lines of QEMU log ---"
        tail -30 "$QEMU_LOG"
        exit 1
    fi

    # Check backend (serves both API and frontend now)
    if curl -sf "http://localhost:${HOST_PORT}/api/sessions" -o /dev/null 2>/dev/null; then
        echo "  [${elapsed}s] Lumbergh: UP"
        echo ""
        echo "========================================="
        echo "  Service responding - running E2E tests"
        echo "========================================="
        break
    fi

    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))

    # Progress indicator every 30s
    if [[ $((elapsed % 30)) -eq 0 ]]; then
        echo "  [${elapsed}s] Waiting..."
    fi
done

# Check if we timed out (loop completed without break)
if [[ $elapsed -ge $POLL_TIMEOUT ]]; then
    echo ""
    echo "========================================="
    echo "  FAIL - Timeout after ${POLL_TIMEOUT}s"
    echo "========================================="
    echo ""
    echo "--- Last 50 lines of QEMU log ---"
    tail -50 "$QEMU_LOG"
    exit 1
fi

# ── Phase 5: Run E2E Tests ────────────────────────────────────────────

echo ""
echo "=== Phase 5: E2E Tests ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install test dependencies
pip install -q -r "$SCRIPT_DIR/e2e/requirements.txt"

# Run pytest against the VM (|| true to capture exit code under set -e)
E2E_EXIT=0
python3 -m pytest "$SCRIPT_DIR/e2e/" -v --tb=short --base-url="http://localhost:${HOST_PORT}" -x || E2E_EXIT=$?

if [[ $E2E_EXIT -eq 0 ]]; then
    echo ""
    echo "========================================="
    echo "  PASS - All E2E tests passed"
    echo "========================================="
else
    echo ""
    echo "========================================="
    echo "  FAIL - E2E tests failed (exit $E2E_EXIT)"
    echo "========================================="
fi

exit $E2E_EXIT
