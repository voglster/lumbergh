"""CLI entry point for Lumbergh."""

import argparse


def run():
    """Run the Lumbergh server."""
    parser = argparse.ArgumentParser(description="Lumbergh - AI Session Supervisor")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", "-p", type=int, default=8420, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    import uvicorn
    uvicorn.run("lumbergh.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    run()
