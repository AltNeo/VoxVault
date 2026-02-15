#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
FORCE_INSTALL=false

if [[ "${1:-}" == "--install" ]]; then
  FORCE_INSTALL=true
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Could not find backend directory at '$BACKEND_DIR'." >&2
  exit 1
fi
if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Could not find frontend directory at '$FRONTEND_DIR'." >&2
  exit 1
fi

if [[ ! -d "$VENV_DIR" || "$FORCE_INSTALL" == "true" ]]; then
  echo "Setting up backend virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

if [[ "$FORCE_INSTALL" == "true" || ! -d "$VENV_DIR/lib" ]]; then
  echo "Installing backend dependencies..."
  "$VENV_DIR/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
elif ! "$VENV_DIR/bin/python" -c "import fastapi" >/dev/null 2>&1; then
  echo "Installing backend dependencies (first run)..."
  "$VENV_DIR/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
fi

if [[ "$FORCE_INSTALL" == "true" || ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

echo "Starting backend + frontend..."

(
  cd "$BACKEND_DIR"
  source "$VENV_DIR/bin/activate"
  exec uvicorn app.main:app --reload --port 8000
) &
BACKEND_PID=$!

(
  cd "$FRONTEND_DIR"
  exec npm run dev
) &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Backend:  http://127.0.0.1:8000"
echo "Frontend: Electron dev window (Vite on http://localhost:5173)"

wait -n "$BACKEND_PID" "$FRONTEND_PID"

