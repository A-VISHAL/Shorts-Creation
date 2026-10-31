:; # Universal Polyglot Launcher (Windows CMD + Linux Bash)
: << 'WINDOWS_BATCH'
@echo off
setlocal enabledelayedexpansion
title Motivational Shorts Studio Launcher
color 0B

:: ==============================================================================
:: Ensure working directory is the script's directory
:: (Crucial when files or folders are dragged and dropped onto start.bat)
:: ==============================================================================
cd /d "%~dp0"

echo ==============================================================================
echo                MOTIVATIONAL SHORTS STUDIO - ONE-CLICK LAUNCHER
echo ==============================================================================
echo.

:: ==============================================================================
:: Drag & Drop Handler (Windows)
:: If files or folders were dragged onto start.bat, import them into backend\media
:: ==============================================================================
set "HAS_DROPPED_FILES=0"
set "LAST_VIDEO_URL="
set "LAST_AUDIO_URL="
set "LAST_MEDIA_URL="
set "DROPPED_COUNT=0"

if not "%~1"=="" (
    set "HAS_DROPPED_FILES=1"
    echo ==============================================================================
    echo [DRAG & DROP] Detected media dropped onto start.bat!
    echo ==============================================================================
    if not exist "backend\media" mkdir "backend\media"

    for %%F in (%*) do (
        set "ITEM=%%~fF"
        if /i not "!ITEM!"=="%~f0" (
            if exist "%%~fF\*" (
                echo [FOLDER] Scanning directory for media: %%~nxF
                for %%E in (mp4 mov mkv webm avi mp3 wav m4a aac ogg flac jpg png) do (
                    for %%M in ("%%~fF\*.%%E") do (
                        if exist "%%~fM" (
                            set /a DROPPED_COUNT+=1
                            set "FILE_NAME=%%~nxM"
                            set "CLEAN_NAME=!FILE_NAME: =_!"
                            copy /y "%%~fM" "backend\media\!CLEAN_NAME!" >nul
                            echo   [+] Imported: !CLEAN_NAME!
                            set "EXT=%%~xM"
                            set "EXT=!EXT:.=!"
                            for %%V in (mp4 mov mkv webm avi) do (
                                if /i "!EXT!"=="%%V" set "LAST_VIDEO_URL=http://localhost:8000/media/!CLEAN_NAME!"
                            )
                            for %%A in (mp3 wav m4a aac ogg flac) do (
                                if /i "!EXT!"=="%%A" set "LAST_AUDIO_URL=http://localhost:8000/media/!CLEAN_NAME!"
                            )
                            set "LAST_MEDIA_URL=http://localhost:8000/media/!CLEAN_NAME!"
                        )
                    )
                )
            ) else (
                if exist "%%~fF" (
                    set /a DROPPED_COUNT+=1
                    set "FILE_NAME=%%~nxF"
                    set "CLEAN_NAME=!FILE_NAME: =_!"
                    copy /y "%%~fF" "backend\media\!CLEAN_NAME!" >nul
                    echo   [+] Imported: !CLEAN_NAME!
                    set "EXT=%%~xF"
                    set "EXT=!EXT:.=!"
                    for %%V in (mp4 mov mkv webm avi) do (
                        if /i "!EXT!"=="%%V" set "LAST_VIDEO_URL=http://localhost:8000/media/!CLEAN_NAME!"
                    )
                    for %%A in (mp3 wav m4a aac ogg flac) do (
                        if /i "!EXT!"=="%%A" set "LAST_AUDIO_URL=http://localhost:8000/media/!CLEAN_NAME!"
                    )
                    set "LAST_MEDIA_URL=http://localhost:8000/media/!CLEAN_NAME!"
                )
            )
        )
    )

    echo ------------------------------------------------------------------------------
    if defined LAST_VIDEO_URL (
        echo [URL] Dropped Video URL : !LAST_VIDEO_URL!
        echo !LAST_VIDEO_URL!| clip 2>nul
        echo       (Video URL copied to Windows Clipboard - paste with Ctrl+V)
    )
    if defined LAST_AUDIO_URL (
        echo [URL] Dropped Audio URL : !LAST_AUDIO_URL!
        if not defined LAST_VIDEO_URL (
            echo !LAST_AUDIO_URL!| clip 2>nul
            echo       (Audio URL copied to Windows Clipboard - paste with Ctrl+V)
        )
    )
    echo ------------------------------------------------------------------------------
    echo.
)

