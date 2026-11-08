"""建立「即時鏡頭檢測」獨立預覽環境（2026-11-08）。不碰正式站任何檔案（只讀正式資料做快照）。

預覽環境：D:/FDE-AI-Runtime/v2-live-camera
  埠號：Django 8440、Live 8441、入口 8442、閘道 8443、HTTPS 8843（正式站是 814x／8543，互不衝突）
  程式：D:/FDE-AI-UAS-v2.0-live-camera（feature/live-camera 分支）
  資料：正式資料庫的唯讀快照、視覺中心資料夾複本（路徑改指向預覽環境）
  金鑰：全新隨機產生，不沿用正式站
  知識庫 8772、飛行健康 8040：共用正式站的唯讀服務
重複執行：已存在的金鑰、憑證不覆寫；資料快照只在不存在時建立（加 --refresh-data 重新複製）。
"""

from __future__ import annotations

import secrets
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

PROD = Path("D:/FDE-AI-Runtime/v2-integration")
TEMPLATE = Path("D:/FDE-AI-Runtime/v2-about/stack.env")   # 結構最完整的既有預覽環境設定（只讀）
PREVIEW = Path("D:/FDE-AI-Runtime/v2-live-camera")
PORTS = {"8340": "8440", "8341": "8441", "8342": "8442", "8343": "8443", "8743": "8843"}


def build_stack_env() -> None:
    text = TEMPLATE.read_text(encoding="utf-8")
    text = text.replace("D:/FDE-AI-Runtime/v2-about", PREVIEW.as_posix())
    for old, new in PORTS.items():
        text = text.replace(old, new)
    # 舊的臨時通道網址移除；開新通道後由 start_preview.sh 寫入
    import re
    # 先刪「https://網址」再刪單獨的主機名稱，避免留下空的 https://
    text = re.sub(r",?https://[a-z0-9-]+\.trycloudflare\.com", "", text)
    text = re.sub(r",?[a-z0-9-]+\.trycloudflare\.com", "", text)
    (PREVIEW / "stack.env").write_text(text, encoding="utf-8")


def main() -> None:
    refresh = "--refresh-data" in sys.argv
    for name in ("db", "media", "logs", "tls", "static", "live-var/store", "live-var/pid-lab"):
        (PREVIEW / name).mkdir(parents=True, exist_ok=True)
    keys = PREVIEW / "keys.env"
    if not keys.exists():
        names = ("DJANGO_SECRET_KEY", "FDE_LIVE_ASSERTION_KEY", "FDE_GATEWAY_INTERNAL_AUTH_KEY", "FDE_LIVE_PROXY_KEY")
        keys.write_text("".join(f"export {n}={secrets.token_urlsafe(48)}\n" for n in names), encoding="utf-8")
    cert = PREVIEW / "tls/cert.pem"
    if not cert.exists():
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
                        "-keyout", str(PREVIEW / "tls/key.pem"), "-out", str(cert), "-subj", "/CN=localhost",
                        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)
    build_stack_env()

    db = PREVIEW / "db/integration.sqlite3"
    if refresh or not db.exists():
        # 正式資料庫唯讀快照（SQLite 線上備份 API，不鎖住正式服務）
        src = sqlite3.connect(f"file:{(PROD / 'db/integration.sqlite3').as_posix()}?mode=ro", uri=True)
        dst = sqlite3.connect(db)
        src.backup(dst)
        dst.close()
        src.close()
    for folder in ("vision-center", "rotation-v7"):
        target = PREVIEW / "live-var" / folder
        if refresh and target.exists():
            shutil.rmtree(target)
        if not target.exists():
            shutil.copytree(PROD / "live-var" / folder, target)
            # 複本內的 JSON 有寫死正式站路徑：改指向預覽環境，避免讀寫到正式資料夾
            for json_file in target.rglob("*.json"):
                content = json_file.read_text(encoding="utf-8")
                fixed = content.replace("D:/FDE-AI-Runtime/v2-integration", PREVIEW.as_posix()) \
                               .replace("D:\\\\FDE-AI-Runtime\\\\v2-integration", str(PREVIEW).replace("\\", "\\\\"))
                if fixed != content:
                    json_file.write_text(fixed, encoding="utf-8")
    print(PREVIEW)


if __name__ == "__main__":
    main()
