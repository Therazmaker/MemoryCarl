@echo off
REM Hace que el monitor arranque solo y oculto cada vez que se inicia sesion en esta PC.
REM No necesita permisos de administrador. Para quitarlo: Desinstalar-Inicio-Automatico.bat
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0Monitor-NewPos-Oculto.vbs""", 0, False> "%STARTUP%\NewPos-Monitor.vbs"
wscript.exe "%~dp0Monitor-NewPos-Oculto.vbs"
echo.
echo Listo: el monitor ya esta corriendo oculto y arrancara solo en cada inicio de sesion.
echo Para comprobarlo, revisa el panel /newpos o el archivo Monitor-NewPos.csv en el Escritorio.
echo IMPORTANTE: no muevas ni borres esta carpeta (%~dp0)
pause
