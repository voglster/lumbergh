#!/bin/bash
# Debug VM for manual testing. Boots a Debian VM with SSH.
# SSH: ssh -o StrictHostKeyChecking=no test@localhost -p 2222
# Kill: kill $(cat /tmp/lumbergh-debug-vm.pid)
set -euo pipefail

CACHE_DIR="$HOME/.cache/lumbergh-e2e"
DEBIAN_IMG="debian-12-generic-amd64.qcow2"
PIDFILE="/tmp/lumbergh-debug-vm.pid"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "VM already running (PID $(cat "$PIDFILE")). Kill with: kill \$(cat $PIDFILE)"
    exit 1
fi

TMPDIR=$(mktemp -d /tmp/lumbergh-debug.XXXXXX)
qemu-img create -f qcow2 -b "$CACHE_DIR/$DEBIAN_IMG" -F qcow2 "$TMPDIR/overlay.qcow2" 10G

cat > "$TMPDIR/user-data" <<'EOF'
#cloud-config
users:
  - name: test
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC3YXOFpRYAvpHczOlmpRcPGqvJmU2R5yFd/BDLLh4eSwDlaGDkIE6KPMU5P1TCOQ3ORlHt6BGYxQpf0FHVYEk3+YT5kpfrC+jgVRq8PUO+7SIEcFgj7rbwYWSIt+caOQ2s2H518t3hz8cAdJErwjmbs/r1NPX8Q37PotjwrvEWqosMcJbXHzx8Bb2SFUp/bZg2JghkDuf+L5NwHFnIw5d5YfuYJSJqko7iYIqzdwIj2VIBZaNJytG2YxrmJ4b0YA5iXtrESVTg62lOnIDE2FV7TUNKDtyYe9Tl0rAOW0rf+LS6/GkN659cO9Gd6yi/uHZYc+8sB//i60b6oaCUm2xF jvogel@ubuntu
package_update: true
packages: [git, tmux, python3, python3-pip, python3-venv, openssh-server, curl]

runcmd:
  - sudo -u test bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
  - sudo -u test bash -c 'source /home/test/.local/bin/env && uv tool install pylumbergh --prerelease allow'
EOF
cat > "$TMPDIR/meta-data" <<'EOF'
instance-id: debug
local-hostname: debug
EOF
genisoimage -output "$TMPDIR/seed.iso" -volid cidata -joliet -rock \
    "$TMPDIR/user-data" "$TMPDIR/meta-data" 2>/dev/null

qemu-system-x86_64 -m 2G -smp 2 -enable-kvm -nographic \
    -drive file="$TMPDIR/overlay.qcow2",if=virtio \
    -drive file="$TMPDIR/seed.iso",if=virtio,media=cdrom \
    -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::18420-:8420 \
    -device virtio-net-pci,netdev=net0 \
    > "$TMPDIR/qemu.log" 2>&1 &

echo $! > "$PIDFILE"
echo "VM started (PID $(cat "$PIDFILE")), log: $TMPDIR/qemu.log"
echo "Waiting for SSH..."

for i in $(seq 1 60); do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=2 -o BatchMode=yes test@localhost -p 2222 true 2>/dev/null; then
        echo ""
        echo "Ready! Connect with:"
        echo "  ssh -o StrictHostKeyChecking=no test@localhost -p 2222"
        echo ""
        echo "Then run:"
        echo "  lumbergh"
        echo ""
        echo "Kill VM: kill \$(cat $PIDFILE)"
        exit 0
    fi
    sleep 2
    printf "."
done

echo ""
echo "SSH never came up. Check log: $TMPDIR/qemu.log"
exit 1
