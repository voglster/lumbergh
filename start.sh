#!/bin/bash
# Start both backend and frontend
# Ctrl+C stops both

cd "$(dirname "$0")"

cleanup() {
    echo "Stopping..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting backend on http://0.0.0.0:8000"
cd backend && uv run python main.py &
BACKEND_PID=$!

echo "Starting frontend on http://0.0.0.0:5173"
cd ../frontend && npm run dev &
FRONTEND_PID=$!

echo ""
echo "Lumbergh running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"

wait
