; Paperlight's additions to the Windows installer (bundle > windows > nsis > installerHooks
; in tauri.conf.json). Tauri inserts NSIS_HOOK_PREINSTALL at the start of the install
; section, before it checks for a running copy and copies the files.

; Updating while Paperlight is running: the stock installer ends the running copy and starts
; copying half a second later. On a slow or busy PC Windows (or a virus scanner looking at
; the file) can still be holding paperlight.exe at that moment, and the copy stops with
; "Error opening file for writing". So, for updates and other unattended installs, end the
; running copy here, then wait until the program file can really be written, for at most
; 15 seconds. If it still can't, the stock steps run exactly as before.
;
; An attended install is left alone: there the stock step asks before closing Paperlight.
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1

  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
    ${OrIf} ${Silent}
      !if "${INSTALLMODE}" == "currentUser"
        nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
      !else
        nsis_tauri_utils::FindProcess "${MAINBINARYNAME}.exe"
      !endif
      Pop $R0
      ${If} $R0 = 0
        !if "${INSTALLMODE}" == "currentUser"
          nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
        !else
          nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
        !endif
        Pop $R0
      ${EndIf}

      ; Opening the file for appending fails for as long as anything keeps it locked.
      StrCpy $R1 0
      ${Do}
        ClearErrors
        FileOpen $R0 "$INSTDIR\${MAINBINARYNAME}.exe" a
        ${IfNot} ${Errors}
          FileClose $R0
          ${ExitDo}
        ${EndIf}
        Sleep 250
        IntOp $R1 $R1 + 1
      ${LoopUntil} $R1 >= 60
      ClearErrors
    ${EndIf}
  ${EndIf}

  Pop $R1
  Pop $R0
!macroend
