@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   IPTV scan + publish
echo   dir: %CD%
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
echo Install Node.js 18+ from https://nodejs.org/
goto hold

:found_node
echo [INFO] Node = %NODE_EXE%
"%NODE_EXE%" -v
echo.
if not exist "%~dp0scan-publish.mjs" (
  echo [ERROR] scan-publish.mjs missing
  goto hold
)
echo [INFO] running scan-publish.mjs ...
echo.
"%NODE_EXE%" "%~dp0scan-publish.mjs"
echo.
if errorlevel 1 (
  echo [FAIL] exit code %ERRORLEVEL%
) else (
  echo [OK] done
)

:hold
echo.
echo Press any key to close...
pause >nul
endlocal