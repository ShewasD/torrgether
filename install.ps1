param(
  [switch]$Run,
  [switch]$BuildWin,
  [switch]$BuildLinux,
  [switch]$AddToUserPath,
  [switch]$AddToSystemPath,
  [switch]$InstallMpv,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsDir = Join-Path $Root '.tools'
$NodeDir = Join-Path $ToolsDir 'node'
$NodeVersion = if ($env:TORRGETHER_NODE_VERSION) { $env:TORRGETHER_NODE_VERSION } else { 'v24.15.0' }
$NodeBaseUrl = "https://nodejs.org/dist/$NodeVersion"

if ($Help) {
  Write-Host @"
Usage: install.cmd [-Run] [-BuildWin] [-BuildLinux] [-AddToUserPath] [-AddToSystemPath] [-InstallMpv]

Downloads portable Node LTS into .tools\node when Node is missing, installs npm
dependencies, and optionally runs or builds Torrgether.

  -Run            Start the Electron app after install.
  -BuildWin       Build the Windows NSIS .exe installer.
  -BuildLinux     Build the Linux AppImage when running in a Linux-capable build environment.
  -AddToUserPath  Add this project's portable Node to the current user's PATH.
  -AddToSystemPath Add this project's portable Node and MPV bin folder to the system PATH. Requires admin.
  -InstallMpv     Download and install portable MPV into resources\bin.
"@
  exit 0
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PortableNodeBin {
  $nodeExe = Join-Path $NodeDir 'node.exe'
  if (Test-Path $nodeExe) { return $NodeDir }
  return $null
}

function Get-SystemNodeBin {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) { return Split-Path -Parent $node.Source }
  return $null
}

function Install-PortableNode {
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  $tmp = Join-Path $ToolsDir 'node-download'
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  $shaPath = Join-Path $tmp 'SHASUMS256.txt'
  Invoke-WebRequest -Uri "$NodeBaseUrl/SHASUMS256.txt" -OutFile $shaPath
  $entry = Get-Content $shaPath | Where-Object { $_ -match 'node-v.*-win-x64\.zip$' } | Select-Object -First 1
  if (-not $entry) { throw 'Could not find Windows x64 Node ZIP in SHASUMS256.txt' }

  $parts = $entry -split '\s+'
  $expectedHash = $parts[0].ToLowerInvariant()
  $fileName = $parts[-1]
  $zipPath = Join-Path $tmp $fileName

  Write-Host "Downloading portable Node LTS: $fileName"
  Invoke-WebRequest -Uri "$NodeBaseUrl/$fileName" -OutFile $zipPath
  $actualHash = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Node ZIP checksum mismatch. Expected $expectedHash, got $actualHash"
  }

  Expand-Archive -LiteralPath $zipPath -DestinationPath $tmp -Force
  $expanded = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'node-v*-win-x64' } | Select-Object -First 1
  if (-not $expanded) { throw 'Node ZIP did not contain the expected directory' }

  if (Test-Path $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
  Move-Item -LiteralPath $expanded.FullName -Destination $NodeDir
  Remove-Item -LiteralPath $tmp -Recurse -Force
  return $NodeDir
}

