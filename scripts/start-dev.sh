#!/usr/bin/env bash
# ==============================================================================
# Motivational Shorts Studio - Coordinated Development Environment & Tunnel Runner
# ==============================================================================
# Starts or verifies FastAPI (port 8000), Vite (port 5173), and Cloudflare Tunnel.
# Automatically captures, verifies, and synchronizes the trycloudflare.com URL.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TUNNEL_LOG="/tmp/cloudflared_shorts_dev.log"

STARTED_FASTAPI=0
STARTED_FRONTEND=0
STARTED_TUNNEL=0
TUNNEL_PID=""
FASTAPI_PID=""
FRONTEND_PID=""

echo "========================================================================"
echo " Motivational Shorts Studio - Initializing Development Environment"
echo " Project Root: $PROJECT_ROOT"
echo "========================================================================"

# Cleanup handler on exit or Ctrl+C
cleanup() {
  echo ""
  echo "--> Shutting down development session..."
  if [ "$STARTED_TUNNEL" -eq 1 ] && [ -n "${TUNNEL_PID:-}" ]; then
    echo "    Stopping Cloudflare Tunnel (PID: $TUNNEL_PID)..."
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
  if [ "$STARTED_FASTAPI" -eq 1 ] && [ -n "${FASTAPI_PID:-}" ]; then
    echo "    Stopping FastAPI Backend (PID: $FASTAPI_PID)..."
    kill "$FASTAPI_PID" 2>/dev/null || true
  fi
  if [ "$STARTED_FRONTEND" -eq 1 ] && [ -n "${FRONTEND_PID:-}" ]; then
    echo "    Stopping Vite Frontend (PID: $FRONTEND_PID)..."
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_LOG" 2>/dev/null || true
  echo "All started processes cleanly terminated."
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Check cloudflared binary
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: 'cloudflared' command not found."
  echo "Please install cloudflared on Linux Mint / Ubuntu:"
  echo "  sudo curl -L --output /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  echo "  sudo chmod +x /usr/local/bin/cloudflared"
  exit 1
fi

# 2. Check / Start FastAPI Backend
echo "--> Step 1: Checking FastAPI backend on port 8000..."
if curl -s -f http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
  echo "    FastAPI is already running and healthy on http://127.0.0.1:8000"
else
  echo "    Starting FastAPI backend..."
  cd "$PROJECT_ROOT/backend"
  PYTHON_BIN="./venv/bin/python3"
  if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
  fi
  $PYTHON_BIN -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload >/dev/null 2>&1 &
  FASTAPI_PID=$!
  STARTED_FASTAPI=1

  # Wait for backend to be healthy
  for i in {1..20}; do
    if curl -s -f http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
      echo "    FastAPI started successfully (PID: $FASTAPI_PID)"
      break
    fi
    sleep 0.5
  done
fi

# 3. Check / Start Vite Frontend
echo "--> Step 2: Checking Vite frontend on port 5173..."
if curl -s http://localhost:5173 >/dev/null 2>&1; then
  echo "    Vite dev server is already running on http://localhost:5173"
else
  echo "    Starting Vite dev server..."
  cd "$PROJECT_ROOT/frontend"
  npm run dev >/dev/null 2>&1 &
  FRONTEND_PID=$!
  STARTED_FRONTEND=1
  sleep 1
  echo "    Vite dev server started (PID: $FRONTEND_PID)"
fi

# 4. Check / Start Cloudflare Tunnel
echo "--> Step 3: Coordinating Cloudflare Quick Tunnel..."
# Check if an existing cloudflared process is running
EXISTING_TUNNEL_PID=$(pgrep -f "cloudflared tunnel.*http://127.0.0.1:8000" || true)

if [ -n "$EXISTING_TUNNEL_PID" ]; then
  echo "    An existing Cloudflare Tunnel is running (PID: $EXISTING_TUNNEL_PID)."
  # Read current backend .env URL
  CURRENT_CONFIG_URL=$(grep "^PUBLIC_BASE_URL=" "$PROJECT_ROOT/backend/.env" 2>/dev/null | cut -d= -f2- || true)
  if [ -n "$CURRENT_CONFIG_URL" ] && [[ "$CURRENT_CONFIG_URL" =~ trycloudflare\.com ]]; then
    TUNNEL_URL="$CURRENT_CONFIG_URL"
    echo "    Using active tunnel URL from configuration: $TUNNEL_URL"
  fi
fi

if [ -z "${TUNNEL_URL:-}" ]; then
  echo "    Launching cloudflared Quick Tunnel for http://127.0.0.1:8000..."
  rm -f "$TUNNEL_LOG"
  cloudflared tunnel --url http://127.0.0.1:8000 > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  STARTED_TUNNEL=1

  echo "    Waiting for Cloudflare to assign a public HTTPS URL (up to 25s)..."
  TUNNEL_URL=""
  for i in {1..50}; do
    if [ -f "$TUNNEL_LOG" ]; then
      EXTRACTED=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG" | head -n 1 || true)
      if [ -n "$EXTRACTED" ]; then
        TUNNEL_URL="$EXTRACTED"
        break
      fi
    fi
    sleep 0.5
  done

  if [ -z "$TUNNEL_URL" ]; then
    echo "WARNING: Could not automatically parse trycloudflare.com URL within 25 seconds."
    echo "Check tunnel log output below:"
    cat "$TUNNEL_LOG" | tail -n 15
    exit 1
  fi
fi

# 5. Verify the tunnel with a real HTTP health request
echo "--> Step 4: Verifying public tunnel reachable via HTTPS..."
TUNNEL_HEALTH_OK=0
for i in {1..15}; do
  if curl -s -f "$TUNNEL_URL/api/health" >/dev/null 2>&1; then
    TUNNEL_HEALTH_OK=1
    break
  fi
  sleep 1
done

if [ "$TUNNEL_HEALTH_OK" -eq 1 ]; then
  echo "    ✓ Public tunnel verified! Endpoint $TUNNEL_URL/api/health returned HTTP 200 OK."
else
  echo "    WARNING: Public tunnel endpoint did not immediately respond to health probe."
  echo "    It may take a few moments for Cloudflare edge routing to propagate globally."
fi

# 6. Synchronize configuration files
echo "--> Step 5: Synchronizing environment configuration..."

# Update backend/.env
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$TUNNEL_URL|" "$PROJECT_ROOT/backend/.env"
  echo "    Updated backend/.env: PUBLIC_BASE_URL=$TUNNEL_URL"
fi

# Update frontend/.env
if [ -f "$PROJECT_ROOT/frontend/.env" ]; then
  sed -i "s|^VITE_FASTAPI_DIRECT_URL=.*|VITE_FASTAPI_DIRECT_URL=$TUNNEL_URL|" "$PROJECT_ROOT/frontend/.env"
  echo "    Updated frontend/.env: VITE_FASTAPI_DIRECT_URL=$TUNNEL_URL"
fi

DEFAULT_N8N_URL="https://lukizerk3.app.n8n.cloud/webhook/generate-motivational-short"

# 7. Print summary banner
echo ""
echo "========================================================================"
echo " MOTIVATIONAL SHORTS STUDIO IS READY!"
echo "========================================================================"
echo " 1. Frontend Web App:       http://localhost:5173"
echo " 2. Local Backend Service:  http://localhost:8000"
echo " 3. Public Cloudflare URL:  $TUNNEL_URL"
echo " 4. Target n8n Webhook:     $DEFAULT_N8N_URL"
echo "========================================================================"
echo ""
echo " Configuration Check:"
echo " - In your browser at http://localhost:5173, click 'Studio Config' (top-right)."
echo " - Verify FastAPI Public Base URL is: $TUNNEL_URL"
echo " - Verify n8n Webhook URL is:         $DEFAULT_N8N_URL"
echo " - Ensure 'Backend Proxy Mode' is enabled (eliminates browser CORS)."
echo ""
echo " Cloudflare Quick Tunnel Notice:"
echo " - Quick Tunnels are designed for development."
echo " - The tunnel URL will remain active until you stop this script (Ctrl+C)."
echo "========================================================================"
echo "Press Ctrl+C to stop all servers and close the tunnel."
echo ""

# Keep running until Ctrl+C
while true; do
  sleep 2
done
