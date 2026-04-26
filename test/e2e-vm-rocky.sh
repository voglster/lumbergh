#!/bin/bash
# Rocky 10 repro harness for issue #12 — tmux next-3.4 session crash.
#
# Boots a disposable Rocky 10 VM (which ships tmux next-3.4 in its
# default repos), installs pylumbergh, and leaves the server running
# so you can attempt to attach a session and capture the crash.
#
# By default builds a wheel from local source. Set INSTALL_FROM_PYPI=1
# to install the released package instead.
#
# Unlike e2e-vm.sh this script does NOT run automated tests — it boots
# the VM, prints connection info, and keeps it alive for manual probing.
set -euo pipefail

CACHE_DIR="$HOME/.cache/lumbergh-e2e"
ROCKY_IMG="Rocky-10-GenericCloud-Base.latest.x86_64.qcow2"
ROCKY_URL="https://download.rockylinux.org/pub/rocky/10/images/x86_64/${ROCKY_IMG}"
HOST_PORT=18421  # different from e2e-vm.sh so they can run side-by-side
SSH_PORT=12222
POLL_INTERVAL=10
POLL_TIMEOUT=420  # 7 minutes — Rocky boots a touch slower than Debian
QEMU_MEM="2G"
QEMU_CPUS="2"
INSTALL_FROM_PYPI="${INSTALL_FROM_PYPI:-}"
INSTALL_PRE="${INSTALL_PRE:-}"

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
    echo "Base image cached at: $CACHE_DIR/$ROCKY_IMG"
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
CPU_FLAG="-cpu max"  # Rocky 10's glibc requires x86-64-v3 (Haswell+); qemu64 default panics on init
if [[ -w /dev/kvm ]]; then
    echo "KVM available - using hardware acceleration"
    KVM_FLAG="-enable-kvm"
    CPU_FLAG="-cpu host"
else
    echo "WARNING: /dev/kvm not available, falling back to software emulation (slower)"
fi

# ── Phase 1: Image Prep ─────────────────────────────────────────────────

echo ""
echo "=== Phase 1: Image Prep ==="

mkdir -p "$CACHE_DIR"

if [[ ! -f "$CACHE_DIR/$ROCKY_IMG" ]]; then
    echo "Downloading Rocky 10 cloud image (~700MB)..."
    curl -L -o "$CACHE_DIR/$ROCKY_IMG" "$ROCKY_URL"
    echo "Download complete."
else
    echo "Using cached image: $CACHE_DIR/$ROCKY_IMG"
fi

TMPDIR_RUN=$(mktemp -d /tmp/lumbergh-rocky.XXXXXX)
echo "Temp dir: $TMPDIR_RUN"

echo "Creating ephemeral overlay..."
qemu-img create -f qcow2 -b "$CACHE_DIR/$ROCKY_IMG" -F qcow2 \
    "$TMPDIR_RUN/overlay.qcow2" 10G

# ── Phase 1.5: Build Wheel (if not using PyPI) ────────────────────────

WHEEL_PATH=""
if [[ -z "$INSTALL_FROM_PYPI" ]]; then
    echo ""
    echo "=== Phase 1.5: Build Wheel ==="
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

    echo "Building frontend..."
    (cd "$PROJECT_DIR/frontend" && npm run build 2>&1 | tail -3)
    rm -rf "$PROJECT_DIR/backend/lumbergh/frontend_dist"
    cp -r "$PROJECT_DIR/frontend/dist" "$PROJECT_DIR/backend/lumbergh/frontend_dist"

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
instance-id: lumbergh-rocky
local-hostname: lumbergh-rocky
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
    INSTALL_CMD="sudo -u test python3 -m pip install --break-system-packages --user /tmp/${WHEEL_NAME}"
else
    INSTALL_CMD="sudo -u test python3 -m pip install --break-system-packages --user pylumbergh ${INSTALL_PRE}"
fi

cat > "$TMPDIR_RUN/user-data" <<USERDATA
#cloud-config
users:
  - name: test
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    plain_text_passwd: test

ssh_pwauth: true

package_update: true
packages:
  - git
  - tmux
  - python3
  - python3-pip
