@echo off
REM Dejar abierto todo el turno: anota en el Escritorio (Monitor-NewPos.csv) cada caida de conexion.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostico-NewPos.ps1" -Monitor
