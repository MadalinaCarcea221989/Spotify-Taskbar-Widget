@echo off
taskkill /F /IM "Spotify Taskbar Widget.exe" /T >nul 2>&1
start "" "%~dp0tauri-widget\src-tauri\target\release\Spotify Taskbar Widget.exe"
exit
