!macro customInstall
  WriteRegStr SHCTX "Software\Classes\com.gridscale.native.ses-agent" "" "URL:SES Agent Member Center Callback"
  WriteRegStr SHCTX "Software\Classes\com.gridscale.native.ses-agent" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\com.gridscale.native.ses-agent\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\com.gridscale.native.ses-agent\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\com.gridscale.native.ses-agent"
!macroend
