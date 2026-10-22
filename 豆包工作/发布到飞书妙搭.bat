@echo off
chcp 65001 >nul
cd /d "D:\download\trae_projects\交件监控"

echo ========================================
echo   交件监控中心 - 发布到飞书妙搭
echo ========================================
echo.

echo [1/3] 重新构建静态站点...
call npm run build
if errorlevel 1 (
    echo.
    echo [失败] 构建出错，请检查上方日志
    pause
    exit /b 1
)
echo [完成] 构建成功
echo.

echo [2/3] 发布到飞书妙搭...
lark-cli apps +deploy --app-id app_17ghhftvq0h --dir ./dist
if errorlevel 1 (
    echo.
    echo [失败] 发布出错，请检查上方日志
    pause
    exit /b 1
)
echo.

echo [3/3] 完成
echo 看板已发布，等 1-2 分钟生效
echo 访问地址: https://yundasys.doubao.link/app/app_17ghhftvq0h
echo.
pause
