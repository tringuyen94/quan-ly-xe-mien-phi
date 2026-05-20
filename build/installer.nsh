; Custom NSIS hooks for Quan Ly Xe installer.
; Auto-discovered by electron-builder when placed at build/installer.nsh.
;
; Purpose: NSIS oneClick auto-update fails with
;   "failed to uninstall old application files"
; when the embedded uninstaller of the old version can't delete files
; that are still locked by the running process. We aggressively kill
; the old process BEFORE the uninstaller runs.

!macro customInit
  ; 1. Ask all top-level windows to close gracefully
  FindWindow $0 "" "Quan Ly Xe - Cho Thu Duc"
  ${If} $0 <> 0
    SendMessage $0 ${WM_CLOSE} 0 0
    Sleep 1500
  ${EndIf}

  ; 2. Force kill any remaining process tree (main + helper/GPU procs)
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500

  ; 3. Second pass in case taskkill missed late-spawned children
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500
!macroend
