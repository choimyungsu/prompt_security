@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto NONODE

node "scripts\launch.mjs"
goto END

:NONODE
echo.
echo  ====================================================
echo   Node.js is not installed.
echo  ====================================================
echo.
echo   Please install Node.js LTS from:
echo     https://nodejs.org
echo.
echo   Then run start.bat again.
echo.
pause
exit /b 1

:END
if errorlevel 1 pause
endlocal
