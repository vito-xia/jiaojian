@echo off
cd /d "D:\download\trae_projects\½»¼þ¼à¿Ø"

echo ========================================
echo   Publish Dashboard to Miaoda
echo ========================================
echo.

echo [1/3] Building static site...
call npm run build
if errorlevel 1 (
    echo.
    echo [FAIL] Build failed. Check logs above.
    pause
    exit /b 1
)
echo [OK] Build done.
echo.

echo [2/3] Deploying to Miaoda...
lark-cli apps +deploy --app-id app_17ghhftvq0h --dir ./dist
if errorlevel 1 (
    echo.
    echo [FAIL] Deploy failed. Check logs above.
    pause
    exit /b 1
)
echo.

echo [3/3] Done.
echo Dashboard published. Wait 1-2 minutes for it to go live.
echo URL: https://yundasys.doubao.link/app/app_17ghhftvq0h
echo.
pause