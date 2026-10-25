@echo off
TITLE Astro Finance Intelligence Interface

echo ========================================================
echo   ASTRO FINANCIAL INTELLIGENCE - LAUNCHING SYSTEM
echo ========================================================

echo.
echo [1/2] Igniting Nerve Center (API)...
start "Astro Finance API" cmd /k "python src\astro_finance\api\main.py"

echo.
echo [2/2] Launching Living Interface...
cd web
start "Living Interface" cmd /k "npm start"
cd ..

echo.
echo System Online.
echo API: http://localhost:8000
echo GUI: http://localhost:3000
echo.
echo Press any key to exit this launcher (Servers will remain running)...
pause
