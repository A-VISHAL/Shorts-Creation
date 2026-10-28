#!/usr/bin/env bash
# ==============================================================================
# Motivational Shorts Studio - Run Local Development Servers
# Starts FastAPI backend (port 8000) and Vite frontend (port 5173).
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================================="
echo " Starting Motivational Shorts Studio"
echo " Backend:  http://localhost:8000"
echo " Frontend: http://localhost:5173"
echo " Press Ctrl+C to terminate both servers"
echo "=========================================================="

# Cleanup handler on exit
cleanup() {
  echo ""
  echo "Shutting down servers..."
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${FRONTEND_PID:-}" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  echo "All servers stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start FastAPI Backend
cd "$PROJECT_ROOT/backend"
PYTHON_BIN="./venv/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

# Check if FastAPI is already running
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "[BACKEND] Port 8000 is already in use. Checking if it's healthy..."
    if curl -s -f http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
        echo "[BACKEND] Reusing existing healthy FastAPI instance on port 8000."
        BACKEND_PID=""
    else
        echo "[BACKEND] Port 8000 occupied by another process. Please free port 8000 or terminate conflicting process."
        exit 1
    fi
else
    echo "[BACKEND] Starting FastAPI on http://localhost:8000..."
    $PYTHON_BIN -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!
fi

# 2. Start Vite Frontend
cd "$PROJECT_ROOT/frontend"
echo "[FRONTEND] Starting Vite dev server on http://localhost:5173..."
npm run dev &
FRONTEND_PID=$!

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
