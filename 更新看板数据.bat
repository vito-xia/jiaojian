@echo off
setlocal
chcp 65001 >nul
set "NO_PAUSE="
set "NO_BUILD="
set "PUSHD_OK=0"
set "FAILURE_STAGE=startup"
pushd "%~dp0"
if errorlevel 1 goto directory_failure
set "PUSHD_OK=1"
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "NO_PAUSE=1"
for %%A in (%*) do if /I "%%~A"=="--no-build" set "NO_BUILD=1"

set "FAILURE_STAGE=Python environment"
python.exe -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto python_ready
py.exe -3 -X utf8 -c "import openpyxl" >nul 2>nul
if not errorlevel 1 goto py_ready
goto failure

:python_ready
set "PYTHON_RUN=python.exe"
goto sources_update

:py_ready
set "PYTHON_RUN=py.exe -3"

:sources_update
set "FAILURE_STAGE=platform control and score source update"
%PYTHON_RUN% -X utf8 -u "数据源\脚本\平台管控积分\update_platform_sources.py"
if errorlevel 1 goto failure

set "FAILURE_STAGE=standard data generation"
%PYTHON_RUN% -X utf8 -u process_data.py
if errorlevel 1 goto failure

:data_ready
if exist "data\dashboard_bundle.js" goto long_order_ready
set "FAILURE_STAGE=standard data chunk missing"
goto failure

:long_order_ready
if exist "data\抖音高停滞积分网点.xlsx" goto excel_ready
set "FAILURE_STAGE=high-score Excel missing"
goto failure

:excel_ready
set "FAILURE_STAGE=long-order trend generation"
set "LONG_ORDER_BAT=%~dp0数据源\脚本\超长单\update_long_order.bat"
if exist "%LONG_ORDER_BAT%" goto long_order_run
set "FAILURE_STAGE=long-order script missing"
goto failure

:long_order_run
call "%LONG_ORDER_BAT%" --no-pause
if errorlevel 1 goto failure
if exist "data\dashboard_long_order.js" goto build_or_finish
set "FAILURE_STAGE=long-order trend chunk missing"
goto failure

:build_or_finish
if defined NO_BUILD goto local_success

:static_build
set "FAILURE_STAGE=static site build"
call npm run build
if errorlevel 1 goto failure

set "FAILURE_STAGE=Worker build"
call npm run build:worker
if errorlevel 1 goto failure

set "EXIT_CODE=0"
goto success

:local_success
if "%PUSHD_OK%"=="1" popd
echo.
echo Local sources and dashboard data refreshed successfully. Static builds skipped.
set "EXIT_CODE=0"
goto pause_or_exit

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
echo Platform sources, dashboard data, high-score Excel, long-order trend, and static builds completed. T-1 is synchronized across root, dist, and worker assets.
set "EXIT_CODE=0"

:pause_or_exit
if defined NO_PAUSE goto exit_script
pause

:exit_script
endlocal & exit /b %EXIT_CODE%
