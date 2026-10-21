@echo off
rem Avvia Wrambi in modalita' sviluppo: l'interfaccia si ricarica a ogni modifica.
setlocal EnableExtensions
cd /d "%~dp0"
title Wrambi - sviluppo
call "%~dp0scripts\ambiente.cmd"
if errorlevel 1 goto :fine
echo.
echo   Avvio di Wrambi in sviluppo (la prima volta Rust compila per vari minuti)...
call npm run app
:fine
echo.
pause
endlocal
