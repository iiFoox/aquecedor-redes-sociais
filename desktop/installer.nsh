; Instalador do WarmUp Studio (electron-builder, NSIS).
; Desinstalar de verdade tira o "Iniciar com o Windows" (o app grava em HKCU\...\Run). Numa atualização o
; desinstalador da versão antiga também roda: aí não mexe, senão o início com o Windows se perderia.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.warmupstudio.app"
  ${endIf}
!macroend
