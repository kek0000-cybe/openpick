@echo off
title openpick - cekilis paneli
cd /d "%~dp0"

echo.
echo   openpick cekilis paneli baslatiliyor...
echo.

if not exist "node_modules" (
  echo   Ilk kurulum yapiliyor, biraz surebilir...
  call npm install
  call npx playwright install chromium
)

start "" http://localhost:8090
call npm run panel

echo.
echo   Panel kapandi. Kapatmak icin bir tusa bas.
pause > nul