${WHEEL_WRITE_FILES}
runcmd:
  - - bash
    - -c
    - |
      set -eux
      export HOME=/home/test
      export USER=test

      # Capture tmux version up front — this is the whole point of running on Rocky
      tmux -V > /tmp/tmux-version.txt 2>&1 || true

      # Install pylumbergh
      ${INSTALL_CMD}

      # Fake claude binary
      printf '#!/bin/bash\nexec cat\n' > /usr/local/bin/claude
      chmod +x /usr/local/bin/claude

      # A test repo so we have something to attach a session to
      sudo -u test mkdir -p /home/test/test-repo
      cd /home/test/test-repo
      sudo -u test git init
      sudo -u test git config user.name "Repro Test"
      sudo -u test git config user.email "test@localhost"
      sudo -u test bash -c "echo '# repro' > README.md"
      sudo -u test git add README.md
      sudo -u test git commit -m "Initial commit"

      # Start the tmux server with verbose logging so we capture the crash.
      # tmux -vv writes tmux-server-*.log and tmux-client-*.log into cwd.
      sudo -u test mkdir -p /home/test/tmux-logs
      sudo -u test bash -c 'cd /home/test/tmux-logs && tmux -vv new-session -d -s _bootstrap "sleep 86400"' || true

      # Start lumbergh
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
    $CPU_FLAG \
    -nographic \
    -drive file="$TMPDIR_RUN/overlay.qcow2",if=virtio \
    -drive file="$TMPDIR_RUN/seed.iso",if=virtio,media=cdrom \
    -netdev user,id=net0,hostfwd=tcp::${HOST_PORT}-:8420,hostfwd=tcp::${SSH_PORT}-:22 \
    -device virtio-net-pci,netdev=net0 \
    > "$QEMU_LOG" 2>&1 &

QEMU_PID=$!
echo "QEMU started (PID $QEMU_PID)"
echo "Log: $QEMU_LOG"
echo "Port mappings: host:${HOST_PORT} -> vm:8420 (lumbergh), host:${SSH_PORT} -> vm:22 (ssh)"

# ── Phase 4: Poll & Verify ──────────────────────────────────────────────

echo ""
echo "=== Phase 4: Poll & Verify ==="
echo "Waiting for service (timeout: ${POLL_TIMEOUT}s, interval: ${POLL_INTERVAL}s)..."

elapsed=0

while [[ $elapsed -lt $POLL_TIMEOUT ]]; do
    if ! kill -0 "$QEMU_PID" 2>/dev/null; then
        echo ""
        echo "FAIL: QEMU process died unexpectedly"
        echo "--- Last 30 lines of QEMU log ---"
        tail -30 "$QEMU_LOG"
        exit 1
    fi

    if curl -sf "http://localhost:${HOST_PORT}/api/sessions" -o /dev/null 2>/dev/null; then
        echo "  [${elapsed}s] Lumbergh: UP"
        break
    fi

    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))

    if [[ $((elapsed % 30)) -eq 0 ]]; then
        echo "  [${elapsed}s] Waiting..."
    fi
done

if [[ $elapsed -ge $POLL_TIMEOUT ]]; then
    echo ""
    echo "FAIL - Timeout after ${POLL_TIMEOUT}s"
    echo "--- Last 50 lines of QEMU log ---"
    tail -50 "$QEMU_LOG"
    exit 1
fi

# ── Repro instructions ──────────────────────────────────────────────────

cat <<EOF

=========================================
  Rocky 10 VM ready — issue #12 repro harness
=========================================

  Web UI:  http://localhost:${HOST_PORT}
  SSH:     ssh test@localhost -p ${SSH_PORT}   (password: test)

To reproduce the crash:

  1. Open http://localhost:${HOST_PORT} in your browser
  2. Create a new session pointing at /home/test/test-repo
  3. Click into the session — tmux is expected to die here

To inspect after the crash:

  ssh test@localhost -p ${SSH_PORT}
    cat /tmp/tmux-version.txt           # confirm next-3.4
    ls /home/test/tmux-logs/            # tmux -vv server/client logs
    tail -100 /home/test/tmux-logs/tmux-server-*.log
    tail -100 /tmp/lumbergh.log
    journalctl --user --since "5 minutes ago"
    dmesg | tail -50                    # in case it's a SEGV

Press Ctrl+C to shut the VM down.
EOF

trap 'echo ""; echo "Shutting down..."; kill "$QEMU_PID" 2>/dev/null; wait "$QEMU_PID" 2>/dev/null; rm -rf "$TMPDIR_RUN"; exit 0' INT TERM
while kill -0 "$QEMU_PID" 2>/dev/null; do
    sleep 1
done
echo "QEMU process exited unexpectedly."
exit 1
