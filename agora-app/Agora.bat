@echo off
REM ============================================================
REM  Agora launcher — double-click to start the desktop app.
REM  Runs from wherever this file lives, so it works regardless
REM  of the folder you cloned into.
REM ============================================================

cd /d "%~dp0"

REM Install dependencies the first time (node_modules missing)
if not exist "node_modules\" (
    echo First run: installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Make sure Node.js is installed: https://nodejs.org
        pause
        exit /b 1
    )
)

echo Starting Agora...
call npm start

REM If it exits with an error, keep the window open so you can read it
if errorlevel 1 pause
