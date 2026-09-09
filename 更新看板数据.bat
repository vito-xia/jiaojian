@echo off
setlocal
chcp 65001 >nul
set "NO_PAUSE="
set "PUSHD_OK=0"
set "FAILURE_STAGE=startup"
pushd "%~dp0"
if errorlevel 1 goto directory_failure
set "PUSHD_OK=1"
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"

set "FAILURE_STAGE=standard data generation"
python -u process_data.py
if not errorlevel 1 goto data_ready
py -3 -u process_data.py
if not errorlevel 1 goto data_ready
goto failure

:data_ready
if exist "data\dashboard_bundle.js" goto long_order_ready
set "FAILURE_STAGE=standard data chunk missing"
goto failure

:long_order_ready
set "FAILURE_STAGE=long-order trend generation"
set "LONG_ORDER_BAT="
for /r "%~dp0" %%F in (update_long_order.bat) do if exist "%%~fF" if not defined LONG_ORDER_BAT set "LONG_ORDER_BAT=%%~fF"
if defined LONG_ORDER_BAT goto long_order_run
set "FAILURE_STAGE=long-order script missing"
goto failure

:long_order_run
call "%LONG_ORDER_BAT%" --no-pause
if errorlevel 1 goto failure
if exist "data\dashboard_long_order.js" goto static_build
set "FAILURE_STAGE=long-order trend chunk missing"
goto failure

:static_build
set "FAILURE_STAGE=static site build"
call npm run build
if errorlevel 1 goto failure

set "FAILURE_STAGE=Worker build"
call npm run build:worker
if errorlevel 1 goto failure

set "EXIT_CODE=0"
goto success

:directory_failure
set "FAILURE_STAGE=enter project directory"
set "PUSHD_OK=0"
goto failure

:failure
if "%PUSHD_OK%"=="1" popd
echo.
echo Data update or build failed at: %FAILURE_STAGE%.
set "EXIT_CODE=1"
goto pause_or_exit

:success
if "%PUSHD_OK%"=="1" popd
echo.
echo Data update, long-order trend sync, and static build completed. T-1 is synchronized across root, dist, and worker assets.
set "EXIT_CODE=0"

:pause_or_exit
if defined NO_PAUSE goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
