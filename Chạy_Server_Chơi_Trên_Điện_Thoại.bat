@echo off
title Vuon Thanh Long 3D - May Chu Di Dong
cd /d "%~dp0"

echo Dang khoi dong may chu Vuon Thanh Long 3D...
node server.js
if errorlevel 1 (
    echo.
    echo [LOI] Khong the chay server voi Node.js.
    pause
)
