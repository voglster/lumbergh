"""
Lumbergh Backend - FastAPI server for tmux terminal streaming.

Run with: uv run python main.py
"""

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Lumbergh", description="Tmux session supervisor")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/sessions")
async def list_sessions():
    """List available tmux sessions."""
    from tmux_pty import list_tmux_sessions
    sessions = list_tmux_sessions()
    return {"sessions": sessions}


@app.websocket("/api/session/{session_name}/stream")
async def session_stream(websocket: WebSocket, session_name: str):
    """
    WebSocket endpoint for bidirectional terminal I/O with a tmux session.

    Messages from client:
    - {"type": "input", "data": "..."} - Send keystrokes to terminal
    - {"type": "resize", "cols": N, "rows": M} - Resize terminal

    Messages to client:
    - {"type": "output", "data": "..."} - Terminal output
    - {"type": "error", "message": "..."} - Error messages
    """
    await websocket.accept()

    from tmux_pty import TmuxPtySession

    try:
        session = TmuxPtySession(session_name)
        await session.run(websocket)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
