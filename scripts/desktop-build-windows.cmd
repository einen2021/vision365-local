@echo off
setlocal

rem MSVC + Windows SDK (link.exe, kernel32.lib, etc.)
call "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
  echo [desktop-build] Failed to initialize MSVC environment. Install Visual Studio 2022 Build Tools with the C++ workload.
  exit /b 1
)

rem Rust (cargo) — winget installs to Program Files, not always on PATH in new terminals
set "PATH=C:\Program Files\Rust stable MSVC 1.96\bin;%PATH%"

rem Keep build output under src-tauri/target (not sandbox temp)
set "CARGO_TARGET_DIR=%~dp0..\src-tauri\target"

cd /d "%~dp0.."

call npm run desktop:server:pkg
if errorlevel 1 exit /b 1

call npm run desktop:build:frontend
if errorlevel 1 exit /b 1

cd src-tauri
call npx tauri build --target x86_64-pc-windows-msvc
exit /b %ERRORLEVEL%
