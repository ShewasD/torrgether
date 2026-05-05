@echo off
setlocal
cd /d "%~dp0"

if exist ".tools\node\node.exe" (
  set "PATH=%CD%\.tools\node;%PATH%"
)

if not exist "node_modules\.bin\electron.cmd" (
  echo Electron was not found at node_modules\.bin\electron.cmd
  echo Run install.cmd first, or run a packaged Windows build.
  exit /b 1
)

if "%MPV_PATH%"=="" (
  where mpv.exe >nul 2>nul
  if errorlevel 1 (
    echo MPV was not found in PATH. Install mpv, set MPV_PATH, or run install.cmd -InstallMpv.
    exit /b 1
  )
)

echo Starting Torrgether Electron client
call node_modules\.bin\electron.cmd desktop\main.js
