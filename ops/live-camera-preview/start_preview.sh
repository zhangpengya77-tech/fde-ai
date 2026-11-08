#!/usr/bin/env bash
# =============================================================================
# 即時鏡頭檢測：獨立預覽環境啟動（2026-11-08）
#
# 不覆蓋線上版：埠號 Django 8440、Live 8441、入口 8442、閘道 8443、HTTPS 8843；
# 程式來自 feature/live-camera 工作樹；資料是正式資料庫的快照（setup_preview.py 建立）。
# 知識庫 8772 與飛行健康 8040 共用正式站的服務（只讀）。
# 做的事：
#   1. 開一條新的 Cloudflare 臨時通道（指向預覽入口 8442），取得 https 網址
#   2. 把網址寫進預覽環境允許清單（先備份）
#   3. 依序啟動預覽服務（已在執行的略過）
#   4. 列出檢查結果與網址
# 注意：這個視窗要保持開著；關閉視窗（或 Ctrl+C）就會停止預覽環境與通道。
# 金鑰不會顯示在畫面或日誌中。
# =============================================================================
set -u

RUNTIME="D:/FDE-AI-Runtime/v2-live-camera"
REPO="D:/FDE-AI-UAS-v2.0-live-camera"
VENV_PY="D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe"
CLOUDFLARED="/c/Program Files (x86)/cloudflared/cloudflared"
LOG="$RUNTIME/logs"
mkdir -p "$LOG"

say() { printf '%s\n' "$*"; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }
wait_port() {
  local port=$1 limit=${2:-60} i
  for ((i = 0; i < limit; i++)); do port_open "$port" && return 0; sleep 1; done
  return 1
}

say "=== 即時鏡頭檢測預覽環境 $(date '+%Y-%m-%d %H:%M') ==="
BUSY=0
for p in 8440 8441 8442 8443 8843; do
  if port_open "$p"; then say "[停止] 埠 $p 已被占用（可能是上一次的預覽環境沒關乾淨），請先關閉後再啟動。"; BUSY=1; fi
done
# 舊程序的允許清單沒有新網址，沿用會造成 400，所以不沿用、直接停止
[[ "$BUSY" == 1 ]] && exit 1

# ---------------------------------------------------------------- 1. 臨時通道
TUNNEL_LOG="$LOG/tunnel_$(date +%Y%m%d_%H%M%S).log"
"$CLOUDFLARED" tunnel --no-autoupdate --url http://127.0.0.1:8442 > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
HOST=""
for ((i = 0; i < 60; i++)); do
  HOST=$(grep -oE '[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
  [[ -n "$HOST" ]] && break
  sleep 1
done
if [[ -z "$HOST" ]]; then
  say "[通道] 60 秒內沒有取得網址（請看 $TUNNEL_LOG）；預覽環境仍會在本機 https://127.0.0.1:8843 啟動。"
else
  say "[通道] 預覽網址：https://$HOST"
  # ---------------------------------------------------------------- 2. 寫入允許清單
  cp -p "$RUNTIME/stack.env" "$RUNTIME/stack.env.before-$(date +%Y%m%d_%H%M%S)"
  sed -i -E "s/,?(https:\/\/)?[a-z0-9-]+\.trycloudflare\.com//g" "$RUNTIME/stack.env"
  sed -i -E "s#^(export DJANGO_ALLOWED_HOSTS=\"[^\"]*)\"#\1,$HOST\"#; s#^(export DJANGO_CSRF_TRUSTED_ORIGINS=\"[^\"]*)\"#\1,https://$HOST\"#; s#^(export FDE_ENTRY_TRUSTED_ORIGINS=\"[^\"]*)\"#\1,https://$HOST\"#; s#^(export FDE_ENTRY_ALLOWED_HOSTS=\"[^\"]*)\"#\1,$HOST\"#" "$RUNTIME/stack.env"
  printf '%s\n' "$HOST" > "$RUNTIME/public_host.txt"
fi

# shellcheck disable=SC1091
source "$RUNTIME/stack.env"
export FDE_ENTRY_BIND=127.0.0.1

# ---------------------------------------------------------------- 3. 啟動服務
# 預覽環境的靜態檔（DEBUG=false 時 Django 需要 manifest，否則登入頁 500）；只寫入預覽環境的 static 目錄
( cd "$REPO/student_portal" && "$VENV_PY" manage.py collectstatic --noinput >> "$LOG/collectstatic.log" 2>&1 ) \
  && say "[靜態檔] 已整理到 $RUNTIME/static" || say "[靜態檔] 整理失敗，請看 $LOG/collectstatic.log"
PIDS=()
start_service() {
  local name=$1 port=$2; shift 2
  if port_open "$port"; then say "[服務] $name（$port）已在執行，略過"; return; fi
  ( "$@" ) &
  PIDS+=($!)
  if wait_port "$port" 90; then say "[服務] $name（$port）已啟動"; else say "[服務] $name（$port）啟動失敗，請看 $LOG"; fi
}
start_service "Django（預覽）" 8440 bash -c "cd '$REPO/student_portal' && exec '$VENV_PY' manage.py runserver 127.0.0.1:8440 --noreload >> '$LOG/django.log' 2>&1"
start_service "Live AI（預覽）" 8441 bash -c "cd '$REPO/live_backend' && exec '$VENV_PY' -m uvicorn app.main:app --host 127.0.0.1 --port 8441 >> '$LOG/live.log' 2>&1"
start_service "身分閘道（預覽）" 8443 bash -c "cd '$REPO/live_backend' && exec '$VENV_PY' -m uvicorn gateway_main:app --host 127.0.0.1 --port 8443 >> '$LOG/gateway.log' 2>&1"
start_service "入口（預覽）" 8442 bash -c "cd '$REPO' && exec '$VENV_PY' '$REPO/demo/tools/static_entry_server.py' >> '$LOG/entry.log' 2>&1"
start_service "HTTPS 入口（預覽）" 8843 bash -c "cd '$REPO' && exec '$VENV_PY' '$REPO/ops/v2-integration/tls_entry.py' >> '$LOG/tls.log' 2>&1"

# ---------------------------------------------------------------- 4. 檢查
say ""
say "=== 檢查結果 ==="
for item in "Django:8440" "Live AI:8441" "入口:8442" "身分閘道:8443" "HTTPS 入口:8843"; do
  name=${item%%:*}; port=${item##*:}
  if port_open "$port"; then say "  ✓ $name（$port）"; else say "  ✗ $name（$port）沒有回應"; fi
done
say "  本機：https://127.0.0.1:8843/eagle（自簽憑證，瀏覽器會提示不安全）"
if [[ -n "$HOST" ]]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$HOST/eagle" || true)
  say "  公開預覽：https://$HOST/eagle （回應 $CODE）"
  say "  登入：https://$HOST/login/"
fi
say ""
say "請保持這個視窗開著；按 Ctrl+C 或關閉視窗會停止預覽環境與通道。"
# 結束時停止整棵程序樹（venv 的 python 會再開一個子程序，只停父程序會留下殘留占住埠號）
cleanup() {
  for pid in "${PIDS[@]}" "$TUNNEL_PID"; do
    winpid=$(cat "/proc/$pid/winpid" 2>/dev/null || true)
    [[ -n "$winpid" ]] && taskkill //T //F //PID "$winpid" >/dev/null 2>&1
    kill "$pid" 2>/dev/null
  done
  say "預覽環境已停止。"
}
trap cleanup EXIT INT TERM
wait