:: ==============================================================================
:: Step 1: Configuration files (.env)
:: ==============================================================================
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        echo [CONFIG] Initializing backend\.env from template...
        copy "backend\.env.example" "backend\.env" >nul
    )
)
if not exist "frontend\.env" (
    if exist "frontend\.env.example" (
        echo [CONFIG] Initializing frontend\.env from template...
        copy "frontend\.env.example" "frontend\.env" >nul
    )
)

:: ==============================================================================
:: Step 2: Python Environment Verification
:: ==============================================================================
echo [1/4] Checking Python environment...
set "PYTHON_EXE="

if exist "backend\venv\Scripts\python.exe" (
    set "PYTHON_EXE=backend\venv\Scripts\python.exe"
    echo       Using backend virtual environment: backend\venv
) else if exist "venv\Scripts\python.exe" (
    set "PYTHON_EXE=venv\Scripts\python.exe"
    echo       Using virtual environment: venv
) else (
    set "SYSTEM_PY="
    where python >nul 2>nul
    if !errorlevel! equ 0 (
        set "SYSTEM_PY=python"
    ) else (
        where py >nul 2>nul
        if !errorlevel! equ 0 (
            set "SYSTEM_PY=py -3"
        )
    )

    if not defined SYSTEM_PY (
        echo [ERROR] Python 3.10+ was not found on your system!
        echo         Please install Python from https://www.python.org/
        echo         Make sure to check "Add Python to PATH" during installation.
        echo.
        pause
        exit /b 1
    )

    echo       Creating Python virtual environment in backend\venv...
    !SYSTEM_PY! -m venv backend\venv
    if exist "backend\venv\Scripts\python.exe" (
        set "PYTHON_EXE=backend\venv\Scripts\python.exe"
        echo       Virtual environment created successfully.
        echo       Installing backend dependencies (pip install -r requirements.txt)...
        "!PYTHON_EXE!" -m pip install --upgrade pip
        "!PYTHON_EXE!" -m pip install -r backend\requirements.txt
    ) else (
        set "PYTHON_EXE=!SYSTEM_PY!"
        echo       Virtual environment creation skipped; continuing with system Python.
    )
)

:: ==============================================================================
:: Step 3: Node.js & npm Verification
:: ==============================================================================
echo [2/4] Checking Node.js environment...
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js / npm was not found on your system!
    echo         Please download and install Node.js LTS from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo       frontend\node_modules missing. Installing npm packages...
    cd frontend
    call npm install
    cd /d "%~dp0"
) else (
    echo       Node modules verified.
)

:: ==============================================================================
:: Step 4: FFmpeg Check
:: ==============================================================================
echo [3/4] Checking FFmpeg engine...
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] FFmpeg was not found in PATH!
    echo           Rendering 9:16 Shorts requires FFmpeg.
    echo           To install on Windows: winget install Gyan.FFmpeg
    echo           or download from: https://ffmpeg.org/download.html
) else (
    echo       FFmpeg detected successfully.
)

:: ==============================================================================
:: Step 5: Launch Backend and Frontend
:: ==============================================================================
echo [4/4] Starting servers...

netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo       FastAPI is already active on port 8000.
) else (
    echo       Launching FastAPI backend (http://localhost:8000)...
    start "Motivational Shorts - Backend (Port 8000)" cmd /k "cd /d "%~dp0backend" && "!PYTHON_EXE!" -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload"
)

netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo       Vite dev server is already active on port 5173.
) else (
    echo       Launching Vite frontend (http://localhost:5173)...
    start "Motivational Shorts - Frontend (Port 5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev"
)

echo       Opening Studio in your web browser...
timeout /t 3 /nobreak >nul
start http://localhost:5173

:DASHBOARD
cls
echo ==============================================================================
echo                 MOTIVATIONAL SHORTS STUDIO - STATUS DASHBOARD
echo ==============================================================================
echo.
echo   [FRONTEND] Studio UI      : http://localhost:5173
echo   [BACKEND]  FastAPI Server : http://localhost:8000
echo   [DOCS]     API Swagger UI : http://localhost:8000/docs
echo   [MEDIA]    Storage Folder : %~dp0backend\media
echo.
if defined LAST_VIDEO_URL (
    echo   [DROPPED VIDEO] !LAST_VIDEO_URL!
)
if defined LAST_AUDIO_URL (
    echo   [DROPPED AUDIO] !LAST_AUDIO_URL!
)
if defined LAST_MEDIA_URL (
    echo   (Media URL copied to clipboard! Paste into Studio UI with Ctrl+V)
    echo.
)
echo ==============================================================================
echo   COMMANDS:
echo     [O] Open Studio in Default Browser (http://localhost:5173)
echo     [M] Open Media Storage Folder in File Explorer
echo     [D] Open API Documentation (Swagger Docs)
echo     [T] Launch Cloudflare Quick Tunnel (cloudflared)
echo     [S] Stop all servers and exit
echo     [Q] Close this launcher window (servers stay running)
echo ==============================================================================
echo.

set /p USER_CHOICE="Select an option [O, M, D, T, S, Q]: "

if /i "%USER_CHOICE%"=="O" (
    start http://localhost:5173
    goto DASHBOARD
)
if /i "%USER_CHOICE%"=="M" (
    start "" "%~dp0backend\media"
    goto DASHBOARD
)
if /i "%USER_CHOICE%"=="D" (
    start http://localhost:8000/docs
    goto DASHBOARD
)
if /i "%USER_CHOICE%"=="T" (
    echo Triggering Cloudflare Tunnel reconnect via Connection Manager...
    curl -s -X POST http://127.0.0.1:8000/api/connection/retry >nul 2>nul
    timeout /t 2 /nobreak >nul
    goto DASHBOARD
)
if /i "%USER_CHOICE%"=="S" (
    goto SHUTDOWN
)
if /i "%USER_CHOICE%"=="Q" (
    exit /b 0
)

goto DASHBOARD

:SHUTDOWN
echo.
echo Stopping servers on ports 8000 and 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)
taskkill /f /im cloudflared.exe >nul 2>nul
echo All servers cleanly stopped.
timeout /t 2 /nobreak >nul
exit /b 0
WINDOWS_BATCH

#!/usr/bin/env bash
# ==============================================================================
# Motivational Shorts Studio - Linux & macOS Launcher
# Supports direct execution and drag & drop media importing
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

echo "=============================================================================="
echo "          MOTIVATIONAL SHORTS STUDIO - ONE-CLICK LINUX LAUNCHER"
echo "=============================================================================="
echo ""

LAST_VIDEO_URL=""
LAST_AUDIO_URL=""
LAST_MEDIA_URL=""
DROPPED_COUNT=0

# ------------------------------------------------------------------------------
# Drag & Drop Media Handler (Linux)
# ------------------------------------------------------------------------------
if [ "$#" -gt 0 ]; then
    echo "=============================================================================="
    echo " [DRAG & DROP] Detected media passed to launcher!"
    echo "=============================================================================="
    mkdir -p "$PROJECT_ROOT/backend/media"

    for ITEM in "$@"; do
        if [ -d "$ITEM" ]; then
            echo "[FOLDER] Scanning directory for media: $(basename "$ITEM")"
            for ext in mp4 mov mkv webm avi mp3 wav m4a aac ogg flac jpg png; do
                shopt -s nullglob nocaseglob
                for mfile in "$ITEM"/*.$ext; do
                    if [ -f "$mfile" ]; then
                        DROPPED_COUNT=$((DROPPED_COUNT + 1))
                        fname="$(basename "$mfile")"
                        cname="${fname// /_}"
                        cp -f "$mfile" "$PROJECT_ROOT/backend/media/$cname"
                        echo "  [+] Imported: $cname"
                        
                        lower_ext="${cname##*.}"
                        lower_ext="$(echo "$lower_ext" | tr '[:upper:]' '[:lower:]')"
                        case "$lower_ext" in
                            mp4|mov|mkv|webm|avi) LAST_VIDEO_URL="http://localhost:8000/media/$cname" ;;
                            mp3|wav|m4a|aac|ogg|flac) LAST_AUDIO_URL="http://localhost:8000/media/$cname" ;;
                        esac
                        LAST_MEDIA_URL="http://localhost:8000/media/$cname"
                    fi
                done
                shopt -u nullglob nocaseglob
            done
        elif [ -f "$ITEM" ]; then
            DROPPED_COUNT=$((DROPPED_COUNT + 1))
            fname="$(basename "$ITEM")"
            cname="${fname// /_}"
            cp -f "$ITEM" "$PROJECT_ROOT/backend/media/$cname"
            echo "  [+] Imported: $cname"

            lower_ext="${cname##*.}"
            lower_ext="$(echo "$lower_ext" | tr '[:upper:]' '[:lower:]')"
            case "$lower_ext" in
                mp4|mov|mkv|webm|avi) LAST_VIDEO_URL="http://localhost:8000/media/$cname" ;;
                mp3|wav|m4a|aac|ogg|flac) LAST_AUDIO_URL="http://localhost:8000/media/$cname" ;;
            esac
            LAST_MEDIA_URL="http://localhost:8000/media/$cname"
        fi
    done

    echo "------------------------------------------------------------------------------"
    if [ -n "$LAST_VIDEO_URL" ]; then
        echo "[URL] Dropped Video URL : $LAST_VIDEO_URL"
    fi
    if [ -n "$LAST_AUDIO_URL" ]; then
        echo "[URL] Dropped Audio URL : $LAST_AUDIO_URL"
    fi
    # Attempt clipboard copy if xclip or wl-copy is installed
    if command -v xclip >/dev/null 2>&1; then
        echo -n "${LAST_VIDEO_URL:-$LAST_AUDIO_URL}" | xclip -selection clipboard 2>/dev/null || true
        echo "      (URL copied to Linux Clipboard!)"
    elif command -v wl-copy >/dev/null 2>&1; then
        echo -n "${LAST_VIDEO_URL:-$LAST_AUDIO_URL}" | wl-copy 2>/dev/null || true
        echo "      (URL copied to Linux Clipboard!)"
    fi
    echo "------------------------------------------------------------------------------"
    echo ""
fi

# ------------------------------------------------------------------------------
# Step 1: Configuration check
# ------------------------------------------------------------------------------
if [ ! -f "$PROJECT_ROOT/backend/.env" ] && [ -f "$PROJECT_ROOT/backend/.env.example" ]; then
    echo "[CONFIG] Initializing backend/.env from template..."
    cp "$PROJECT_ROOT/backend/.env.example" "$PROJECT_ROOT/backend/.env"
fi
if [ ! -f "$PROJECT_ROOT/frontend/.env" ] && [ -f "$PROJECT_ROOT/frontend/.env.example" ]; then
    echo "[CONFIG] Initializing frontend/.env from template..."
    cp "$PROJECT_ROOT/frontend/.env.example" "$PROJECT_ROOT/frontend/.env"
fi

# ------------------------------------------------------------------------------
# Step 2: Python Environment Verification
# ------------------------------------------------------------------------------
echo "[1/4] Checking Python environment..."
PYTHON_BIN="$PROJECT_ROOT/backend/venv/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
    if [ -f "$PROJECT_ROOT/venv/bin/python3" ]; then
        PYTHON_BIN="$PROJECT_ROOT/venv/bin/python3"
    else
        PYTHON_BIN="python3"
    fi
fi
echo "      Using Python: $PYTHON_BIN"

# ------------------------------------------------------------------------------
# Step 3: Node.js & npm Verification
# ------------------------------------------------------------------------------
echo "[2/4] Checking Node.js & npm..."
if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] Node.js / npm not found in PATH! Please install Node.js."
    exit 1
fi

if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
    echo "      frontend/node_modules missing. Installing npm packages..."
    cd "$PROJECT_ROOT/frontend"
    npm install
    cd "$PROJECT_ROOT"
else
    echo "      Node modules verified."
fi

# ------------------------------------------------------------------------------
# Step 4: FFmpeg Check
# ------------------------------------------------------------------------------
echo "[3/4] Checking FFmpeg engine..."
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "[WARNING] FFmpeg is not installed or not in PATH!"
    echo "          Please install via: sudo apt install ffmpeg"
else
    echo "      FFmpeg verified."
fi

# ------------------------------------------------------------------------------
# Step 5: Launch Backend and Frontend
# ------------------------------------------------------------------------------
echo "[4/4] Starting servers..."

STARTED_BACKEND=0
STARTED_FRONTEND=0

if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "      FastAPI is already active on port 8000."
else
    echo "      Launching FastAPI backend on http://localhost:8000..."
    cd "$PROJECT_ROOT/backend"
    nohup "$PYTHON_BIN" -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload > /tmp/shorts_backend.log 2>&1 &
    disown 2>/dev/null || true
    cd "$PROJECT_ROOT"
fi

if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "      Vite dev server is already active on port 5173."
else
    echo "      Launching Vite frontend on http://localhost:5173..."
    cd "$PROJECT_ROOT/frontend"
    nohup npm run dev > /tmp/shorts_frontend.log 2>&1 &
    disown 2>/dev/null || true
    cd "$PROJECT_ROOT"
fi

# Wait for servers
echo "      Waiting for application services..."
sleep 2

# Launch browser
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:5173" >/dev/null 2>&1 &
fi

# ------------------------------------------------------------------------------
# Interactive Dashboard
# ------------------------------------------------------------------------------
while true; do
    echo ""
    echo "=============================================================================="
    echo "                 MOTIVATIONAL SHORTS STUDIO - STATUS DASHBOARD"
    echo "=============================================================================="
    echo ""
    echo "  [FRONTEND] Studio UI      : http://localhost:5173"
    echo "  [BACKEND]  FastAPI Server : http://localhost:8000"
    echo "  [DOCS]     API Swagger UI : http://localhost:8000/docs"
    echo "  [MEDIA]    Storage Folder : $PROJECT_ROOT/backend/media"
    
    TUNNEL_URL=$(curl -s http://127.0.0.1:8000/api/connection/status 2>/dev/null | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' | head -n 1 || true)
    if [ -n "$TUNNEL_URL" ]; then
        echo "  [TUNNEL]   Public Tunnel  : $TUNNEL_URL"
    else
        echo "  [TUNNEL]   Public Tunnel  : Initializing / Auto-Managed"
    fi
    echo ""
    if [ -n "$LAST_VIDEO_URL" ]; then
        echo "  [DROPPED VIDEO] $LAST_VIDEO_URL"
    fi
    if [ -n "$LAST_AUDIO_URL" ]; then
        echo "  [DROPPED AUDIO] $LAST_AUDIO_URL"
    fi
    echo "=============================================================================="
    echo "  COMMANDS:"
    echo "    [o] Open Studio in Default Browser (http://localhost:5173)"
    echo "    [m] Open Media Storage Folder in File Manager"
    echo "    [d] Open API Documentation (Swagger Docs)"
    echo "    [t] Reconnect / Verify Cloudflare Quick Tunnel"
    echo "    [s] Stop all servers and exit"
    echo "    [q] Exit launcher (servers stay running)"
    echo "=============================================================================="
    echo ""
    read -p "Select an option [o, m, d, t, s, q]: " USER_CHOICE

    case "$USER_CHOICE" in
        [oO])
            xdg-open "http://localhost:5173" >/dev/null 2>&1 &
            ;;
        [mM])
            xdg-open "$PROJECT_ROOT/backend/media" >/dev/null 2>&1 &
            ;;
        [dD])
            xdg-open "http://localhost:8000/docs" >/dev/null 2>&1 &
            ;;
        [tT])
            echo "Triggering Cloudflare Tunnel reconnect via Connection Manager..."
            curl -s -X POST http://127.0.0.1:8000/api/connection/retry >/dev/null 2>&1 || true
            sleep 2
            ;;
        [sS])
            echo "Stopping servers on ports 8000 and 5173..."
            fuser -k 8000/tcp 2>/dev/null || true
            fuser -k 5173/tcp 2>/dev/null || true
            pkill -f "cloudflared tunnel.*8000" 2>/dev/null || true
            echo "Servers stopped."
            exit 0
            ;;
        [qQ])
            echo "Exiting launcher. Servers remain active in background."
            exit 0
            ;;
        *)
            echo "Invalid option: $USER_CHOICE"
            ;;
    esac
done
