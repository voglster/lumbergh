#!/bin/bash
# Bootstrap lumbergh: tmux session 0 with claude, backend, and frontend
# Then open the browser and exit.

cd "$(dirname "$0")"

if tmux has-session -t 0 2>/dev/null; then
    echo "Session '0' already exists. Attach with: tmux at -t 0"
    exit 1
fi

# Window 0: claude
tmux new-session -d -s 0 -n claude
tmux send-keys -t 0:claude "claude --continue" Enter

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
