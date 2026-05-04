param(
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$SevenZipPath,
  [switch]$AddToSystemPath,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'zhongfly/mpv-winbuild'
$ReleaseApi = "https://api.github.com/repos/$Repo/releases/latest"

function Write-Step {
  param([string]$Message)
  Write-Host "[mpv] $Message"
}

function Invoke-WebRequestCompat {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [string]$OutFile
  )

  $params = @{
    Uri = $Uri
    Headers = @{ 'User-Agent' = 'Torrgether installer' }
    UseBasicParsing = $true
  }
  if ($OutFile) { $params.OutFile = $OutFile }
  Invoke-WebRequest @params
}

function Convert-ResponseContentToText {
  param($Content)

  if ($Content -is [byte[]]) {
    return [Text.Encoding]::UTF8.GetString($Content)
  }

  return [string]$Content
}

function Get-InstallBinDir {
  param([string]$BaseDir)
  $resourcesBin = Join-Path $BaseDir 'resources\bin'
  if (Test-Path (Join-Path $BaseDir 'resources')) { return $resourcesBin }
  return Join-Path $BaseDir 'bin'
}

function Select-MpvAsset {
  param([object]$Release)

  $asset = $Release.assets |
    Where-Object { $_.name -match '^mpv-x86_64-\d{8}-git-[A-Za-z0-9]+\.7z$' } |
    Select-Object -First 1

  if (-not $asset) {
    throw "Could not find a compatible mpv-x86_64 asset in $Repo latest release."
  }

  $checksum = $Release.assets |
    Where-Object { $_.name -match '^sha256(?:sums)?\.txt$' } |
    Select-Object -First 1

  [pscustomobject]@{
    Name = $asset.name
    Url = $asset.browser_download_url
    ChecksumUrl = $checksum.browser_download_url
  }
}

function Read-AssetHash {
  param(
    [string]$ChecksumText,
    [string]$AssetName
  )

  foreach ($line in ($ChecksumText -split "`r?`n")) {
    if ($line.Trim() -match '^([a-fA-F0-9]{64})\s+\*?(.+)$') {
      $hash = $Matches[1].ToLowerInvariant()
      $name = ($Matches[2].Trim() -replace '^\./+', '')
      if ([IO.Path]::GetFileName($name) -eq $AssetName) { return $hash }
    }
  }

  return $null
}

function Resolve-SevenZip {
  param([string]$ExplicitPath)

  if ($ExplicitPath -and (Test-Path $ExplicitPath)) {
    return [IO.Path]::GetFullPath($ExplicitPath)
  }

  $resourceCandidate = Join-Path $InstallDir 'resources\bin\7za.exe'
  if (Test-Path $resourceCandidate) { return [IO.Path]::GetFullPath($resourceCandidate) }

  $scriptCandidate = Join-Path $PSScriptRoot 'bin\7za.exe'
  if (Test-Path $scriptCandidate) { return [IO.Path]::GetFullPath($scriptCandidate) }

  $command = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $command = Get-Command 7za.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  throw '7za.exe was not found. The installer must include node_modules/7zip-bin/win/x64/7za.exe as an extra resource.'
}

function Add-SystemPathEntry {
  param([string]$PathToAdd)

  $fullPath = [IO.Path]::GetFullPath($PathToAdd).TrimEnd('\')
  $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
  $currentPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $items = @()
  if ($currentPath) { $items = $currentPath -split ';' | Where-Object { $_ } }

  foreach ($item in $items) {
    try {
      $expanded = [Environment]::ExpandEnvironmentVariables($item)
      if ([IO.Path]::GetFullPath($expanded).TrimEnd('\') -ieq $fullPath) {
        Write-Step "System PATH already contains $fullPath"
        return
      }
    } catch {
      if ($item.TrimEnd('\') -ieq $fullPath) {
        Write-Step "System PATH already contains $fullPath"
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
  $type = Add-Type -MemberDefinition $signature -Name Win32SendMessageTimeout -Namespace Torrgether -PassThru
  $result = [UIntPtr]::Zero
  [void]$type::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$result)
  Write-Step "Added to System PATH: $fullPath"
}

function Test-Mpv {
  param([string]$MpvPath)
  & $MpvPath --version | Select-Object -First 1
}

$binDir = Get-InstallBinDir $InstallDir
$mpvExe = Join-Path $binDir 'mpv.exe'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

if ((Test-Path $mpvExe) -and -not $Force) {
  Write-Step "MPV already exists at $mpvExe"
  Test-Mpv $mpvExe | ForEach-Object { Write-Step $_ }
  if ($AddToSystemPath) {
    Add-SystemPathEntry $InstallDir
    Add-SystemPathEntry $binDir
  }
  exit 0
}

$sevenZip = Resolve-SevenZip $SevenZipPath
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("torrgether-mpv-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  Write-Step "Fetching latest MPV release metadata from $Repo"
  $release = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ 'User-Agent' = 'Torrgether installer' }
  $asset = Select-MpvAsset $release
  $archivePath = Join-Path $tmp $asset.Name

  Write-Step "Downloading $($asset.Name)"
  Invoke-WebRequestCompat -Uri $asset.Url -OutFile $archivePath | Out-Null

  if ($asset.ChecksumUrl) {
    Write-Step 'Verifying SHA256 checksum'
    $shaResponse = Invoke-WebRequestCompat -Uri $asset.ChecksumUrl
    $shaText = Convert-ResponseContentToText $shaResponse.Content
    $expectedHash = Read-AssetHash $shaText $asset.Name
    if (-not $expectedHash) { throw "sha256.txt does not contain $($asset.Name)" }
    $actualHash = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
      throw "MPV checksum mismatch. Expected $expectedHash, got $actualHash"
    }
  } else {
    throw 'Latest MPV release does not include sha256.txt; refusing unchecked install.'
  }

  $extractDir = Join-Path $tmp 'extract'
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  Write-Step 'Extracting MPV archive'
  & $sevenZip x "-o$extractDir" -y $archivePath | Out-Null

  $foundMpv = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter mpv.exe | Select-Object -First 1
  if (-not $foundMpv) { throw 'MPV archive did not contain mpv.exe' }

  $mpvSourceDir = Split-Path -Parent $foundMpv.FullName
  Copy-Item -Path (Join-Path $mpvSourceDir '*') -Destination $binDir -Recurse -Force
  Test-Mpv $mpvExe | ForEach-Object { Write-Step $_ }

  if ($AddToSystemPath) {
    Add-SystemPathEntry $InstallDir
    Add-SystemPathEntry $binDir
  }

  Write-Step "MPV installed to $mpvExe"
} finally {
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
