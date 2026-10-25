@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "PUBLISH_NO_PAUSE="
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "PUBLISH_NO_PAUSE=1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish.ps1" %*
set "PUBLISH_EXIT_CODE=%ERRORLEVEL%"
if not "%PUBLISH_EXIT_CODE%"=="0" echo [FAIL] Publishing failed. See the error above.
if not defined PUBLISH_NO_PAUSE pause
endlocal & exit /b %PUBLISH_EXIT_CODE%
