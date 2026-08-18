@echo off
setlocal
set "PS1=%~dp0scheduler-start.ps1"

if "%~1"=="" goto start_default
if "%~2"=="" goto start_target
goto start_init

:start_default
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto done

:start_target
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1"
goto done

:start_init
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1" -Init -CommandAuthors "%~2"
goto done

:done
echo.
echo Scheduler exited. Press any key to close.
pause >nul
endlocal
