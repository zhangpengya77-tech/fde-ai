#!/usr/bin/env bash
# =============================================================================
# FDE-AI V2.0 正式站一鍵啟動（2026-11-04）
#
# 用途：電腦重開機後，雙擊桌面「啟動FDE-AI正式站.bat」就能把正式站全部帶起來。
# 做的事（已在執行的服務會略過，不會重複啟動）：
#   1. 公開通道（Cloudflare 臨時通道）：舊網址還能用就沿用；不能用才開新通道並取得新網址
#   2. 網址變了：自動寫進正式站允許清單（stack.env）與 public_host.txt
#   3. 依序啟動：知識庫 8772、飛行健康 8040、Django 8140、Live 8141、閘道 8143、入口 8142、HTTPS 8543
#   4. GitHub 頁面上的後台網址與目前不同時，詢問是否發佈（需要你按 Y 才會推送）
#   5. 最後逐項檢查並列出結果
# 注意：這個視窗要保持開著；關閉視窗會停止由它啟動的服務。
# 金鑰、密碼不會顯示在畫面或日誌中。
# =============================================================================
set -u

RUNTIME="D:/FDE-AI-Runtime/v2-integration"
REPO="D:/FDE-AI-UAS-v2.0-integration"
PAGES_REPO="D:/FDE-AI"                       # GitHub 頁面所在的 git 倉庫
PAGES_BRANCH="codex/github-pages-public"     # 推送這個分支會自動部署 GitHub 頁面
PAGES_URL="https://zhangpengya77-tech.github.io/fde-ai/v2/assets/config.js"
VENV_PY="D:/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe"   # Django／Live 用的 Python
SYS_PY="C:/Users/admin/AppData/Local/Python/pythoncore-3.14-64/python.exe" # 知識庫用的 Python
FH_DIR="D:/FDE-Flight-Health-AI"
CLOUDFLARED="/c/Program Files (x86)/cloudflared/cloudflared"
RAG_ROOT="D:/FDE-AI/rag"
LOG="$RUNTIME/logs"
mkdir -p "$LOG"

say() { printf '%s\n' "$*"; }

# 埠是否已在監聽（用 bash 內建 /dev/tcp，不送任何資料）
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

# 等埠開啟，最多等 $2 秒
wait_port() {
  local port=$1 limit=${2:-60} i
  for ((i = 0; i < limit; i++)); do port_open "$port" && return 0; sleep 1; done
  return 1
}

# 依命令列關鍵字停止 Windows 程序（網址改變時，要讓服務重新讀取允許清單）
stop_matching() {
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { \$_.CommandLine -match '$1' } | ForEach-Object { try { Stop-Process -Id \$_.ProcessId -Confirm:\$false -ErrorAction Stop } catch {} }" >/dev/null 2>&1
}

# 公開網址是否還連得到：000＝連不上，530＝通道已失效；其他（含 502 後台未開）代表通道本身還在
tunnel_alive() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$1/" || true)
  [[ "$code" != "000" && "$code" != "530" ]]
}

say "=== FDE-AI 正式站一鍵啟動 $(date '+%Y-%m-%d %H:%M') ==="

# ---------------------------------------------------------------- 1. 公開通道
OLD_HOST=$(tr -d '[:space:]' < "$RUNTIME/public_host.txt" 2>/dev/null || true)
HOST="$OLD_HOST"
if [[ -n "$OLD_HOST" ]] && tunnel_alive "$OLD_HOST"; then
  say "[通道] 沿用目前網址：https://$OLD_HOST"
