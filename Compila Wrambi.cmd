@echo off
rem Compila Wrambi e crea il programma di installazione. Basta un doppio clic.
rem Opzioni da Prompt dei comandi:
rem   "Compila Wrambi.cmd"            test dell'interfaccia, poi compilazione
rem   "Compila Wrambi.cmd" completo   anche i test del nucleo Rust (molto piu' lento)
rem   "Compila Wrambi.cmd" rapido     senza test
setlocal EnableExtensions
cd /d "%~dp0"
title Wrambi - compilazione
echo.
echo   Wrambi - compilazione per Windows
echo.
call "%~dp0scripts\ambiente.cmd"
if errorlevel 1 goto :errore

if /i "%~1"=="rapido" goto :build
echo.
echo   [1/3] Test dell'interfaccia...
call npm test
if errorlevel 1 goto :test_falliti
if /i not "%~1"=="completo" goto :build
echo.
echo   Test del nucleo Rust: la prima volta richiede vari minuti...
call cargo test --manifest-path src-tauri\Cargo.toml --lib
if errorlevel 1 goto :test_falliti

:build
echo.
echo   [2/3] Compilazione di Wrambi: la prima volta 10-25 minuti, le successive pochi minuti...
call npm run app:build
if errorlevel 1 goto :build_fallita

echo.
echo   [3/3] Copia nella cartella "installer"...
if not exist "installer" mkdir "installer"
copy /y "%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe" "installer\" >nul
copy /y "%CARGO_TARGET_DIR%\release\wrambi.exe" "installer\Wrambi-portatile.exe" >nul
echo.
echo   Fatto. Nella cartella "installer":
dir /b "installer"
echo.
echo   Il file che finisce con "-setup.exe" installa Wrambi; Wrambi-portatile.exe si avvia senza installare.
start "" explorer "%~dp0installer"
goto :fine

:test_falliti
echo.
echo   I test non sono passati: la compilazione si ferma qui. Copia i messaggi qui sopra.
goto :fine
:build_fallita
echo.
echo   La compilazione non e' riuscita. Copia i messaggi qui sopra (soprattutto le righe con "error").
goto :fine
:errore
echo.
echo   Compilazione interrotta.
:fine
echo.
pause
endlocal
