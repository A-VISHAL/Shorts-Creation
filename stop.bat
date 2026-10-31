:; # Universal Polyglot Stopper (Windows CMD + Linux Bash)
: << 'WINDOWS_BATCH'
@echo off
title Stop Motivational Shorts Studio
cd /d "%~dp0"
echo ==============================================================================
echo             STOPPING MOTIVATIONAL SHORTS STUDIO SERVERS
echo ==============================================================================
echo.

echo [1/3] Terminating backend on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo [2/3] Terminating frontend on port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo [3/3] Terminating Cloudflare Tunnel processes...
taskkill /f /im cloudflared.exe >nul 2>nul

echo.
echo All Motivational Shorts Studio servers cleanly stopped.
timeout /t 2 /nobreak >nul
exit /b 0
WINDOWS_BATCH

#!/usr/bin/env bash
echo "=============================================================================="
echo "          STOPPING MOTIVATIONAL SHORTS STUDIO SERVERS"
echo "=============================================================================="
echo ""
echo "[1/3] Terminating backend on port 8000..."
fuser -k 8000/tcp 2>/dev/null || true

echo "[2/3] Terminating frontend on port 5173..."
fuser -k 5173/tcp 2>/dev/null || true

echo "[3/3] Terminating Cloudflare Tunnel processes..."
pkill -f "cloudflared tunnel.*8000" 2>/dev/null || true

echo ""
echo "All Motivational Shorts Studio servers cleanly stopped."
exit 0
