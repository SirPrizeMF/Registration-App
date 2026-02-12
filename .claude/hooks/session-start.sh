#!/bin/bash
set -euo pipefail

# Only run in remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Start http-server to serve the app from the working directory
# -c-1 disables caching so file changes are always picked up
# -p 3000 serves on port 3000
pkill -f "http-server.*3000" 2>/dev/null || true
npx http-server "${CLAUDE_PROJECT_DIR}" -p 3000 --cors -c-1 &
