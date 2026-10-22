"""Standalone teaching server for 127.0.0.1:8111 (Mode-2 RC closure).

Serves the built simulator at /sim/ and the newest guided-calibration capture
at /api/rc/latest-profile, so a plain static deployment still completes the RC
auto-import loop without the Django backend. Mirrors the response shape of the
live endpoint in live_backend/app/main.py (latest file by mtime, same
four-axis validation).

Endpoints:
  GET  /sim/                     built simulator (dist/)
  GET  /api/rc/latest-profile    newest valid capture (by mtime)
  POST /api/rc/captures          persist a new capture: backs up the previous
                                 one, writes the newest-mtime file and mirrors
                                 it into public/ and dist/ (static fallback)
  GET  /healthz                  liveness

Usage:
  python tools/serve-8111.py            # 127.0.0.1:8111 (local only)
  python tools/serve-8111.py --lan      # 0.0.0.0:8111 (LAN, prints a warning)

Security note: binding to the LAN exposes both the simulator and the capture
write endpoint to everyone on that network. Only use --lan on a trusted
teaching network.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = PROJECT_ROOT / "dist"
# Wizard captures land in the WorkBuddy workspace folder (FDE_RC_CALIB_DIR).
RC_CALIB_DIR = Path(
    os.environ.get("FDE_RC_CALIB_DIR") or r"C:\Users\admin\WorkBuddy AI\2026-10-05-17-47-38"
)
# Backups of the capture that was in effect before a new one is written.
RC_BACKUP_DIR = RC_CALIB_DIR / "fde-rc-calibration-backup"
# Static fallback copies kept byte-identical with the newest capture.
RC_STATIC_FALLBACKS = [PROJECT_ROOT / "public" / "rc-profile-latest.json", DIST_DIR / "rc-profile-latest.json"]

DEFAULT_HOST = "127.0.0.1"
PORT = 8111

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

AXIS_ROLES = ("roll", "pitch", "yaw", "throttle")


def latest_profile_payload() -> tuple[int, dict]:
    """Same selection rule as the live endpoint: newest valid file by mtime."""
    if not RC_CALIB_DIR.is_dir():
        return 200, {"ok": False, "reason": "no-directory"}
    candidates = sorted(RC_CALIB_DIR.glob("fde-rc-calibration-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for candidate in candidates:
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        profile = payload.get("profile") if isinstance(payload, dict) else None
        if not isinstance(profile, dict) or not isinstance(profile.get("id"), str):
            continue
        if payload.get("schema") != "fde.device-profile/1":
            continue
        axes = profile.get("axes")
        if not isinstance(axes, dict) or not all(
            isinstance(axes.get(k), dict) and isinstance(axes[k].get("source"), int)
            for k in AXIS_ROLES
        ):
            continue
        return 200, {
            "ok": True,
            "file": candidate.name,
            "savedAtMs": payload.get("savedAtMs"),
            "profile": profile,
            "calibration": payload.get("calibration"),
        }
    return 200, {"ok": False, "reason": "no-valid-profile"}


def latest_capture_path() -> Path | None:
    """Path of the capture the live endpoint would serve right now (for the banner)."""
    _, payload = latest_profile_payload()
    if not payload.get("ok"):
        return None
    return RC_CALIB_DIR / str(payload["file"])


def _lan_addresses() -> list[str]:
    """Best-effort list of this machine's IPv4 LAN addresses (no packets are sent)."""
    addrs: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = str(info[4][0])
            if not ip.startswith("127.") and ip not in addrs:
                addrs.append(ip)
    except OSError:
        pass
    if not addrs:
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.connect(("8.8.8.8", 80))
                ip = str(probe.getsockname()[0])
                if not ip.startswith("127."):
                    addrs.append(ip)
            finally:
                probe.close()
        except OSError:
            pass
    return addrs


def _port_in_use(port: int) -> bool:
    """True when something already accepts connections on the port.

    On Windows SO_REUSEADDR lets a second process bind the same port, so two
    servers would silently split traffic and the page would fail at random.
    Checking first turns that into one clear error message instead.
    """
    for target in ("127.0.0.1",):
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.settimeout(0.5)
        try:
            if probe.connect_ex((target, port)) == 0:
                return True
        finally:
            probe.close()
    return False


