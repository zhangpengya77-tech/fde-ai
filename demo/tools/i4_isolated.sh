#!/usr/bin/env bash
# ===========================================================================
#  I4 隔離驗收服務啟動器（Django + Live Backend）
#  用途：以「獨立測試庫 + 獨立埠」重現 2.0 的跨服務入口，供 I4-A／I4-D 驗收。
#
#  與正式服務完全隔離：
#    - Django :8120（正式 :8022 不觸碰），測試庫為 p42_verify.sqlite3 的獨立副本
#    - Live   :8121（正式 :8111 不觸碰），Django 上游指向 :8120
#    - RAG    上游指向死埠 :8799（正式 :8770 不觸碰），用於驗證降級行為
#
#  用法：bash i4_isolated.sh django|live
# ===========================================================================
set -euo pipefail

PROJECT_ROOT="D:/FDE-AI-UAS-v2.0"
DEMO_ROOT="$PROJECT_ROOT/demo"
DB_FILE="$DEMO_ROOT/runtime/db/i4_e2e.sqlite3"
DJANGO_PY="$PROJECT_ROOT/.test-temp/django-venv/Scripts/python.exe"
LIVE_PY="C:/Users/admin/AppData/Local/Python/pythoncore-3.14-64/python.exe"

# 綁定位址／埠可由呼叫端覆寫（I1／I2 回歸沿用原驗收位址，條件與前輪一致）。
BIND_ADDR="${I4_BIND_ADDR:-127.0.0.1}"
DJANGO_PORT="${I4_DJANGO_PORT:-8120}"
LIVE_PORT="${I4_LIVE_PORT:-8121}"

export DJANGO_DB_NAME="$DB_FILE"
export DJANGO_MEDIA_ROOT="$DEMO_ROOT/runtime/media_i4"
export DJANGO_DEBUG=true
export DJANGO_SETTINGS_MODULE=config.settings
export DJANGO_ALLOWED_HOSTS="127.0.0.1,localhost,127.0.0.1:8022,${BIND_ADDR},${BIND_ADDR}:${DJANGO_PORT},${BIND_ADDR}:${LIVE_PORT},127.0.0.1:${DJANGO_PORT},127.0.0.1:${LIVE_PORT}"
export DJANGO_CSRF_TRUSTED_ORIGINS="http://127.0.0.1:${DJANGO_PORT},http://127.0.0.1:${LIVE_PORT},http://${BIND_ADDR}:${DJANGO_PORT},http://${BIND_ADDR}:${LIVE_PORT}"
export FDE_VISION_CENTER_ROOT="$DEMO_ROOT/runtime/vision-center"
export FDE_DOWNLOAD_ROOT='D:\下載中心文件'
export FDE_DJANGO_PORTAL_URL="http://${BIND_ADDR}:${DJANGO_PORT}"
export DJANGO_VISION_SUBMISSION_API_BASE_URL="http://${BIND_ADDR}:${LIVE_PORT}"
export FDE_DEMO_SIMULATED_INFERENCE=1
export DJANGO_VISION_DEMO_SIMULATION_ENABLED=1
export PYTHONNOUSERSITE=1
export PYTHONUTF8=1
export NO_PROXY='*'
export no_proxy='*'
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true

mkdir -p "$DJANGO_MEDIA_ROOT"

case "${1:-}" in
  django)
    cd "$PROJECT_ROOT/student_portal"
    exec "$DJANGO_PY" manage.py runserver "${BIND_ADDR}:${DJANGO_PORT}" --noreload
    ;;
  live)
    export FDE_LIVE_RAG_BASE_URL="${FDE_LIVE_RAG_BASE_URL:-http://127.0.0.1:8799}"
    cd "$PROJECT_ROOT/live_backend"
    exec "$LIVE_PY" -m uvicorn app.main:app --host "$BIND_ADDR" --port "$LIVE_PORT"
    ;;
  *)
    echo "usage: $0 django|live" >&2
    exit 2
    ;;
esac
