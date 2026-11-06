@echo off
rem Rebuilds the pages after an update (git pull). Then restart the "MBS client" window
rem or run start-mbs.bat again.
cd /d "%~dp0"
call npm --prefix client run prod:build
if errorlevel 1 (echo Build failed. & pause & exit /b 1)
echo Pages rebuilt.
