#!/usr/bin/env bash
# ===========================================================================
#  I4-C 接口安全複查驅動器
#  對每個模式：啟動探測哨兵 → 以指定模組設定啟動隔離 Django → 執行驗收 → 收工
#
#  用法：bash run_i4_matrix.sh
#  與正式 8022／8770 完全隔離（僅使用 8120 與 8198）。
# ===========================================================================
set -uo pipefail

ROOT="D:/FDE-AI-UAS-v2.0"
TOOLS="$ROOT/demo/tools"
LOGS="$ROOT/demo/runtime/logs"
DB="$ROOT/demo/runtime/db/i4_e2e.sqlite3"
PY="$ROOT/.test-temp/django-venv/Scripts/python.exe"
SENTINEL_LOG="$LOGS/i4_sentinel.log"

export DJANGO_DB_NAME="$DB"
export I4_DB="$DB"
export I4_SENTINEL_LOG="$SENTINEL_LOG"
export I4_SEC_BASE="http://127.0.0.1:8120"
export PYTHONUTF8=1
export PYTHONNOUSERSITE=1
export NO_PROXY='*'
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true

mkdir -p "$LOGS"
: > "$SENTINEL_LOG"

"$PY" "$TOOLS/i4_sentinel.py" 8198 "$SENTINEL_LOG" &
SENTINEL_PID=$!
sleep 2

wait_health() {
  for _ in $(seq 1 40); do
    if "$PY" -c "
import urllib.request
try:
    urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8120/login/', timeout=3)
except Exception:
    raise SystemExit(1)
" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

FAILED=0

run_mode() {
  local mode="$1"; shift
  : > "$SENTINEL_LOG"
  echo ""
  echo "############################################################"
  echo "# 模式：$mode"
  echo "############################################################"

  env "$@" bash "$TOOLS/i4_isolated.sh" django >"$LOGS/i4_$mode.out.log" 2>&1 &
  local django_pid=$!

  if ! wait_health; then
    echo "!! Django 未能在時限內啟動（模式 $mode）"
    kill -9 "$django_pid" 2>/dev/null
    FAILED=1
    return
  fi

  "$PY" "$TOOLS/verify_i4_security.py" --mode "$mode"
  local rc=$?
  [ $rc -ne 0 ] && FAILED=1

  kill "$django_pid" 2>/dev/null
  sleep 1
  kill -9 "$django_pid" 2>/dev/null
  sleep 2
}

run_mode deny \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 FDE_MODULE_F450_DIGITAL_TWIN_URL=http://127.0.0.1:8198/f450-twin \
  FDE_MODULE_MP_GROUND_STATION_ENABLED=1 FDE_MODULE_MP_GROUND_STATION_URL=http://10.9.9.9:9000/mp \
  FDE_MODULE_HQGC_ASSESSMENT_ENABLED=1 FDE_MODULE_HQGC_ASSESSMENT_URL=http://169.254.169.254/latest/meta-data/

run_mode allow \
  FDE_MODULE_F450_DIGITAL_TWIN_ENABLED=1 FDE_MODULE_F450_DIGITAL_TWIN_URL=http://10.9.9.9:9000/twin \
  FDE_MODULE_MP_GROUND_STATION_ENABLED=1 FDE_MODULE_MP_GROUND_STATION_URL=http://127.0.0.1:8198/mp \
  FDE_MODULE_HQGC_ASSESSMENT_ENABLED=1 FDE_MODULE_HQGC_ASSESSMENT_URL=http://169.254.169.254/latest/meta-data/ \
  FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=127.0.0.1 \
  FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=127.0.0.1

kill "$SENTINEL_PID" 2>/dev/null
wait "$SENTINEL_PID" 2>/dev/null

echo ""
echo "############################################################"
echo "# 哨兵日誌（全程）"
cat "$SENTINEL_LOG" 2>/dev/null || true
echo "############################################################"
[ $FAILED -ne 0 ] && echo "MATRIX RESULT: FAIL" || echo "MATRIX RESULT: PASS"
exit $FAILED
