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
  ; Same aggressive kill before the old uninstaller deletes files.
  !insertmacro killAppHard
!macroend

; --- DỨT ĐIỂM fix cho "failed to uninstall old application files" ---
; electron-builder's NSIS template aborts the upgrade install when the
; old uninstaller returns a non-zero exit code. The old uninstaller
; returns non-zero whenever ANY file fails to delete (typical culprits:
; mssql native .node files, Electron asar, Defender-scanned binaries
; that briefly hold a handle even after the process is gone).
;
; By overriding customRemoveFiles we replace the default RMDir step
; with a best-effort delete that suppresses errors via ClearErrors,
; so the uninstaller always returns success. The new installer then
; overwrites whatever remains (kill macro already ensures no live
; handles exist by then, so overwrite is safe).
!macro customRemoveFiles
  !insertmacro killAppHard

  ClearErrors
  RMDir /r "$INSTDIR\resources"
  ClearErrors
  RMDir /r "$INSTDIR\locales"
  ClearErrors
  RMDir /r "$INSTDIR"
  ClearErrors
!macroend

; --- THE definitive fix for "Failed to uninstall old application files" ---
; electron-builder's handleUninstallResult in installUtil.nsh shows that
; localized MessageBox + Quit whenever the OLD uninstaller exits with
; non-zero code (e.g. because a file was locked momentarily).
;
; That function has an early-return escape hatch: if customUnInstallCheck
; is defined, it's executed and the function returns BEFORE the exit-code
; check. Same for HKEY_CURRENT_USER path via customUnInstallCheckCurrentUser.
;
; We override both with no-op stubs so the new installer NEVER aborts the
; upgrade just because the old uninstaller failed cleanup. The
; customRemoveFiles + killAppHard macros above already do best-effort
; cleanup; if any file remained, the new installer will overwrite it.
!macro customUnInstallCheck
  DetailPrint "customUnInstallCheck: bypassing exit code check (R0=$R0)"
!macroend

!macro customUnInstallCheckCurrentUser
  DetailPrint "customUnInstallCheckCurrentUser: bypassing exit code check (R0=$R0)"
!macroend
