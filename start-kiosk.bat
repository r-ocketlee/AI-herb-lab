@echo off
cd /d "%~dp0"
echo Preparing... first run may install/build, please wait
if not exist "node_modules" call npm install
if not exist "dist" call npm run build
echo Starting server on port 4173...
start "herb-server" cmd /c "npm run preview -- --port 4173 --strictPort --host"
timeout /t 8 /nobreak >nul
echo Launching Chrome kiosk...
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
start "" "%CHROME%" --kiosk "http://localhost:4173/index.html" --user-data-dir="%~dp0.chrome-kiosk" --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --start-fullscreen --noerrdialogs --disable-session-crashed-bubble --disable-infobars --no-first-run --no-default-browser-check
echo.
echo Running. Quit with Alt+F4 or close this window.
