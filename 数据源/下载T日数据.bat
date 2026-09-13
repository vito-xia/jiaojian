@echo off
setlocal
chcp 65001 >nul
set "NO_PAUSE="
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
call "%~dp0脚本\T\download_tday.bat" --no-pause
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" goto failure
echo T-day source download finished successfully.
goto pause_or_exit

:failure
echo T-day source download failed. Exit code: %EXIT_CODE%

:pause_or_exit
if defined NO_PAUSE goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
