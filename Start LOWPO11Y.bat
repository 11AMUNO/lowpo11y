@echo off
rem Double-click to run LOWPO11Y on this Windows PC (first run installs and builds; later runs start in seconds).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get the LTS installer from https://nodejs.org, install it, then double-click this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
call corepack enable
if not exist node_modules (
  call pnpm install || (echo Install failed - it needs internet the first time. & pause & exit /b 1)
)
start "" cmd /c "timeout /t 20 >nul & start http://localhost:3000"
call pnpm offline
pause
