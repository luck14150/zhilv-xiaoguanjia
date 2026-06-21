@echo off
chcp 65001 >nul
title 智律小管家 - 启动器
cd /d "%~dp0"
cd dist\win-unpacked
start "" "智律小管家.exe"
