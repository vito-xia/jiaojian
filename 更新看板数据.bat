@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
python -u process_data.py
if not errorlevel 1 goto success
py -3 -u process_data.py
if errorlevel 1 goto failure
:success
if exist "data\dashboard_bundle.js" goto done
echo.
echo 数据文件未生成，更新中止。
set "EXIT_CODE=1"
goto finish
:failure
echo.
echo 更新失败，请先执行：python -m pip install -r requirements.txt
set "EXIT_CODE=1"
goto finish
:done
echo.
echo 数据更新完成，可以打开 dashboard.html。
set "EXIT_CODE=0"
:finish
pause
endlocal & exit /b %EXIT_CODE%
