; Custom NSIS hooks for Quan Ly Xe installer.
; Auto-discovered by electron-builder when placed at build/installer.nsh.
;
; Purpose: NSIS oneClick auto-update fails with
;   "failed to uninstall old application files"
; when the embedded uninstaller of the old version can't delete files
; that are still locked by the running process. We aggressively kill
; the old process BEFORE the uninstaller runs, with multiple retries
; and longer settling sleeps for the OS to release file handles
; (Defender / antivirus scans, native modules, crashpad handler, etc.).

!macro killAppHard
  ; Five rounds of taskkill /F /T with 2s gaps — defends against
  ; renderer/GPU/utility processes respawning between rounds.
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "Quan Ly Xe - Cho Thu Duc.exe" /T'
  Sleep 1500

  ; Defensive — kill known Electron child processes by image name if any
  ; spawned out from the main exe tree (e.g. older Electron crashpad).
  nsExec::Exec 'taskkill /F /IM "crashpad_handler.exe" /T'
  Sleep 500
  nsExec::Exec 'taskkill /F /IM "Squirrel.exe" /T'
  Sleep 500

  ; Final settling — let Windows release file handles, Defender finish
  ; scanning newly-extracted files, and mssql.node finish unloading.
  Sleep 4000
!macroend

!macro customInit
  ; 1. Ask the visible top-level window to close gracefully so Electron
  ;    runs its before-quit hooks (mssql pool close, etc.).
  FindWindow $0 "" "Quan Ly Xe - Cho Thu Duc"
  ${If} $0 <> 0
    SendMessage $0 ${WM_CLOSE} 0 0
    Sleep 2000
  ${EndIf}

  ; 2. Force kill aggressively.
  !insertmacro killAppHard
!macroend

!macro customUnInit
  ; Same aggressive kill before the old uninstaller deletes files —
  ; this is the hook that fixes "failed to uninstall old application files".
  !insertmacro killAppHard
!macroend
