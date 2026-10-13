@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "NO_PAUSE="
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
for %%I in ("%~f0") do set "ENTRY_DIR=%%~dpI"
for %%I in ("%ENTRY_DIR%脚本\run_update.py") do set "UPDATE_RUNNER=%%~fI"
if not exist "%UPDATE_RUNNER%" goto runner_missing

python.exe -B -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_python
py.exe -3 -B -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_py
echo Python 3 with openpyxl was not found.
set "EXIT_CODE=9009"
goto finish

:run_python
python.exe -B -X utf8 -u "%UPDATE_RUNNER%" tday %*
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:run_py
py.exe -3 -B -X utf8 -u "%UPDATE_RUNNER%" tday %*
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:runner_missing
echo Update runner was not found.
set "EXIT_CODE=2"

:finish
if not "%EXIT_CODE%"=="0" goto failure
echo T-day download, refresh, and output validation completed successfully.
goto pause_or_exit

:failure
echo T-day workflow failed or was not executed. Exit code: %EXIT_CODE%. See the update log for details.

:pause_or_exit
if defined NO_PAUSE goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
