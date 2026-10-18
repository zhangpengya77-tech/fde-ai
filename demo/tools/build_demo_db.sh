#!/usr/bin/env bash
# FDE-AI-UAS 2.0 DEMO 环境：建立/重建隔离 DEMO 数据库
# 只在 demo/runtime/db/demo.sqlite3 上操作，绝不触碰正式 db.sqlite3。
set -euo pipefail

DEMO_ROOT="/d/FDE-AI-UAS-v2.0/demo"
PROJ="/d/FDE-AI-UAS-v2.0/student_portal"
PY="/d/FDE-AI-UAS-v2.0/.test-temp/django-venv/Scripts/python.exe"

DEMO_DB="$DEMO_ROOT/runtime/db/demo.sqlite3"
DEMO_MEDIA="$DEMO_ROOT/runtime/media"

# --- 安全护栏：目标必须是 demo/ 之下 ---
case "$DEMO_DB" in
  */demo/runtime/db/demo.sqlite3) ;;
  *) echo "ABORT: DEMO_DB 路径不在 demo/ 之下"; exit 1 ;;
esac

echo "== DEMO DB   : $DEMO_DB"
echo "== DEMO MEDIA: $DEMO_MEDIA"

mkdir -p "$DEMO_ROOT/runtime/db" "$DEMO_MEDIA"

if [ "${1:-}" = "--reset" ]; then
  echo "== 重建模式：删除旧 DEMO DB"
  rm -f "$DEMO_DB"
fi

export DJANGO_DB_NAME="$DEMO_DB"
export DJANGO_MEDIA_ROOT="$DEMO_MEDIA"
export DJANGO_DEBUG=true
export PYTHONNOUSERSITE=1

cd "$PROJ"

echo
echo "===== 套用 migration（含 0016~0019）====="
"$PY" manage.py migrate --no-input 2>&1 | tail -30

echo
echo "===== migration 状态 ====="
"$PY" manage.py showmigrations learning 2>&1 | tail -25

echo
echo "===== 确认 DEMO DB 已建立 ====="
ls -la "$DEMO_DB"
