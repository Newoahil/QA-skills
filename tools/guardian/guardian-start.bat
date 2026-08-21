@echo off
setlocal
chcp 65001 >nul
set "PS1=%~dp0guardian-start.ps1"
set "ROOT=%~dp0..\.."
pushd "%ROOT%" >nul

if "%~1"=="" goto start_default
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1"
if errorlevel 1 goto failed
goto done

:start_default
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 goto failed
goto done

:failed
echo.
echo Guardian combined launcher failed. Review the error above.

:done
echo.
echo Guardian TUI exited. The scheduler window may still be running.
echo Press any key to close this window.
pause >nul
popd
endlocal
