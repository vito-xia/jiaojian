@echo off
chcp 65001 >nul
cd /d "%~dp0"
python process_data.py
if errorlevel 1 py -3 process_data.py
if errorlevel 1 (
  echo.
  echo 更新失败，请先执行：python -m pip install -r requirements.txt
  pause
  exit /b 1
)
echo.
echo 数据更新完成，可以打开 dashboard.html。
pause