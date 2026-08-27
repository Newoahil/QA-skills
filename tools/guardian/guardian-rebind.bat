@echo off
setlocal
chcp 65001 >nul
set "PS1=%~dp0guardian-rebind.ps1"
set "ROOT=%~dp0..\.."
pushd "%ROOT%" >nul

if "%~1"=="" goto start_default
if "%~2"=="" goto start_target
if "%~3"=="" goto start_authors
goto start_full

:start_default
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
goto done

:start_target
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1"
goto done

:start_authors
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1" -CommandAuthors "%~2"
goto done

:start_full
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -TargetRepo "%~1" -CommandAuthors "%~2" -GitHubRepo "%~3"
goto done

:done
echo.
echo Guardian rebind exited. Press any key to close.
pause >nul
popd
endlocal
