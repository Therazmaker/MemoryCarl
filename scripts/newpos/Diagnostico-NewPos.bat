@echo off
REM Doble clic = foto completa del problema. Ejecutar JUSTO cuando NewPos de el error.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostico-NewPos.ps1"
pause
