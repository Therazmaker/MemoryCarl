@echo off
REM Quita el arranque automatico y para el monitor.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NewPos-Monitor.vbs" 2>nul
call "%~dp0Detener-Monitor.bat"
echo Inicio automatico quitado.
