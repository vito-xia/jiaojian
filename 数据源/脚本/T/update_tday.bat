@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

python.exe -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_python
py.exe -3 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_py

echo Python 3 with openpyxl was not found.
set "EXIT_CODE=9009"
goto finish

:run_python
python.exe -X utf8 -u "%~dp0update_tday.py"
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:run_py
py.exe -3 -X utf8 -u "%~dp0update_tday.py"
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if not "%EXIT_CODE%"=="0" goto failure
echo T-day dashboard refresh finished successfully.
goto pause_or_exit

:failure
echo T-day dashboard refresh failed. Exit code: %EXIT_CODE%

:pause_or_exit
if /I "%~1"=="--no-pause" goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
