@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "EXITCODE=1"
if not exist "runtime\win32-x64\node.exe" goto missing
if not exist "launcher\bundle\launcher.mjs" goto missing
echo Starting the practice demo (stand-in replies, no key needed)...
"runtime\win32-x64\node.exe" "launcher\bundle\launcher.mjs" practice
set "EXITCODE=%ERRORLEVEL%"
goto finish
:missing
echo Part of the demo is missing. Unzip the whole ZIP again and open this file from the unzipped folder.
:finish
echo.
if not "%EXITCODE%"=="0" echo The practice demo did not start. Read the message above.
echo.
pause
exit /b %EXITCODE%
