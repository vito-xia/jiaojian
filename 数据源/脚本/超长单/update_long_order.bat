@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 goto directory_failure
set "NO_PAUSE="
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"

python.exe -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_python
py.exe -3 -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_py

echo Python 3 with openpyxl was not found.
set "EXIT_CODE=9009"
goto finish

:run_python
python.exe -X utf8 -u "%~dp0update_long_order.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:run_py
py.exe -3 -X utf8 -u "%~dp0update_long_order.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:directory_failure
echo Cannot enter the script directory.
set "EXIT_CODE=1"

:finish
popd
if not "%EXIT_CODE%"=="0" goto failure
echo Long-order trend refresh completed successfully.
goto pause_or_exit

:failure
echo Long-order trend refresh failed. Exit code: %EXIT_CODE%

:pause_or_exit
if defined NO_PAUSE goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
