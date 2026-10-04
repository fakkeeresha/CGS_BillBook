@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not available on PATH.
  echo Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not available. Reinstall Node.js with npm, then run this file again.
  pause
  exit /b 1
)

call npm ls --depth=0 >nul 2>&1
if errorlevel 1 (
  echo Installing or repairing bill book dependencies...
  call npm install
  if errorlevel 1 (
    echo Could not install bill book dependencies.
    pause
    exit /b 1
  )
)

call npm ls --prefix backend_dataserve --depth=0 >nul 2>&1
if errorlevel 1 (
  echo Installing or repairing PDF extraction dependencies...
  call npm install --prefix backend_dataserve
  if errorlevel 1 (
    echo Could not install PDF extraction dependencies.
    pause
    exit /b 1
  )
)

set "APP_URL=http://localhost:3000"
powershell.exe -NoProfile -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3000/api/bills' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo Starting CGS Global Enterprises Bill Book...
  echo Keep the server window open while using the application.
  start "CGS Bill Book Server" /D "%~dp0" cmd /k "npm start"
) else (
  echo CGS Global Enterprises Bill Book is already running.
)

for /l %%i in (1,1,60) do (
  powershell.exe -NoProfile -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3000/api/bills' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto open_app
  timeout /t 1 /nobreak >nul
)

echo The bill book did not become ready within 60 seconds.
echo Check the CGS Bill Book Server window for an error.
pause
exit /b 1

:open_app
echo Opening the bill book in your browser...
start "" "%APP_URL%"
exit /b 0
