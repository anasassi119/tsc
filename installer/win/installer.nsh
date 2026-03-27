!macro customWelcomePage
  !insertmacro MUI_HEADER_TEXT "Install TSC" "Set up The Software Company on your machine"
!macroend

!macro customFinishPage
  !insertmacro MUI_HEADER_TEXT "TSC is installed" "Launch TSC and start building"
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_HEADER_TEXT "Uninstall TSC" "Remove The Software Company from this machine"
!macroend
