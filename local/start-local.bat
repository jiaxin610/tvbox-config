@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
echo ========================================
echo   Local TVBox config server
echo ========================================
echo.
set "NODE_EXE="
where node >nul 2>nul
if errorlevel 1 goto try_paths
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "NODE_EXE=%%i"
  goto found_node
)
:try_paths
if exist "%LocalAppData%\Programs\node\node.exe" set "NODE_EXE=%LocalAppData%\Programs\node\node.exe"
if defined NODE_EXE goto found_node
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if defined NODE_EXE goto found_node
if exist "d:\Software\cursor\resources\app\resources\helpers\node.exe" set "NODE_EXE=d:\Software\cursor\resources\app\resources\helpers\node.exe"
if defined NODE_EXE goto found_node
echo [ERROR] node.exe not found
pause
exit /b 1
:found_node
echo [INFO] Node = %NODE_EXE%
echo Serving folder: %CD%\local
echo.
echo On this PC open:
echo   http://127.0.0.1:8080/config.json
echo On TVBox (same WiFi) use your PC LAN IP, e.g.:
echo   http://192.168.0.105:8080/config.json
echo.
"%NODE_EXE%" "%~dp0..\serve-local.mjs"
pause
endlocal