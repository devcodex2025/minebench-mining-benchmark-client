; NSIS installer hooks for the MineBench Client *canary* channel.
;
; Same broker registration as stable (see installer-hooks.nsh), but every
; identity is channel-scoped:
;   - its own scheduled task name, so a canary install never overwrites the
;     task a stable/nightly install depends on;
;   - its own process image name, so an install only terminates its own client.
;
; There is deliberately no profile migration here: canary is a separate
; application identity and must not inherit stable's data.

!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "xmrig.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "minebench-client-canary.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "minebench-sensor-broker.exe" /T'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the update source..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\installer\write-update-source.ps1$\" -Channel canary -Identifier minebench.canary'
  Pop $0
  DetailPrint "Update source registration returned $0"

  DetailPrint "Registering the MineBench Canary CPU sensor task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\register-broker-task.ps1$\" -Operation register -TaskName MineBenchSensorBrokerCanary -StateRoot MineBenchCanary -BrokerPath "$\"$INSTDIR\minebench-sensor-broker.exe$\"'
  Pop $0
  DetailPrint "CPU sensor task registration returned $0"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the MineBench Canary CPU sensor task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$\"$INSTDIR\_up_\resources\sensor-broker\register-broker-task.ps1$\" -Operation remove -TaskName MineBenchSensorBrokerCanary'
  Pop $0
!macroend
