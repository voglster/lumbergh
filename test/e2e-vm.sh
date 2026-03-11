#!/bin/bash
# E2E VM test for Lumbergh
# Spins up a disposable QEMU VM with Debian 12, installs pylumbergh,
# starts the server, and runs API + UI E2E tests.
#
# By default, builds a wheel from local source and copies it into the VM.
# Set INSTALL_FROM_PYPI=1 to install from PyPI instead.
set -euo pipefail

CACHE_DIR="$HOME/.cache/lumbergh-e2e"
DEBIAN_IMG="debian-12-generic-amd64.qcow2"
DEBIAN_URL="https://cloud.debian.org/images/cloud/bookworm/latest/${DEBIAN_IMG}"
HOST_PORT=18420
POLL_INTERVAL=10
POLL_TIMEOUT=360  # 6 minutes
QEMU_MEM="2G"
QEMU_CPUS="2"
INSTALL_FROM_PYPI="${INSTALL_FROM_PYPI:-}"
INSTALL_PRE="${INSTALL_PRE:-}"  # set to "--pre" to test alpha builds
E2E_SERVER_MODE="${E2E_SERVER_MODE:-}"  # set to keep VM running without tests

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

# ── Phase 1.5: Build Wheel (if not using PyPI) ────────────────────────

WHEEL_PATH=""
if [[ -z "$INSTALL_FROM_PYPI" ]]; then
    echo ""
    echo "=== Phase 1.5: Build Wheel ==="
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

    # Build frontend and copy into backend package
    echo "Building frontend..."
    (cd "$PROJECT_DIR/frontend" && npm run build 2>&1 | tail -3)
    rm -rf "$PROJECT_DIR/backend/lumbergh/frontend_dist"
    cp -r "$PROJECT_DIR/frontend/dist" "$PROJECT_DIR/backend/lumbergh/frontend_dist"

    # Build wheel (PYPI_README.md lives in backend/ already)
    (cd "$PROJECT_DIR/backend" && uv build --wheel --out-dir "$TMPDIR_RUN/dist" 2>&1 | tail -3)
    WHEEL_PATH=$(ls "$TMPDIR_RUN"/dist/*.whl 2>/dev/null | head -1)

    if [[ -z "$WHEEL_PATH" ]]; then
        echo "FAIL: Could not build wheel"
        exit 1
    fi
    echo "Built: $(basename "$WHEEL_PATH")"
fi

# ── Phase 2: Cloud-init ─────────────────────────────────────────────────

echo ""
echo "=== Phase 2: Cloud-init ==="

cat > "$TMPDIR_RUN/meta-data" <<EOF
instance-id: lumbergh-e2e
local-hostname: lumbergh-e2e
EOF

WHEEL_WRITE_FILES=""
INSTALL_CMD=""

if [[ -n "$WHEEL_PATH" ]]; then
    WHEEL_NAME=$(basename "$WHEEL_PATH")
    WHEEL_B64=$(base64 -w0 "$WHEEL_PATH")

    WHEEL_WRITE_FILES="
write_files:
  - path: /tmp/${WHEEL_NAME}
    encoding: b64
    content: ${WHEEL_B64}
    permissions: '0644'
"
    INSTALL_CMD="sudo -u test python3 -m pip install --break-system-packages /tmp/${WHEEL_NAME}"
else
    INSTALL_CMD="sudo -u test python3 -m pip install --break-system-packages pylumbergh ${INSTALL_PRE}"
fi

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
${WHEEL_WRITE_FILES}
runcmd:
  - - bash
    - -c
    - |
      set -eux
      export HOME=/home/test
      export USER=test

      # Install pylumbergh
      ${INSTALL_CMD}

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

# ── Server mode: keep running for manual testing ──────────────────────

if [[ -n "$E2E_SERVER_MODE" ]]; then
    echo ""
    echo "========================================="
    echo "  VM ready — Lumbergh on localhost:${HOST_PORT}"
    echo "========================================="
    echo ""
    echo "Run tests with:"
    echo "  uv run --with httpx --with pytest pytest test/e2e/ --base-url=http://localhost:${HOST_PORT} -v"
    echo "  uv run --with httpx --with playwright --with pytest-bdd --with pytest pytest test/e2e-ui/ --base-url=http://localhost:${HOST_PORT} -v"
    echo ""
    echo "Press Ctrl+C to stop the VM."
    # Use a sleep loop so signals are delivered between iterations
    # (bash's `wait` on a background process can swallow signals)
    trap 'echo ""; echo "Shutting down..."; kill "$QEMU_PID" 2>/dev/null; wait "$QEMU_PID" 2>/dev/null; rm -rf "$TMPDIR_RUN"; exit 0' INT TERM
    while kill -0 "$QEMU_PID" 2>/dev/null; do
        sleep 1
    done
    echo "QEMU process exited unexpectedly."
    exit 1
fi

# ── Phase 5: Run E2E Tests ────────────────────────────────────────────

echo ""
echo "=== Phase 5: E2E Tests ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run pytest against the VM (|| true to capture exit code under set -e)
E2E_EXIT=0
uv run --with httpx --with pytest \
    python3 -m pytest "$SCRIPT_DIR/e2e/" -v --tb=short \
    --base-url="http://localhost:${HOST_PORT}" -x || E2E_EXIT=$?

if [[ $E2E_EXIT -ne 0 ]]; then
    echo ""
    echo "========================================="
    echo "  FAIL - API E2E tests failed (exit $E2E_EXIT)"
    echo "========================================="
    exit $E2E_EXIT
fi

echo ""
echo "  PASS - API E2E tests passed"

# ── Phase 6: Run UI E2E Tests (Playwright) ────────────────────────────

echo ""
echo "=== Phase 6: UI E2E Tests (Playwright) ==="

# Install Chromium browser for Playwright
# First install system deps (needs sudo), then download the browser binary
uv run --with playwright python3 -m playwright install-deps chromium 2>&1 | tail -5 || true
uv run --with playwright python3 -m playwright install chromium 2>&1 | tail -5

# Run Playwright BDD tests against the VM
UI_EXIT=0
uv run --with httpx --with playwright --with pytest-bdd --with pytest \
    python3 -m pytest "$SCRIPT_DIR/e2e-ui/" -v --tb=short \
    --base-url="http://localhost:${HOST_PORT}" -x || UI_EXIT=$?

if [[ $UI_EXIT -eq 0 ]]; then
    echo ""
    echo "========================================="
    echo "  PASS - All E2E tests passed (API + UI)"
    echo "========================================="
else
    echo ""
    echo "========================================="
    echo "  FAIL - UI E2E tests failed (exit $UI_EXIT)"
    echo "========================================="
fi

exit $UI_EXIT
