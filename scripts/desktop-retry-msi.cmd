@echo off
setlocal

rem Retry MSI bundling only (exe + frontend + server bundle must already exist).
call "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
  echo [desktop-retry-msi] Failed to initialize MSVC environment.
  exit /b 1
)

set "PATH=C:\Program Files\Rust stable MSVC 1.96\bin;%PATH%"
set "CARGO_TARGET_DIR=%~dp0..\src-tauri\target"

cd /d "%~dp0..\src-tauri"
call npx tauri build --target x86_64-pc-windows-msvc
exit /b %ERRORLEVEL%
