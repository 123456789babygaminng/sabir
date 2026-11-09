#!/bin/sh
# dev helper: restart Sabir
PID=$(curl -s http://127.0.0.1:47821/health | sed -n 's/.*"pid":\([0-9]*\).*/\1/p')
[ -n "$PID" ] && taskkill //PID $PID //T //F >/dev/null 2>&1
sleep 1
cd "$(dirname "$0")" && (node_modules/electron/dist/electron.exe . "$@" > /dev/null 2>&1 &)
