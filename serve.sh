#!/bin/bash
# Gina 開発用の静的サーバ。
# 既に同じポートを使っているプロセスがあれば強制終了してから起動する。
set -u

PORT="${PORT:-3000}"
DIR="$(cd "$(dirname "$0")" && pwd)"

# ポートを掴んでいるプロセスを探して終了する。
free_port() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -i ":${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${PORT}/tcp" 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "sport = :${PORT}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  fi

  if [ -n "${pids//[[:space:]]/}" ]; then
    echo "ポート ${PORT} を使用中のプロセスを終了します: ${pids}"
    # まず穏便に、残っていれば強制終了。
    kill ${pids} 2>/dev/null || true
    sleep 0.5
    kill -9 ${pids} 2>/dev/null || true
    sleep 0.3
  fi
}

free_port

echo "http://localhost:${PORT}/ で起動します (Ctrl+C で停止)"
exec python3 -m http.server "${PORT}" --directory "${DIR}"
