!include LogicLib.nsh

!macro customInstall
  DetailPrint "Installing MPV runtime..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-mpv.ps1" -InstallDir "$INSTDIR" -SevenZipPath "$INSTDIR\resources\bin\7za.exe" -AddToSystemPath'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Torrgether could not install MPV. Check your internet connection and rerun the installer. Error code: $0"
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "Removing Torrgether PATH entries..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = ''Stop''; $$entries = @(''$INSTDIR'', ''$INSTDIR\resources\bin'') | ForEach-Object { [IO.Path]::GetFullPath($$_).TrimEnd(''\'') }; $$key = ''HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment''; $$path = [Environment]::GetEnvironmentVariable(''Path'', ''Machine''); if ($$path) { $$items = $$path -split '';'' | Where-Object { $$_ }; $$kept = foreach ($$item in $$items) { try { $$full = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($$item)).TrimEnd(''\'') } catch { $$full = $$item.TrimEnd(''\'') }; if ($$entries -notcontains $$full) { $$item } }; $$newPath = ($$kept -join '';''); Set-ItemProperty -Path $$key -Name Path -Value $$newPath; [Environment]::SetEnvironmentVariable(''Path'', $$newPath, ''Machine'') }"'
!macroend
