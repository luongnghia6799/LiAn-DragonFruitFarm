@echo off
title Deploy Vuon Thanh Long 3D len GitHub Pages
cd /d "%~dp0"

echo ========================================================
echo   🌵 DANG CAP NHAT VA DAY CODE LEN GITHUB 🌵
echo ========================================================
echo.
echo Repository: https://github.com/luongnghia6799/LiAn-DragonFruitFarm.git
echo.

git add .
git commit -m "update: deploy game updates" 2>nul

echo Dang day toan bo source code len GitHub (branch main)...
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   THANH CONG! DA DAY TOAN BO GAME LEN GITHUB!
    echo ========================================================
    echo.
    echo Link choi game:
    echo 👉 https://luongnghia6799.github.io/LiAn-DragonFruitFarm/
    echo.
) else (
    echo.
    echo [THONG BAO] Co loi khi push code.
    echo.
)

pause
