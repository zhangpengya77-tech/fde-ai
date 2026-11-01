"""實測 Portal 代理等待與真實 V5 沙箱逾時，不接觸隔離環境資料。

1. 假 Django 延遲 17 秒，確認舊 15 秒上限不再提前回 503。
2. 假 Django 延遲超過設定上限，確認回結構化錯誤而不是掛住。
3. 以真實 best.pt 與真實照片測沙箱推論耗時，並用 1 秒預算觸發真實逾時。
"""

from __future__ import annotations

import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "live_backend"))

from starlette.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402
from app.rotation_sandbox import RotationSandboxError, RotationSandboxRunner  # noqa: E402

MODEL = Path("D:/AI/F450_CW_CCW_V5_training/training/v5_finetune_20261027_101500/weights/best.pt")
SHA = "911228ff2c1019701e3409c51b767e359871418f501941f00746434cfcd7352c"
PHOTO = Path("D:/AI/F450_CW_CCW_V5_training/build_20261027_093000/images/val/F450_A_0005.jpg")
PYTHON = "C:/Users/admin/AppData/Local/Python/pythoncore-3.14-64/python.exe"
DELAY = {"seconds": 0.0}


class Slow(BaseHTTPRequestHandler):
    def do_GET(self):
        time.sleep(DELAY["seconds"])
        body = b"slow-ok"
        try:
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
threading.Thread(target=server.serve_forever, daemon=True).start()
app = create_app(django_portal_url=f"http://127.0.0.1:{server.server_port}", dev_mode=True)
client = TestClient(app, raise_server_exceptions=False, headers={"host": "127.0.0.1"})

DELAY["seconds"] = 17
os.environ.pop("FDE_PORTAL_PROXY_TIMEOUT_SECONDS", None)
start = time.time()
response = client.get("/student/slow")
print(f"T1 延遲17秒 預設上限: status={response.status_code} body={response.text[:20]!r} 耗時={time.time()-start:.1f}s")

DELAY["seconds"] = 6
os.environ["FDE_PORTAL_PROXY_TIMEOUT_SECONDS"] = "2"
start = time.time()
response = client.get("/student/slow")
print(f"T2 超過上限: status={response.status_code} body={response.text[:120]!r} 耗時={time.time()-start:.1f}s")
os.environ.pop("FDE_PORTAL_PROXY_TIMEOUT_SECONDS", None)

image = PHOTO.read_bytes()
runner = RotationSandboxRunner(python_executable=PYTHON, expected_model_sha256=SHA, timeout_seconds=120)
start = time.time()
result = runner.infer(model_path=MODEL, image_bytes=image, actual_model_sha256=SHA)
strong = [item for item in result["detections"] if item["confidence"] >= 0.5]
print(f"T3 真實推論: 耗時={time.time()-start:.1f}s 框數(>=0.5)={len(strong)} 類別={sorted({i['class'] for i in strong})}")

runner = RotationSandboxRunner(python_executable=PYTHON, expected_model_sha256=SHA, timeout_seconds=1)
start = time.time()
try:
    runner.infer(model_path=MODEL, image_bytes=image, actual_model_sha256=SHA)
    print("T4 真實逾時: 未觸發")
except RotationSandboxError as exc:
    print(f"T4 真實逾時: {exc} 耗時={time.time()-start:.1f}s")
server.shutdown()