else
  say "[通道] 舊網址已失效，開新通道…"
  TUNNEL_LOG="$LOG/tunnel_$(date +%Y%m%d_%H%M%S).log"
  "$CLOUDFLARED" tunnel --no-autoupdate --url http://127.0.0.1:8142 > "$TUNNEL_LOG" 2>&1 &
  HOST=""
  for ((i = 0; i < 60; i++)); do
    HOST=$(grep -oE '[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
    [[ -n "$HOST" ]] && break
    sleep 1
  done
  if [[ -z "$HOST" ]]; then
    say "[通道] 失敗：60 秒內沒有取得網址，請看 $TUNNEL_LOG。正式站仍會在本機啟動。"
    HOST="$OLD_HOST"
  else
    say "[通道] 新網址：https://$HOST"
  fi
fi

# ---------------------------------------------------------------- 2. 網址變了就更新允許清單
HOST_CHANGED=0
if [[ -n "$HOST" && "$HOST" != "$OLD_HOST" ]]; then
  HOST_CHANGED=1
  cp -p "$RUNTIME/stack.env" "$RUNTIME/stack.env.before-$(date +%Y%m%d_%H%M%S)"   # 先備份
  sed -i -E "s/[a-z0-9-]+\.trycloudflare\.com/$HOST/g" "$RUNTIME/stack.env"
  printf '%s\n' "$HOST" > "$RUNTIME/public_host.txt"
  say "[設定] 已把新網址寫入允許清單（舊設定已備份）"
  # 已在執行的對外服務要重啟，才會認得新網址
  for pattern in 'runserver 127\.0\.0\.1:8140' 'gateway_main:app --host 127\.0\.0\.1 --port 8143' 'static_entry_server\.py' 'tls_entry\.py'; do
    stop_matching "$pattern"
  done
  sleep 2
fi

# 載入正式站環境（含 keys.env 的金鑰；不會印出）
# shellcheck disable=SC1091
source "$RUNTIME/stack.env"
export FDE_ENTRY_BIND=127.0.0.1

# ---------------------------------------------------------------- 3. 啟動服務（已在跑的略過）
start_service() {
  local name=$1 port=$2; shift 2
  if port_open "$port"; then
    say "[服務] $name（$port）已在執行，略過"
    return
  fi
  ( "$@" ) &
  if wait_port "$port" 90; then say "[服務] $name（$port）已啟動"; else say "[服務] $name（$port）啟動失敗，請看 $LOG"; fi
}

RAG_VERSION=$(grep -oE '"active_version"[^"]*"[^"]+"' "$RAG_ROOT/active_version.json" | grep -oE 'f450_[a-z0-9_]+' | tail -1)
start_service "知識庫 $RAG_VERSION" 8772 bash -c "cd '$RAG_ROOT/$RAG_VERSION/runtime' && exec '$SYS_PY' rag_http_server.py --host 127.0.0.1 --port 8772 --version-root '$RAG_ROOT/$RAG_VERSION' >> '$LOG/rag8772.log' 2>&1"
start_service "飛行健康" 8040 bash -c "cd '$FH_DIR' && exec .venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8040 >> '$LOG/flight-health.log' 2>&1"
start_service "Django 學員教師後台" 8140 bash -c "cd '$REPO/student_portal' && exec '$VENV_PY' manage.py runserver 127.0.0.1:8140 --noreload >> '$LOG/django.log' 2>&1"
start_service "Live AI 服務" 8141 bash -c "cd '$REPO/live_backend' && exec '$VENV_PY' -m uvicorn app.main:app --host 127.0.0.1 --port 8141 >> '$LOG/live.log' 2>&1"
start_service "身分閘道" 8143 bash -c "cd '$REPO/live_backend' && exec '$VENV_PY' -m uvicorn gateway_main:app --host 127.0.0.1 --port 8143 >> '$LOG/gateway.log' 2>&1"
start_service "入口" 8142 bash -c "cd '$REPO' && exec '$VENV_PY' demo/tools/static_entry_server.py >> '$LOG/entry.log' 2>&1"
start_service "HTTPS 入口" 8543 bash -c "cd '$REPO' && exec '$VENV_PY' ops/v2-integration/tls_entry.py >> '$LOG/tls.log' 2>&1"

# ---------------------------------------------------------------- 4. GitHub 頁面的後台網址
publish_pages() {
  local work
  work="$(mktemp -d)/pages"
  git -C "$PAGES_REPO" fetch -q origin "$PAGES_BRANCH" || return 1
  git -C "$PAGES_REPO" worktree add -q --detach "$work" "origin/$PAGES_BRANCH" || return 1
  sed -i -E "s#portalBaseUrl: \"[^\"]*\"#portalBaseUrl: \"https://$HOST\"#" "$work/public-site/v2/assets/config.js"
  if git -C "$work" diff --quiet; then
    say "[GitHub] 設定已是目前網址，不需推送"
  else
    git -C "$work" commit -qam "chore: 更新 V2.0 靜態站教學後台網址（一鍵啟動）" &&
      git -C "$work" push -q origin "HEAD:$PAGES_BRANCH" &&
      say "[GitHub] 已推送，約 1 分鐘後手機重新整理即可看到新網址"
  fi
  git -C "$PAGES_REPO" worktree remove --force "$work" >/dev/null 2>&1 || true
}

if [[ -n "$HOST" ]]; then
  ONLINE=$(curl -s --max-time 20 "$PAGES_URL?t=$(date +%s)" | grep -oE 'portalBaseUrl: "[^"]*"' | head -1)
  if [[ "$ONLINE" == "portalBaseUrl: \"https://$HOST\"" ]]; then
    say "[GitHub] 頁面上的後台網址已是目前網址"
  elif [[ -t 0 ]]; then
    say "[GitHub] 頁面上的後台網址是：${ONLINE:-（讀不到）}"
    read -r -p "        要把新網址 https://$HOST 發佈到 GitHub 頁面嗎？(Y/N) " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then publish_pages || say "[GitHub] 推送失敗，手機登入按鈕仍是舊網址"; else say "[GitHub] 未發佈：手機從 GitHub 頁面登入會連不到，請改用新網址"; fi
  else
    say "[GitHub] 網址不同，但目前不是互動視窗，略過發佈（請用桌面啟動檔執行）"
  fi
fi

# ---------------------------------------------------------------- 5. 最後檢查
say ""
say "=== 檢查結果 ==="
check() { if port_open "$2"; then say "  ✓ $1（$2）"; else say "  ✗ $1（$2）沒有回應"; fi; }
check "知識庫" 8772; check "飛行健康" 8040; check "Django" 8140; check "Live AI" 8141
check "身分閘道" 8143; check "入口" 8142; check "HTTPS 入口" 8543
LOCAL=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 https://127.0.0.1:8543/live/ || true)
say "  本機 AI 陪做頁：$LOCAL"
if [[ -n "$HOST" ]]; then
  PUBLIC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$HOST/live/" || true)
  say "  公開 AI 陪做頁：$PUBLIC"
  say ""
  say "學員網址：https://$HOST/login/"
  say "AI 陪做：https://$HOST/live/"
fi
say "GitHub 頁面：https://zhangpengya77-tech.github.io/fde-ai/v2/"
[[ "$HOST_CHANGED" == 1 ]] && say "（本次網址已更換）"
say ""
say "請保持這個視窗開著；關閉視窗會停止由它啟動的服務。"
wait
