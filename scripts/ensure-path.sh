#!/bin/bash
# Prepend platform-standard bin dirs to PATH so scripts invoked from tmux/send-keys
# (which can race against interactive shell init on some setups) still find common
# tools like npm, node, uv.
case "$(uname -s)" in
    Darwin)
        export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
        ;;
    Linux)
        export PATH="/usr/local/bin:/usr/bin:$HOME/.local/bin:$PATH"
        ;;
esac