def _valid_capture(doc: object) -> str | None:
    """Validation shared by the write endpoint; returns a reason when invalid."""
    if not isinstance(doc, dict):
        return "body must be a JSON object"
    if doc.get("schema") != "fde.device-profile/1":
        return "schema must be fde.device-profile/1"
    profile = doc.get("profile")
    if not isinstance(profile, dict) or not isinstance(profile.get("id"), str) or not profile["id"].strip():
        return "profile.id must be a non-empty string"
    axes = profile.get("axes")
    if not isinstance(axes, dict):
        return "profile.axes must be an object"
    for role in AXIS_ROLES:
        binding = axes.get(role)
        if not isinstance(binding, dict):
            return f"profile.axes.{role} must be an object"
        source = binding.get("source")
        if not isinstance(source, int) or isinstance(source, bool) or not 0 <= source <= 7:
            return f"profile.axes.{role}.source must be an axis index 0..7"
        calibration = binding.get("calibration")
        if not isinstance(calibration, dict):
            return f"profile.axes.{role}.calibration must be an object"
        for field in ("min", "center", "max", "deadzone", "expo"):
            value = calibration.get(field)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return f"profile.axes.{role}.calibration.{field} must be a number"
    if not isinstance(doc.get("savedAtMs"), (int, float)) or isinstance(doc.get("savedAtMs"), bool):
        return "savedAtMs must be a number"
    return None


