@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ========================================
echo   Publish to GitHub Pages
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
goto hold
:found_node
echo [INFO] Node = %NODE_EXE%
"%NODE_EXE%" -v
echo.
"%NODE_EXE%" "%~dp0publish.mjs"
echo.
:hold
echo Press any key to close...
pause >nul
endlocal