@echo off
setlocal
cd /d "%~dp0"

if exist ".tools\node\node.exe" (
  set "PATH=%CD%\.tools\node;%PATH%"
)

if "%HOST%"=="" set "HOST=0.0.0.0"
if "%PORT%"=="" set "PORT=3000"
if "%NODE_ENV%"=="" set "NODE_ENV=production"

echo Starting Torrgether signaling server on %HOST%:%PORT%
for /f %%I in ('powershell.exe -NoProfile -Command "[System.Diagnostics.Process]::GetCurrentProcess().Parent.Id"') do set "WRAPPER_PID=%%I"
echo %WRAPPER_PID% > "%CD%\torrgether-server.pid"
node server\server.js
