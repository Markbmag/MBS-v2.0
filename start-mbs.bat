@echo off
rem Starts MBS Quality: API server (port 40000) and pages (port 30000).
rem Each runs under a watchdog that restarts it if it stops. Logs: logs\
cd /d "%~dp0"

if not exist "client\dist\index.html" (
  echo Building pages - first start or after an update...
  call npm --prefix client run prod:build
  if errorlevel 1 (
    echo Build failed. See the messages above.
    pause
    exit /b 1
  )
)

start "MBS server" /min node run\supervise.js server
start "MBS client" /min node run\supervise.js client
echo MBS Quality started. Pages: http://localhost:30000   Health: http://localhost:40000/api/health
echo Logs: %~dp0logs
