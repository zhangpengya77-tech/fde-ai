"""產生 v2 集成隔離環境：獨立目錄、隨機金鑰、自簽憑證與環境檔。

重複執行不會覆寫既有金鑰。所有輸出都在 RUNTIME 下，不進版本控制。
"""

from __future__ import annotations

import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/FDE-AI-Runtime/v2-integration")
V5_MODEL = "D:/AI/F450_CW_CCW_V5_training/training/v5_finetune_20261027_101500/weights/best.pt"
V5_SHA256 = "911228ff2c1019701e3409c51b767e359871418f501941f00746434cfcd7352c"
YOLO_PYTHON = "C:/Users/admin/AppData/Local/Python/pythoncore-3.14-64/python.exe"
PUBLIC_HOSTS = sys.argv[2] if len(sys.argv) > 2 else ""


def main() -> None:
    for name in ("db", "media", "live-var/vision-center", "live-var/rotation-v5", "live-var/store", "logs", "tls", "static"):
        (RUNTIME / name).mkdir(parents=True, exist_ok=True)
    keys_file = RUNTIME / "keys.env"
    if not keys_file.exists():
        names = (
            "DJANGO_SECRET_KEY", "FDE_LIVE_ASSERTION_KEY", "FDE_GATEWAY_INTERNAL_AUTH_KEY", "FDE_LIVE_PROXY_KEY",
        )
        keys_file.write_text("".join(f"export {name}={secrets.token_urlsafe(48)}\n" for name in names), encoding="utf-8")
    cert = RUNTIME / "tls/cert.pem"
    if not cert.exists():
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
            "-keyout", str(RUNTIME / "tls/key.pem"), "-out", str(cert), "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ], check=True, capture_output=True)
    hosts = ["localhost", "127.0.0.1"] + [item for item in PUBLIC_HOSTS.split(",") if item]
    origins = ["https://localhost:8543", "https://127.0.0.1:8543"] + [f"https://{item}" for item in hosts[2:]]
    entry_hosts = ["localhost:8543", "127.0.0.1:8543", "localhost", "127.0.0.1"] + hosts[2:]
    root = RUNTIME.as_posix()
    (RUNTIME / "stack.env").write_text(f"""source {root}/keys.env
export FDE_INTERNAL_SHARED_SECRET=$FDE_LIVE_ASSERTION_KEY
export DJANGO_DEBUG=false
export DJANGO_ALLOWED_HOSTS="{','.join(hosts)}"
export DJANGO_CSRF_TRUSTED_ORIGINS="{','.join(origins)}"
export DATABASE_URL="sqlite:///{root}/db/integration.sqlite3"
export DJANGO_MEDIA_ROOT="{root}/media"
export DJANGO_STATIC_ROOT="{root}/static"
export DJANGO_TRUST_PROXY_SSL_HEADER=true
export DJANGO_VISION_SUBMISSION_API_BASE_URL="http://127.0.0.1:8141"
export VISION_SUBMISSION_API_BASE_URL="http://127.0.0.1:8141"
export FDE_LIVE_ASSERTION_TTL_SECONDS=60
export FDE_REPLAY_LEDGER_PATH="{root}/live-var/replay.sqlite3"
export FDE_LIVE_STORE_DIR="{root}/live-var/store"
export FDE_LIVE_BASE_URL="http://127.0.0.1:8141"
export FDE_VISION_CENTER_ROOT="{root}/live-var/vision-center"
export FDE_LIVE_SESSION_STORE="{root}/live-var/sessions.sqlite3"
export FDE_MODEL_ARTIFACT_ROOT="{root}/live-var/artifacts"
export FDE_PROP_VALIDATION_ROOT="{root}/live-var/prop-validation"
export FDE_DJANGO_PORTAL_URL="http://127.0.0.1:8140"
export FDE_GATEWAY_DJANGO_ORIGIN="http://127.0.0.1:8140"
export FDE_ENTRY_PUBLIC_SCHEME=https
export FDE_ENTRY_TRUSTED_ORIGINS="{','.join(origins)}"
export FDE_ENTRY_ALLOWED_HOSTS="{','.join(entry_hosts)}"
export FDE_ENTRY_PORT=8142
export FDE_ENTRY_UPSTREAM_HOST=127.0.0.1
export FDE_ENTRY_UPSTREAM_PORT=8143
export FDE_ENTRY_DJANGO_HOST=127.0.0.1
export FDE_ENTRY_DJANGO_PORT=8140
export FDE_PROP_ROTATION_V5_ENABLED=1
export FDE_PROP_ROTATION_V5_REGISTRY_ROOT="{root}/live-var/rotation-v5"
export FDE_PROP_ROTATION_V5_MODEL_PATH="{V5_MODEL}"
export FDE_PROP_ROTATION_V5_MODEL_SHA256="{V5_SHA256}"
export FDE_PROP_ROTATION_V5_PYTHON="{YOLO_PYTHON}"
export FDE_PROP_ROTATION_V5_TIMEOUT_SECONDS=120
export FORWARDED_ALLOW_IPS=127.0.0.1
export P7A_TLS_PORT=8543
export P7A_TLS_UPSTREAM_PORT=8142
export P7A_TLS_CERT="{root}/tls/cert.pem"
export P7A_TLS_KEY="{root}/tls/key.pem"
export PYTHONUTF8=1
export NO_PROXY='*'
""", encoding="utf-8")
    print(RUNTIME)


if __name__ == "__main__":
    main()
