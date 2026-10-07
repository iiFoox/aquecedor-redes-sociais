; Instalador do WarmUp Studio (electron-builder, NSIS).
; Desinstalar de verdade tira o "Iniciar com o Windows" (o app grava em HKCU\...\Run). Numa atualização o
; desinstalador da versão antiga também roda: aí não mexe, senão o início com o Windows se perderia.
; O nome do registro é o id do app (APP_ID): uma cópia de teste, com outro id, só apaga o dela.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  ${endIf}
!macroend

; Sempre "só para mim" (sem pedir administrador): pula a página que pergunta "todos os usuários ou só eu".
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
