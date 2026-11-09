@echo off
rem Startet Sabir (Entwicklungsversion) ohne Konsolenfenster im Tray.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." %*
