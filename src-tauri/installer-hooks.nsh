; NSIS installer hooks for MineBench Client.
;
; CPU temperature needs a kernel driver, and the PawnIO device is only reachable
; from an elevated process. MineBench therefore ships a small native broker and
; registers a highest-privileges scheduled task here, at install time, so the
; running application never elevates and the user is never prompted.
;
; Registration is the consent step; uninstall removes the task again.

!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "xmrig.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "MineBench Client.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "minebench-sensor-broker.exe" /T'
!macroend

; $INSTDIR is set by the Tauri NSIS template before post-install hooks run. The
; script locates the broker itself, so no path has to be quoted through NSIS.
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the MineBench CPU sensor task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\register-broker-task.ps1$\" -Operation register'
  Pop $0
  DetailPrint "CPU sensor task registration returned $0"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the MineBench CPU sensor task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\register-broker-task.ps1$\" -Operation remove'
  Pop $0
!macroend
