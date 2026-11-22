@echo off
cd /d "%~dp0"
echo Stopping existing SmartIsland processes...
taskkill /F /IM SmartIsland.exe /T 2>nul
taskkill /F /IM smart-island.exe /T 2>nul
timeout /t 1 /nobreak >nul

if exist "src-tauri\target\release\smart-island.exe" (
    echo Updating SmartIsland.exe with latest release build...
    copy /y "src-tauri\target\release\smart-island.exe" "SmartIsland.exe" >nul
)

echo Starting SmartIsland...
start "" "%~dp0SmartIsland.exe"
exit
