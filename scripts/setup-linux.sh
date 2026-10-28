#!/usr/bin/env bash
# ==============================================================================
# Motivational Shorts Studio - Linux Mint / Ubuntu Environment Setup Script
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================================="
echo " Motivational Shorts Studio - Setup Script"
echo " Project root: $PROJECT_ROOT"
echo "=========================================================="

# 1. Check system dependencies
echo "--> Checking system tools (FFmpeg, FFprobe, Python 3, Node.js)..."

MISSING_DEPS=()
command -v python3 >/dev/null 2>&1 || MISSING_DEPS+=("python3")
command -v ffmpeg >/dev/null 2>&1 || MISSING_DEPS+=("ffmpeg")
command -v ffprobe >/dev/null 2>&1 || MISSING_DEPS+=("ffmpeg")
command -v yt-dlp >/dev/null 2>&1 || echo "yt-dlp will be installed in Python virtual environment."
command -v cloudflared >/dev/null 2>&1 || echo "cloudflared can be installed if exposing backend to cloud n8n."
command -v node >/dev/null 2>&1 || MISSING_DEPS+=("nodejs")
command -v npm >/dev/null 2>&1 || MISSING_DEPS+=("npm")

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo "WARNING: The following system packages are missing:"
  for dep in "${MISSING_DEPS[@]}"; do
    echo "  - $dep"
  done
  echo "On Linux Mint / Ubuntu, you can install them with:"
  echo "  sudo apt update && sudo apt install -y python3 python3-venv python3-pip ffmpeg nodejs npm"
fi

# 2. Setup Backend Python Virtual Environment
echo "--> Setting up Backend Python virtual environment..."
cd "$PROJECT_ROOT/backend"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "    Created virtual environment in backend/venv"
fi

echo "    Installing Python requirements..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

if [ ! -f ".env" ]; then
  echo "    Copying .env.example to .env..."
  cp .env.example .env
fi

mkdir -p media

# 3. Setup Frontend Node Dependencies
echo "--> Setting up Frontend Node.js dependencies..."
cd "$PROJECT_ROOT/frontend"

if [ ! -f ".env" ]; then
  echo "    Copying .env.example to .env..."
  cp .env.example .env
fi

if command -v npm >/dev/null 2>&1; then
  npm install
  echo "    Building frontend test bundle..."
  npm run build
fi

echo "=========================================================="
echo " Setup complete!"
echo " Next steps:"
echo " 1. Coordinated Dev & Tunnel: ./scripts/start-dev.sh"
echo " 2. Local-only Dev:           ./scripts/run-local.sh"
echo " 3. Or start backend:         cd backend && ./venv/bin/uvicorn app:app --port 8000"
echo " 4. Or start frontend:        cd frontend && npm run dev"
echo "=========================================================="
