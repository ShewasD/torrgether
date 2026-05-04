@echo off
setlocal
cd /d "%~dp0"

if exist ".tools\node\node.exe" (
  set "PATH=%CD%\.tools\node;%PATH%"
)

if "%HOST%"=="" set "HOST=0.0.0.0"
if "%PORT%"=="" set "PORT=3000"

echo Starting Torrgether signaling server on %HOST%:%PORT%
node server\server.js