function Add-NodeToUserPath {
  param([string]$PathToAdd)

  $fullPath = [System.IO.Path]::GetFullPath($PathToAdd).TrimEnd('\')
  $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $pathItems = @()
  if ($currentPath) {
    $pathItems = $currentPath -split ';' | Where-Object { $_ }
  }

  foreach ($item in $pathItems) {
    try {
      $expanded = [Environment]::ExpandEnvironmentVariables($item)
      if ([System.IO.Path]::GetFullPath($expanded).TrimEnd('\') -ieq $fullPath) {
        Write-Host "User PATH already contains: $fullPath"
        return
      }
    } catch {
      if ($item.TrimEnd('\') -ieq $fullPath) {
        Write-Host "User PATH already contains: $fullPath"
        return
      }
    }
  }

  $newPath = if ($currentPath) { "$currentPath;$fullPath" } else { $fullPath }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host "Added to current-user PATH: $fullPath"
  Write-Host 'Open a new terminal window for the permanent PATH change to apply.'
}

function Add-ToSystemPath {
  param([string]$PathToAdd)

  if (-not (Test-IsAdmin)) {
    throw "Adding to System PATH requires an elevated PowerShell session. Rerun install.cmd as Administrator or use -AddToUserPath."
  }

  $fullPath = [System.IO.Path]::GetFullPath($PathToAdd).TrimEnd('\')
  $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
  $currentPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $pathItems = @()
  if ($currentPath) {
    $pathItems = $currentPath -split ';' | Where-Object { $_ }
  }

  foreach ($item in $pathItems) {
    try {
      $expanded = [Environment]::ExpandEnvironmentVariables($item)
      if ([System.IO.Path]::GetFullPath($expanded).TrimEnd('\') -ieq $fullPath) {
        Write-Host "System PATH already contains: $fullPath"
        return
      }
    } catch {
      if ($item.TrimEnd('\') -ieq $fullPath) {
        Write-Host "System PATH already contains: $fullPath"
        return
      }
    }
  }

  $newPath = if ($currentPath) { "$currentPath;$fullPath" } else { $fullPath }
  Set-ItemProperty -Path $key -Name Path -Value $newPath
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
  $signature = @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
  $existingType = ([System.Management.Automation.PSTypeName]'TorrgetherInstall.Win32SendMessageTimeout').Type
  $type = if ($existingType) {
    $existingType
  } else {
    Add-Type -MemberDefinition $signature -Name Win32SendMessageTimeout -Namespace TorrgetherInstall -PassThru
  }
  $result = [UIntPtr]::Zero
  [void]$type::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$result)
  Write-Host "Added to System PATH: $fullPath"
}

function Invoke-MpvInstall {
  $helper = Join-Path $Root 'build\install-mpv.ps1'
  if (-not (Test-Path $helper)) { throw "MPV installer helper is missing: $helper" }
  $sevenZip = Join-Path $Root 'node_modules\7zip-bin\win\x64\7za.exe'
  $psArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $helper,
    '-InstallDir', $Root
  )
  if (Test-Path $sevenZip) {
    $psArgs += @('-SevenZipPath', $sevenZip)
  }
  if ($AddToSystemPath) {
    $psArgs += '-AddToSystemPath'
  }
  & powershell.exe @psArgs
  if ($LASTEXITCODE -ne 0) { throw "MPV install failed with exit code $LASTEXITCODE" }
}

$portableNodeBin = Get-PortableNodeBin
if ($AddToUserPath -and -not $portableNodeBin) {
  $portableNodeBin = Install-PortableNode
}

$nodeBin = $portableNodeBin
if (-not $nodeBin) { $nodeBin = Get-SystemNodeBin }
if (-not $nodeBin) { $nodeBin = Install-PortableNode }

$nodeBin = [System.IO.Path]::GetFullPath($nodeBin)
$env:PATH = "$nodeBin;$env:PATH"

if ($AddToUserPath) {
  Add-NodeToUserPath $nodeBin
}

if ($AddToSystemPath) {
  Add-ToSystemPath $nodeBin
}

$nodeCmd = (Get-Command node.exe -ErrorAction Stop).Source
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source

Write-Host "Using Node: $(& $nodeCmd --version)"
Write-Host "Using npm: $(& $npmCmd --version)"

Push-Location $Root
try {
  & $npmCmd install

  if ($InstallMpv) {
    Invoke-MpvInstall
  }

  if ($AddToSystemPath) {
    $mpvBin = Join-Path $Root 'resources\bin'
    if (Test-Path $mpvBin) { Add-ToSystemPath $mpvBin }
  }

  if ($Run) { & $npmCmd run client }
  if ($BuildWin) { & $npmCmd run dist:win }
  if ($BuildLinux) { & $npmCmd run dist:linux }
} finally {
  Pop-Location
}
