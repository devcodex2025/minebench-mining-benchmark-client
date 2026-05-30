!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "xmrig.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "MineBench Client.exe" /T'
!macroend
