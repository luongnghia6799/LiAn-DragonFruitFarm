@echo off
title Deploy Vuon Thanh Long 3D len GitHub Pages
cd /d "%~dp0"

echo ========================================================
echo   🌵 DANG KET NOI VA DAY CODE LEN GITHUB 🌵
echo ========================================================
echo.
echo Tai khoan GitHub: luongnghia6799
echo Repository: https://github.com/luongnghia6799/vuon-thanh-long-3d.git
echo.

git remote remove origin 2>nul
git remote add origin https://github.com/luongnghia6799/vuon-thanh-long-3d.git

echo Dang day toan bo source code len GitHub (branch main)...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   THANH CONG! DA DAY TOAN BO GAME LEN GITHUB!
    echo ========================================================
    echo.
    echo Dang mo trang cai dat GitHub Pages...
    start "" "https://github.com/luongnghia6799/vuon-thanh-long-3d/settings/pages"
    echo.
    echo Ban chi can:
    echo 1. O muc "Branch", chon "main" va bam "Save".
    echo 2. Doi khoang 1 phut, game se online tai:
    echo    https://luongnghia6799.github.io/vuon-thanh-long-3d/
    echo.
) else (
    echo.
    echo [THONG BAO] Neu bao loi "Repository not found", hay vao:
    echo https://github.com/new
    echo Tao mot repo moi voi ten la: vuon-thanh-long-3d (chon Public),
    echo sau do chay lai file nay nhe!
    echo.
)

pause
