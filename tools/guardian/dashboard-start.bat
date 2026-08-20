@echo off
setlocal
chcp 65001 >nul
set "PS1=%~dp0dashboard-start.ps1"
set "ROOT=%~dp0..\.."
pushd "%ROOT%" >nul

if "%~1"=="" goto start_default
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1"
goto done

:start_default
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto done

:done
echo.
echo Guardian Dashboard exited. Press any key to close.
pause >nul
popd
endlocal
