@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

python -u process_data.py
if not errorlevel 1 goto data_ready
py -3 -u process_data.py
if errorlevel 1 goto failure

:data_ready
if not exist "data\dashboard_bundle.js" goto failure
call npm run build
if errorlevel 1 goto failure
call npm run build:worker
if errorlevel 1 goto failure

echo.
echo Data update and static build completed. T-1 is synchronized across root, dist, and worker assets.
set "EXIT_CODE=0"
goto finish

:failure
echo.
echo Data update or build failed.
set "EXIT_CODE=1"

:finish
pause
endlocal & exit /b %EXIT_CODE%
