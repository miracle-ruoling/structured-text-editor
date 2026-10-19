@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please run scripts\setup.ps1 first. See README.md.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo Frontend build missing. Please run scripts\setup.ps1 first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m structured_editor
if errorlevel 1 pause
