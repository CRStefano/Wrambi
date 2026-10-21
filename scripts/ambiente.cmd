@echo off
rem Controlla i prerequisiti e prepara l'ambiente di compilazione di Wrambi.
rem Chiamato dagli script nella cartella principale. Non usa PowerShell.

where node >nul 2>nul
if errorlevel 1 goto :no_node

:check
call node "%~dp0controlla-ambiente.cjs"
if not errorlevel 1 goto :check_ok
if exist "%TEMP%\wrambi-mancano-cpp.txt" goto :offer_vs
exit /b 1

:check_ok
rem I file di compilazione di Rust (diversi GB) restano fuori da OneDrive.
set "CARGO_TARGET_DIR=%LOCALAPPDATA%\Wrambi-build\target"
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"

rem Le dipendenze si reinstallano solo se package-lock.json e' cambiato
rem dall'ultima installazione (per esempio dopo un aggiornamento di Wrambi).
if not exist "node_modules\.wrambi-lock" goto :npm_install
fc /b "package-lock.json" "node_modules\.wrambi-lock" >nul 2>nul
if not errorlevel 1 exit /b 0

:npm_install
echo.
echo   Installo le dipendenze JavaScript (serve Internet, solo la prima volta
echo   e dopo ogni aggiornamento)...
call npm install --no-fund --no-audit
if errorlevel 1 goto :npm_fail
copy /y "package-lock.json" "node_modules\.wrambi-lock" >nul
exit /b 0

:offer_vs
if defined WR_VS_TRIED goto :vs_manual
where winget >nul 2>nul
if errorlevel 1 goto :vs_manual
echo.
echo   Posso installarli adesso con winget: download di circa 2-3 GB, 6-8 GB su disco,
echo   20-40 minuti. Windows chiedera' il permesso di amministratore.
choice /c SN /m "  Installo adesso gli Strumenti di compilazione di Visual Studio 2022"
if errorlevel 2 goto :vs_manual
set "WR_VS_TRIED=1"
echo.
echo   Installazione in corso: si apre la finestra di Visual Studio Installer, lasciala lavorare...
call winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-source-agreements --accept-package-agreements --override "--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
echo.
echo   Controllo di nuovo...
goto :check

:vs_manual
echo.
echo   Installazione a mano:
echo     1. scarica gli Strumenti di compilazione da https://visualstudio.microsoft.com/visual-cpp-build-tools/
echo     2. nel programma di installazione spunta "Sviluppo di applicazioni desktop con C++" e installa;
echo     3. rilancia questo script.
exit /b 1

:no_node
echo.
echo   Manca Node.js. Installalo da https://nodejs.org (versione LTS), poi riapri questo script.
exit /b 1
:npm_fail
echo.
echo   npm install non e' riuscito: controlla la connessione e i messaggi qui sopra.
exit /b 1
