@echo off
setlocal
chcp 65001 >nul
set "NO_PAUSE="
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
set "PROJECT_ROOT=%~dp0.."
set "T1_SCRIPT=%~dp0脚本\T-1\更新T-1数据源.py"
pushd "%PROJECT_ROOT%"
if errorlevel 1 goto directory_failure

python.exe -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_python
py.exe -3 -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto run_py

echo Python 3 with openpyxl was not found.
set "EXIT_CODE=9009"
goto finish

:run_python
python.exe -X utf8 -u "%T1_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"
goto after_download

:run_py
py.exe -3 -X utf8 -u "%T1_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

:after_download
if not "%EXIT_CODE%"=="0" goto finish
echo.
echo Starting dashboard refresh...
call "%PROJECT_ROOT%\更新看板数据.bat" --no-pause
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:directory_failure
set "EXIT_CODE=1"

:finish
popd
if not "%EXIT_CODE%"=="0" goto failure
echo.
echo T-1 source download and dashboard refresh completed successfully.
goto pause_or_exit

:failure
echo.
echo T-1 source download or dashboard refresh failed. Exit code: %EXIT_CODE%

:pause_or_exit
if defined NO_PAUSE goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
