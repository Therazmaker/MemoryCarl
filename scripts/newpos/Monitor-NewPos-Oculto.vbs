' Arranca el monitor SIN ventana. Se puede parar con Detener-Monitor.bat
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & dir & "\Diagnostico-NewPos.ps1"" -Monitor", 0, False
