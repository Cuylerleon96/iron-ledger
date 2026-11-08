#!/usr/bin/env bash
# Serve Iron Ledger locally. Local-first app: the server only delivers files,
# all data stays in the browser's localStorage.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8787}"
echo "Iron Ledger -> http://localhost:${PORT}/   (Ctrl-C to stop)"
echo "On your phone: http://<this-machine-ip>:${PORT}/  then Add to Home Screen."
cd "$DIR"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
