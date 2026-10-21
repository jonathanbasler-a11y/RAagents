@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "EXITCODE=1"
if not exist "runtime\win32-x64\node.exe" goto missing
if not exist "launcher\bundle\launcher.mjs" goto missing
echo Starting the live demo (real AI answers, your own settings)...
"runtime\win32-x64\node.exe" "launcher\bundle\launcher.mjs" live
set "EXITCODE=%ERRORLEVEL%"
goto finish
:missing
echo Part of the demo is missing. Unzip the whole ZIP again and open this file from the unzipped folder.
:finish
echo.
if not "%EXITCODE%"=="0" echo The live demo did not start. Read the message above.
echo.
pause
exit /b %EXITCODE%
