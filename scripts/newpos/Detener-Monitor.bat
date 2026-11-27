@echo off
REM Para el monitor oculto (no quita el inicio automatico).
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*Diagnostico-NewPos.ps1*-Monitor*' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host ('Monitores detenidos: ' + @($p).Count)"
pause
