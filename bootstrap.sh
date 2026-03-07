#!/bin/bash
# Bootstrap lumbergh: tmux session 0 with claude, backend, and frontend
# Then open the browser and exit.

cd "$(dirname "$0")"

# Check required dependencies
has_missing=false
for cmd in tmux git uv npm; do
    if ! command -v "$cmd" &>/dev/null; then
        has_missing=true
        echo "Missing: $cmd"
        case "$cmd" in
            tmux)
                echo "  Install: sudo apt install tmux  (or: brew install tmux)"
                ;;
            git)
                echo "  Install: sudo apt install git  (or: brew install git)"
                ;;
            uv)
                echo "  Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
                echo "  More info: https://docs.astral.sh/uv/"
                ;;
            npm)
                echo "  Recommended: install via nvm (Node Version Manager)"
                echo "  Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
                echo "  Then: nvm install --lts"
                echo "  More info: https://github.com/nvm-sh/nvm"
                ;;
        esac
        echo ""
    fi
done
if [ "$has_missing" = true ]; then
    echo "Install the missing tools above, then open a new shell (or run: source ~/.bashrc)"
    echo "and re-run this script."
    exit 1
fi

if tmux has-session -t 0 2>/dev/null; then
    echo "Session '0' already exists. Attach with: tmux at -t 0"
    exit 1
fi

# Window 0: claude
tmux new-session -d -s 0 -n claude
tmux send-keys -t 0:claude "claude --continue 2>/dev/null || claude" Enter

# Window 1: backend
tmux new-window -t 0: -n backend
tmux send-keys -t 0:backend "cd $(pwd)/backend && ./start.sh" Enter

# Window 2: frontend
tmux new-window -t 0: -n frontend
tmux send-keys -t 0:frontend "cd $(pwd)/frontend && ./start.sh" Enter

# Select the claude window
tmux select-window -t 0:claude

# Give the frontend a moment to start, then open browser
sleep 2
xdg-open http://localhost:5420 2>/dev/null || open http://localhost:5420 2>/dev/null

echo "Lumbergh bootstrapped in tmux session '0'"
