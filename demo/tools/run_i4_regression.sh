#!/usr/bin/env bash
# ===========================================================================
#  I1／I2／I3 HTTP 層回歸驅動器（I4 第七節）
#  沿用前輪驗收位址（192.168.1.114:8112 / :8116）與獨立測試庫，條件與前輪一致。
#
#  用法：bash run_i4_regression.sh
#  與正式 8022／8770 完全隔離。
# ===========================================================================
set -uo pipefail

ROOT="D:/FDE-AI-UAS-v2.0"
TOOLS="$ROOT/demo/tools"
LOGS="$ROOT/demo/runtime/logs"
PY="$ROOT/.test-temp/django-venv/Scripts/python.exe"
SENTINEL_LOG="$LOGS/i4_regression_sentinel.log"

export I4_DB="$ROOT/demo/runtime/db/i4_e2e.sqlite3"
export I3_DB="$I4_DB"
export I4_SENTINEL_LOG="$SENTINEL_LOG"
export PYTHONUTF8=1
export PYTHONNOUSERSITE=1
export NO_PROXY='*'
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true

mkdir -p "$LOGS"
: > "$SENTINEL_LOG"

"$PY" "$TOOLS/i4_sentinel.py" 8198 "$SENTINEL_LOG" &
SENTINEL_PID=$!
sleep 2

FAILED=0

wait_health() {
  local url="$1"
  for _ in $(seq 1 40); do
    if "$PY" -c "
import sys, urllib.request
try:
    urllib.request.build_opener(urllib.request.ProxyHandler({})).open(sys.argv[1], timeout=3)
except Exception:
    raise SystemExit(1)
" "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# with_django <label> <bind> <port> <health-url> <extra env...> -- <command...>
run_block() {
  local label="$1"; shift
  local bind="$1"; shift
  local port="$1"; shift
  local health="$1"; shift
  local envs=()
  while [ "$1" != "--" ]; do envs+=("$1"); shift; done
  shift

  echo ""
  echo "############################################################"
  echo "# $label"
  echo "############################################################"

  I4_BIND_ADDR="$bind" I4_DJANGO_PORT="$port" env ${envs[@]+"${envs[@]}"} \
    bash "$TOOLS/i4_isolated.sh" django >"$LOGS/i4_reg_$label.log" 2>&1 &
  local pid=$!

  if ! wait_health "$health"; then
    echo "!! Django 未能在時限內啟動（$label）"
    tail -12 "$LOGS/i4_reg_$label.log" 2>/dev/null
    kill -9 "$pid" 2>/dev/null
    FAILED=1
    return
  fi

  "$@"
  local rc=$?
  [ $rc -ne 0 ] && FAILED=1

  kill "$pid" 2>/dev/null
  sleep 1
  kill -9 "$pid" 2>/dev/null
  sleep 2
}

# --- 1. 預設配置（I1 + I2 default）---------------------------------------
run_block i1_i2_default 192.168.1.114 8112 "http://192.168.1.114:8112/login/" \
  I4_LIVE_PORT=8112 -- \
  bash -c "'$PY' '$TOOLS/verify_i1_external_modules.py'; '$PY' '$TOOLS/verify_i2_framework.py' default"

# --- 2. module-up（F450 啟用 + 可達 + 白名單 + 私網精確放行）------------
run_block i2_module_up 192.168.1.114 8112 "http://192.168.1.114:8112/login/" \
  I4_LIVE_PORT=8112 \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 \
  FDE_MODULE_F450_DIGITAL_TWIN_URL=http://127.0.0.1:8198/f450-twin \
  FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=127.0.0.1 \
  FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1 -- \
  bash -c "I2_MODULE_URL=http://127.0.0.1:8198/f450-twin '$PY' '$TOOLS/verify_i2_framework.py' module-up"

# --- 3. module-down（F450 啟用 + 不可達 + 白名單 + 私網精確放行）---------
run_block i2_module_down 192.168.1.114 8112 "http://192.168.1.114:8112/login/" \
  I4_LIVE_PORT=8112 \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 \
  FDE_MODULE_F450_DIGITAL_TWIN_URL=http://127.0.0.1:8197/f450-twin \
  FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=127.0.0.1 \
  FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1 -- \
  bash -c "I2_MODULE_URL=http://127.0.0.1:8197/f450-twin '$PY' '$TOOLS/verify_i2_framework.py' module-down"

# --- 4. I3 default -------------------------------------------------------
run_block i3_default 192.168.1.114 8116 "http://192.168.1.114:8116/login/" \
  I4_LIVE_PORT=8116 -- \
  bash -c "I3_MODULE_BASE=http://192.168.1.114:8116 '$PY' '$TOOLS/verify_i3_modules.py' default"

# --- 5. I3 unsafe（含敏感參數 URL；安全拒絕 → 服務暫時不可用）-------------
run_block i3_unsafe 192.168.1.114 8116 "http://192.168.1.114:8116/login/" \
  I4_LIVE_PORT=8116 \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 \
  FDE_MODULE_F450_DIGITAL_TWIN_URL="http://127.0.0.1:8198/f450?token=abc123" \
  FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=127.0.0.1 -- \
  bash -c "I3_MODULE_BASE=http://192.168.1.114:8116 '$PY' '$TOOLS/verify_i3_modules.py' unsafe"

# --- 6. I3 module-up -----------------------------------------------------
run_block i3_module_up 192.168.1.114 8116 "http://192.168.1.114:8116/login/" \
  I4_LIVE_PORT=8116 \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 \
  FDE_MODULE_F450_DIGITAL_TWIN_URL=http://127.0.0.1:8198/f450-twin \
  FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=127.0.0.1 \
  FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1 -- \
  bash -c "I3_MODULE_BASE=http://192.168.1.114:8116 I3_MODULE_URL=http://127.0.0.1:8198/f450-twin '$PY' '$TOOLS/verify_i3_modules.py' module-up"

# --- 7. I3 module-down ---------------------------------------------------
run_block i3_module_down 192.168.1.114 8116 "http://192.168.1.114:8116/login/" \
  I4_LIVE_PORT=8116 \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 \
  FDE_MODULE_F450_DIGITAL_TWIN_URL=http://127.0.0.1:8197/f450-twin \
  FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=127.0.0.1 \
  FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1 -- \
  bash -c "I3_MODULE_BASE=http://192.168.1.114:8116 I3_MODULE_URL=http://127.0.0.1:8197/f450-twin '$PY' '$TOOLS/verify_i3_modules.py' module-down"

kill "$SENTINEL_PID" 2>/dev/null
wait "$SENTINEL_PID" 2>/dev/null

echo ""
echo "############################################################"
[ $FAILED -ne 0 ] && echo "I1/I2/I3 回歸結果: FAIL" || echo "I1/I2/I3 回歸結果: PASS"
echo "############################################################"
exit $FAILED
