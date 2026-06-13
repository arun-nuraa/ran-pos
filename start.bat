@echo off
title Naidu Hotel POS Server
echo =========================================
echo    Naidu Hotel POS - Database Server
echo =========================================
echo.

:: Check if Node.js is installed
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Node.js is missing! It is required for the database.
    echo Installing Node.js automatically...
    echo [Please click "Yes" if Windows asks for Admin permissions]
    winget install OpenJS.NodeJS -e --accept-source-agreements --accept-package-agreements
    
    echo.
    echo ====================================================
    echo Node.js installed successfully! 
    echo IMPORTANT: Please CLOSE this black window and 
    echo double-click start.bat again to finish starting up.
    echo ====================================================
    pause
    exit
)

echo Checking for database requirements...
call npm install --silent
echo.
echo Freeing port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Killing process with PID %%a on port 3000...
    taskkill /f /pid %%a >nul 2>&1
)
echo.
echo Starting Server...
echo The POS will open in your default browser.
echo Do NOT close this black window while using the POS!
echo.
start http://localhost:3000
node server.js
pause
