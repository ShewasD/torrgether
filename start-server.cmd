@echo off
setlocal
cd /d "%~dp0"

if exist ".tools\node\node.exe" (
  set "PATH=%CD%\.tools\node;%PATH%"
)

if "%HOST%"=="" set "HOST=0.0.0.0"
if "%PORT%"=="" set "PORT=3000"
if "%NODE_ENV%"=="" set "NODE_ENV=production"
if "%TORRGETHER_SERVER_PID_FILE%"=="" set "TORRGETHER_SERVER_PID_FILE=%CD%\torrgether-server.pid"

echo Starting Torrgether signaling server on %HOST%:%PORT%
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p = Start-Process -FilePath 'node' -ArgumentList @('server\server.js') -NoNewWindow -PassThru; Set-Content -LiteralPath $env:TORRGETHER_SERVER_PID_FILE -Value $p.Id -NoNewline; try { Wait-Process -Id $p.Id; $p.Refresh(); exit $p.ExitCode } finally { Remove-Item -LiteralPath $env:TORRGETHER_SERVER_PID_FILE -Force -ErrorAction SilentlyContinue }"
exit /b %ERRORLEVEL%
