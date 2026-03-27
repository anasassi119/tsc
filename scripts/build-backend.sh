#!/usr/bin/env bash
# Build the frozen Python backend with PyInstaller.
# Output: backend/dist/server/  (a self-contained directory)
#
# Usage (called automatically by electron-builder via beforeBuild hook,
# or run manually before `npm run build:mac`):
#
#   ./scripts/build-backend.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

echo "▶ Building Python backend (PyInstaller)…"
echo "  backend dir : $BACKEND_DIR"

cd "$BACKEND_DIR"

# Sync deps (includes pyinstaller in the dev group)
uv sync --group dev

# Clean previous build artifacts so we always get a fresh bundle
rm -rf build dist __pycache__

# Run PyInstaller via the uv-managed venv so it picks up all deps
uv run pyinstaller server.spec --noconfirm

echo "✓ Backend frozen at: $BACKEND_DIR/dist/server/"
