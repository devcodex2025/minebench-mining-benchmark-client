; NSIS installer hooks for the MineBench Client *stable* channel.
;
; CPU temperature needs a kernel driver, and the PawnIO device is only reachable
; from an elevated process. MineBench therefore ships a small native broker and
; registers a highest-privileges scheduled task here, at install time, so the
; running application never elevates and the user is never prompted.
;
; Registration is the consent step; uninstall removes the task again.
;
; Stable is the only channel that replaces a pre-0.9 installation, so it is also
; the only hook that migrates the legacy `cloud.minebench.client` profile and
; cleans up the legacy registry entries. canary and nightly are new identities
; that must stay fully isolated - see installer-hooks.canary.nsh and
; installer-hooks.nightly.nsh.
;
; Only the taskkill target of *this* channel changes per hook. The broker and
; xmrig image names are shared on purpose: the channels are mutually exclusive at
; runtime, so at most one of them can own those processes.

!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "xmrig.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "minebench-client.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "MineBench Client.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "minebench-sensor-broker.exe" /T'
!macroend

; $INSTDIR is set by the Tauri NSIS template before post-install hooks run. The
; scripts locate the broker themselves, so no path has to be quoted through NSIS.
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the update source..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\installer\write-update-source.ps1$\" -Channel stable -Identifier minebench.client'
  Pop $0
  DetailPrint "Update source registration returned $0"

  DetailPrint "Migrating the profile from the legacy identifier..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\migrate-legacy-profile.ps1$\"'
  Pop $0
  DetailPrint "Legacy profile migration returned $0"

  DetailPrint "Registering the MineBench CPU sensor task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\register-broker-task.ps1$\" -Operation register -TaskName MineBenchSensorBroker -StateRoot MineBench -BrokerPath "$\"$INSTDIR\minebench-sensor-broker.exe$\"'
  Pop $0
  DetailPrint "CPU sensor task registration returned $0"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the MineBench CPU sensor task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\register-broker-task.ps1$\" -Operation remove -TaskName MineBenchSensorBroker'
  Pop $0
!macroend
