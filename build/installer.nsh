; Custom NSIS script for Quan Ly Xe installer.
; Kill any running instance of the app BEFORE the embedded uninstaller
; runs, so it doesn't fail with "failed to uninstall old application"
; when files are still locked by the old process during auto-update.

!macro customInit
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500
!macroend
