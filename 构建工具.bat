@echo off
chcp 65001 >nul
title 智律小管家 - 桌面应用构建工具
echo ========================================
echo      智律小管家 - 桌面应用构建工具
echo ========================================
echo.

:menu
echo 请选择操作：
echo   1. 安装依赖（首次运行必需）
echo   2. 本地预览应用
echo   3. 构建 Windows 安装包
echo   4. 构建 Windows 便携版
echo   5. 打开下载中心页面
echo   6. 查看项目目录
echo   0. 退出
echo.
set /p choice=请输入选项编号: 

if "%choice%"=="1" goto install
if "%choice%"=="2" goto start
if "%choice%"=="3" goto buildwin
if "%choice%"=="4" goto buildportable
if "%choice%"=="5" goto download
if "%choice%"=="6" goto list
if "%choice%"=="0" goto end
echo 无效选项，请重新输入！
echo.
goto menu

:install
echo.
echo 正在安装依赖，请耐心等待（首次安装需要下载约 200MB 文件）...
call npm install
echo.
echo 依赖安装完成！
pause
goto menu

:start
echo.
echo 正在启动应用...
call npm start
pause
goto menu

:buildwin
echo.
echo 正在构建 Windows 安装包...
call npm run build-win
echo.
echo 构建完成！安装包位于 dist\ 目录
pause
goto menu

:buildportable
echo.
echo 正在构建 Windows 便携版...
call npm run build-portable
echo.
echo 构建完成！便携版位于 dist\ 目录
pause
goto menu

:download
echo.
echo 正在打开下载中心页面...
start "" "download.html"
pause
goto menu

:list
echo.
echo 项目文件列表：
dir /b
pause
goto menu

:end
echo.
echo 感谢使用，再见！
timeout /t 2 >nul