def save_capture(doc: dict) -> tuple[int, dict]:
    """Persist a new capture: backup the current one, write the newest file and
    mirror it into the static fallbacks (public/ and dist/)."""
    reason = _valid_capture(doc)
    if reason:
        return 400, {"ok": False, "reason": reason}
    if not RC_CALIB_DIR.is_dir():
        return 400, {"ok": False, "reason": "calibration directory missing"}

    # 1) Back up whatever is currently in effect (never overwrite a backup).
    _, current = latest_profile_payload()
    backup_name = ""
    if current.get("ok"):
        source = RC_CALIB_DIR / str(current["file"])
        try:
            RC_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            target = RC_BACKUP_DIR / source.name
            if target.exists():
                stem = source.stem
                target = RC_BACKUP_DIR / f"{stem}-{datetime.now().strftime('%H%M%S')}{source.suffix}"
            shutil.copy2(source, target)
            backup_name = target.name
        except OSError as error:
            return 500, {"ok": False, "reason": f"backup failed: {error}"}

    # 2) Write the new capture; a fresh timestamp keeps it the newest by mtime.
    saved_at_ms = int(doc["savedAtMs"])
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    target = RC_CALIB_DIR / f"fde-rc-calibration-{stamp}-suggestion.json"
    body = json.dumps(doc, ensure_ascii=False, indent=2)
    try:
        target.write_text(body, encoding="utf-8")
        os.utime(target, (saved_at_ms / 1000, saved_at_ms / 1000))
    except OSError as error:
        return 500, {"ok": False, "reason": f"write failed: {error}"}

    # 3) Keep the static fallbacks byte-identical with the newest capture.
    mirrored: list[str] = []
    for path in RC_STATIC_FALLBACKS:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(target, path)
            mirrored.append(str(path))
        except OSError:
            continue

    return 200, {
        "ok": True,
        "file": target.name,
        "savedAtMs": saved_at_ms,
        "backup": backup_name,
        "mirrored": mirrored,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "FDE-Sim/1.2"

    def log_message(self, fmt, *args):  # keep the console quiet
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):  # noqa: N802 (http.server naming)
        path = unquote(urlparse(self.path).path)

        if path == "/api/rc/latest-profile":
            status, payload = latest_profile_payload()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self._send(status, body, "application/json; charset=utf-8")
            return

        if path == "/healthz":
            self._send(200, b'{"ok":true}', "application/json; charset=utf-8")
            return

        # Everything else is the built simulator under /sim/.
        if path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
            return
        if path == "/sim" or path == "/sim/":
            rel = "index.html"
        elif path.startswith("/sim/"):
            rel = path[len("/sim/"):]
        else:
            self._send_not_found(path, "這個路徑不屬於模擬器。")
            return

        target = (DIST_DIR / rel).resolve()
        if not str(target).startswith(str(DIST_DIR.resolve())) or not target.is_file():
            self._send_not_found(path, "檔案不存在（可能是舊連結、暫存頁面或打錯字）。")
            return
        body = target.read_bytes()
        ctype = CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, body, ctype)

    def _send_not_found(self, path: str, reason: str) -> None:
        """Human-readable 404: the teacher's browser should never show a blank page."""
        host = self.headers.get('Host') or '127.0.0.1:8111'
        html = f"""<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 - 找不到頁面</title>
<style>
 body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#f2f5fa;color:#1f2937;font:16px/1.7 -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif}}
 .card{{max-width:640px;padding:32px 36px;background:#fff;border:1px solid #dfe6f0;border-radius:14px;
      box-shadow:0 8px 28px rgba(15,23,42,.08)}}
 h1{{margin:0 0 6px;font-size:20px;color:#b45309}}
 code{{background:#eef2f8;padding:2px 6px;border-radius:5px;color:#0b63c5;word-break:break-all}}
 a.btn{{display:inline-block;margin-top:20px;padding:11px 22px;border-radius:9px;background:#2f6feb;
        color:#fff;text-decoration:none;font-weight:600}}
 p{{margin:10px 0}}
</style></head><body><div class="card">
<h1>404 · 找不到這個網址</h1>
<p>你開的是：<code>{path}</code></p>
<p>{reason}</p>
<p>模擬器的入口只有一個：</p>
<p><a class="btn" href="/sim/">開啟模擬器 http://{host}/sim/</a></p>
<p style="font-size:14px;color:#6b7280">不要使用帶隨機檔名或 <code>?sig=</code> 參數的暫存連結，
也不要漏掉 <code>http://</code>（否則瀏覽器會把它當成 <code>/sim/</code> 底下的相對路徑）。</p>
</div></body></html>"""
        self._send(404, html.encode("utf-8"), "text/html; charset=utf-8")

    def do_POST(self):  # noqa: N802 (http.server naming)
        path = unquote(urlparse(self.path).path)
        if path != "/api/rc/captures":
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._send(400, b'{"ok":false,"reason":"body must be UTF-8 JSON"}', "application/json; charset=utf-8")
            return
        status, payload = save_capture(doc)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _send(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="FDE teaching server (simulator + RC captures)")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="bind 0.0.0.0 instead of 127.0.0.1 so other devices on the LAN can open it",
    )
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else DEFAULT_HOST
    if not DIST_DIR.is_dir():
        sys.exit(f"dist not found at {DIST_DIR} - run vite build first")
    if args.lan:
        print(
            "WARNING: --lan binds 0.0.0.0 - anyone on this network can open the simulator "
            "AND write calibration captures via POST /api/rc/captures. Use only on a trusted teaching network.",
            file=sys.stderr,
        )
    if _port_in_use(PORT):
        sys.exit(
            f"port {PORT} is already in use by another process (an older server window?).\n"
            "Close that window, or run:  netstat -ano | findstr :8111   then   taskkill /f /pid <PID>"
        )
    try:
        httpd = ThreadingHTTPServer((host, PORT), Handler)
    except OSError as exc:
        sys.exit(
            f"cannot bind {host}:{PORT} ({exc}) - port already in use? "
            "Close the other server window (or the old 8111 process) and start again."
        )
    print(f"FDE teaching server on http://{host}:{PORT}/sim/ (dist={DIST_DIR}, calib={RC_CALIB_DIR})", flush=True)
    if args.lan:
        for ip in _lan_addresses():
            print(f"  teacher URL: http://{ip}:{PORT}/sim/", flush=True)
    else:
        print(f"  teacher URL: http://127.0.0.1:{PORT}/sim/   (add --lan for other devices)", flush=True)
    print(f"  latest profile: {latest_capture_path() or '(none)'}", flush=True)
    print("  keep this window OPEN while teaching; close it (or Ctrl+C) to stop the server.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
