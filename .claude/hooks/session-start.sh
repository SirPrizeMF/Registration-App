#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# This is a static frontend project (HTML/CSS/JS) with no build dependencies.
# Nothing to install — signal a clean startup immediately.
echo "Session environment ready."
