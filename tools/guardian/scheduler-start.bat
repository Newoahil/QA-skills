@echo off
REM QA Guardian scheduler — double-click launcher (Windows).
REM Runs scheduler-start.ps1 with ExecutionPolicy Bypass so you don't have to change global policy.
REM
REM Usage:
REM   Double-click this file  → starts using target from env QA_GUARDIAN_REPO / scheduler.config.json,
REM                             or prompts to create config on first run.
REM   scheduler-start.bat D:\your-project            → watch that repo
REM   scheduler-start.bat D:\your-project your-login  → also create config with that command author
setlocal
set "PS1=%~dp0scheduler-start.ps1"

if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else if "%~2"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1" -Init -CommandAuthors "%~2"
)

echo.
echo (scheduler exited) Press any key to close...
pause >nul
endlocal
