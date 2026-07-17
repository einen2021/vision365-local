@echo off
setlocal EnableExtensions

:: Starts Vision365 desktop:dev from this folder (project root or installed copy).
:: Double-click, or pin a shortcut to Desktop / taskbar.

title Vision365 Desktop Dev

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not on PATH.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm is not on PATH.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo ERROR: package.json not found in:
  echo   %CD%
  echo Run Install-Desktop-Dev.bat first, or put this bat in the project root.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo node_modules missing — running npm install...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

echo Ensuring MongoDB binaries...
call npm run desktop:mongodb:download
if errorlevel 1 (
  echo WARNING: MongoDB download failed — server may fall back to memory-server.
)

echo.
echo Starting Vision365 desktop dev...
echo   Folder:   %CD%
echo   Frontend: http://localhost:3000
echo   API:      desktop-server
echo.
echo Close this window to stop both processes.
echo.

call npm run desktop:dev

echo.
echo Dev server stopped.
pause
endlocal
