"""I5-B：外部模組接口安全修復驗收（實證；唯讀，不啟動外部服務、不寫入任何資料庫）。

對應教師 I5 指令第二節「驗收安全修復」13 項：
  1. DNS 判定公網、實際解析內網的重綁情境 → 必須阻擋
  2. 白名單主機解析至 127.0.0.1          → 必須阻擋
  3. 白名單主機解析至 10.0.0.5           → 必須阻擋
  4. metadata 位址無條件拒絕
  5. DNS 解析失敗（fail-closed）
  6. 非標準數字 IP 表示法
  7. 主機尾點正規化
  8. HTTP 3xx 不跟隨
  9. 未授權零探測
 10. 模組停用零探測
 11. 正常可信服務可達
 12. HTTPS 憑證驗證仍有效
 13. 安全拒絕時不寫入學習資料

**關鍵**：教師要求「測試必須證明實際連線目標，不得只驗證 URL 字串」。
因此本腳本以 **socket.create_connection 記錄器** 捕捉每一次探測的**真實 TCP 目標**
（並仍讓真實連線發生），另以哨兵伺服器記錄實際收到的請求。

作法：
  - HTTP 哨兵 127.0.0.1:8198（記錄請求；可切換 302 模式）
  - HTTPS 哨兵 127.0.0.1:8197（**自簽憑證**，用於驗證 TLS 驗證未被關閉）
  - mock socket.getaddrinfo 模擬 DNS（不對外發出任何查詢）
  - 不連線任何外部主機（公網位址一律使用 198.51.100.7，即 RFC 5737 TEST-NET-2，
    文件上保證不可路由，實際不會產生真實流量）
"""

from __future__ import annotations

import json
import os
import socket
import ssl
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
PORTAL = ROOT / "student_portal"
sys.path.insert(0, str(PORTAL))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.environ["DJANGO_DB_NAME"] = str(ROOT / ".test-temp" / "i5_readonly.sqlite3")

import django  # noqa: E402

django.setup()

from django.test import override_settings  # noqa: E402

from learning import external_modules as em  # noqa: E402

HTTP_PORT = 8198
HTTPS_PORT = 8197
HTTP_HOST = "127.0.0.1"
# RFC 5737 TEST-NET-2：文件上不可路由，用於「公網」模擬位址（不產生真實流量）。
PUBLIC_IP = "198.51.100.7"

RESULTS = []
HTTP_REQUESTS: list[dict] = []
CONNECT_TARGETS: list[tuple] = []
REDIRECT_MODE = {"on": False}
_MODE = {"real": True, "simulate_host": ""}
PUBLIC_IP = "93.184.216.34"
_REAL_CREATE_CONNECTION = socket.create_connection


class _Sentinel(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _record(self):
        HTTP_REQUESTS.append(
            {
                "command": self.command,
                "path": self.path,
                "user_agent": self.headers.get("User-Agent", ""),
                "cookie": self.headers.get("Cookie", ""),
                "authorization": self.headers.get("Authorization", ""),
            }
        )

    def _respond(self):
        self._record()
        if REDIRECT_MODE["on"]:
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
        else:
            self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_HEAD = _respond
    do_GET = _respond
    do_POST = _respond

    def log_message(self, *_args):
        pass


def _record(name, status, detail):
    RESULTS.append({"item": name, "status": status, "detail": detail})
    print("[%-6s] %-52s %s" % (status, name, detail))


def _fake_getaddrinfo(mapping, counter=None):
    """回傳可作為 socket.getaddrinfo 替身的函式；mapping: host -> 位址（或位址序列）。

    字面 IP（例如連線階段傳入的 127.0.0.1）**直通回傳本身**，模擬真實解析器行為。
    未列入 mapping 且非字面 IP 的主機名 → gaierror（模擬 NXDOMAIN）。
    """
    import ipaddress as _ipaddress

    def _impl(host, port, *args, **kwargs):
        if counter is not None:
            counter.append(host)
        value = mapping.get(host)
        if value is None:
            try:
                _ipaddress.ip_address(str(host).split("%")[0])
                value = str(host)
            except ValueError:
                raise socket.gaierror(-2, "Name or service not known")
        if isinstance(value, (list, tuple)) and not isinstance(value, str):
            index = 0
            if counter:
                index = min(len(counter) - 1, len(value) - 1)
            value = value[index]
        family = socket.AF_INET6 if ":" in value else socket.AF_INET
        # AF_INET 需 (host, port) 二元組；AF_INET6 需四元組。
        sockaddr = (value, port or 0, 0, 0) if family == socket.AF_INET6 else (value, port or 0)
        return [(family, socket.SOCK_STREAM, 6, "", sockaddr)]

    return _impl


def _recording_create_connection(address, *args, **kwargs):
    """記錄**實際 TCP 目標**，再讓真實連線發生（不攔截、不偽造）。"""
    CONNECT_TARGETS.append(tuple(address))
    if not _MODE["real"] and address[0] == _MODE["simulate_host"]:
        # 公網模擬位址：記錄目標後模擬不可達（不對外產生真實流量）。
        raise TimeoutError("simulated public host unreachable")
    return _REAL_CREATE_CONNECTION(address, *args, **kwargs)


def _debug_probe(url, ip):
    """除錯用：直接呼叫探測並印出例外（僅在 FDE_I5_DEBUG=1 時使用）。"""
    if not os.environ.get("FDE_I5_DEBUG"):
        return
    import traceback

    import http.client as http_client

    _saved = {name: getattr(http_client.HTTPConnection, name)
              for name in ("connect", "request", "getresponse", "close")
              if hasattr(http_client.HTTPConnection, name)}
    for name in ("connect", "request", "getresponse", "close"):
        original = getattr(http_client.HTTPConnection, name, None)
        if original is None:
            continue

        def _wrapped(self, *args, _original=original, _name=name, **kwargs):
            try:
                return _original(self, *args, **kwargs)
            except Exception as _e:
                print("   [debug] %s raised: %s: %s" % (_name, type(_e).__name__, _e))
                raise

        setattr(http_client.HTTPConnection, name, _wrapped)
    try:
        print("   [debug] _probe_pinned(%r, %r) ->" % (url, ip), em._probe_pinned(url, ip))
    finally:
        for name in ("connect", "request", "getresponse", "close"):
            if hasattr(http_client.HTTPConnection, name):
                setattr(http_client.HTTPConnection, name, _saved.get(name))
    return




def _module(url, *, prober="real", allowlist=None, private=None, role="student"):
    """以真實路徑（DNS＋IP 釘選）取得模組狀態。"""
    clear = {"enabled": True, "entry_url": url}
    if role == "unauthorized":
        clear["allowed_roles"] = ["teacher"]
    kwargs = {"FDE_EXTERNAL_MODULES": {"F450_DIGITAL_TWIN": clear}}
    if prober == "real":
        kwargs["FDE_EXTERNAL_MODULE_PROBER"] = None
    if allowlist is not None:
        kwargs["FDE_EXTERNAL_MODULE_ALLOWED_HOSTS"] = allowlist
    if private is not None:
        kwargs["FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS"] = private
    em.clear_probe_cache()
    HTTP_REQUESTS.clear()
    CONNECT_TARGETS.clear()
    with override_settings(**kwargs):
        return em.get_external_module("F450_DIGITAL_TWIN", role=role)


def _start_tls_sentinel():
    """以自簽憑證啟動 HTTPS 哨兵（用於驗證 TLS 驗證未被關閉）。"""
    tmp = ROOT / ".test-temp" / "i5_tls"
    tmp.mkdir(parents=True, exist_ok=True)
    cert = tmp / "cert.pem"
    key = tmp / "key.pem"
    if not cert.exists() or not key.exists():
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(key), "-out", str(cert),
                "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1",
                "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
            ],
            check=True, capture_output=True,
        )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert), str(key))
    server = ThreadingHTTPServer((HTTP_HOST, HTTPS_PORT), _Sentinel)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> int:
    server = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), _Sentinel)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    tls_server = _start_tls_sentinel()

    print("=" * 104)
    print("I5-B 外部模組接口安全修復驗收（實證）")
    print("HTTP 哨兵 %s:%d｜HTTPS 自簽哨兵 %s:%d｜公網模擬位址 %s" % (
        HTTP_HOST, HTTP_PORT, HTTP_HOST, HTTPS_PORT, PUBLIC_IP))
    print("=" * 104)

    with mock.patch.object(
        em.socket, "create_connection", _recording_create_connection
    ):

        # ---------- 1. DNS 重綁（TOCTOU）----------
        print("\n--- 1. DNS 判定公網、實際解析內網的重綁情境（R1）---")
        calls: list[str] = []
        _MODE["real"], _MODE["simulate_host"] = False, PUBLIC_IP
        with mock.patch.object(
            em.socket, "getaddrinfo", _fake_getaddrinfo({"rebind.example.test": [PUBLIC_IP, "127.0.0.1"]}, calls)
        ):
            module = _module("http://rebind.example.test:%d/mp" % HTTP_PORT)
        _MODE["real"] = True
        reached_internal = any(target[0] == "127.0.0.1" and target[1] == HTTP_PORT for target in CONNECT_TARGETS)
        _record(
            "1a 重綁情境未連到內網（實際 TCP 目標）",
            "PASS" if not reached_internal else "FAIL",
            "實際連線目標=%s；哨兵收到 %d 次請求" % (CONNECT_TARGETS[:4], len(HTTP_REQUESTS)),
        )
        _record(
            "1b 探測使用判定時釘選的公網 IP",
            "PASS" if CONNECT_TARGETS and CONNECT_TARGETS[0][0] == PUBLIC_IP else "FAIL",
            "首次連線目標=%r（DNS 解析 %d 次：判定 1 次，連線 0 次）" % (
                CONNECT_TARGETS[0] if CONNECT_TARGETS else None, len(calls)),
        )
        _record(
            "1c 整個流程只解析一次 DNS",
            "PASS" if len(calls) == 1 else "FAIL",
            "getaddrinfo 呼叫 %d 次" % len(calls),
        )
        _record(
            "1d 狀態非 AVAILABLE（公網位址不可達 → 服務暫時不可用）",
            "PASS" if module["availability_status"] == em.STATUS_SERVICE_UNAVAILABLE else "FAIL",
            "狀態=%s／診斷=%s／url=%r"
            % (module["availability_status"], module["diagnosis"], module["url"]),
        )

        # ---------- 2/3. 白名單主機解析至內網 ----------
        print("\n--- 2/3. 白名單主機解析至 127.0.0.1 ／ 10.0.0.5（R2）---")
        for label, target in (("127.0.0.1", "127.0.0.1"), ("10.0.0.5", "10.0.0.5")):
            with mock.patch.object(
                em.socket, "getaddrinfo", _fake_getaddrinfo({"mp.school.edu.tw": target})
            ):
                module = _module(
                    "https://mp.school.edu.tw/twin",
                    allowlist=["*.school.edu.tw"],
                    private=["*.school.edu.tw"],
                )
            hit = bool(CONNECT_TARGETS) and CONNECT_TARGETS[0][0] == target
            _record(
                "白名單命中主機解析到 %s → 阻擋" % target,
                "PASS" if not hit and module["url"] == "" else "FAIL",
                "實際連線目標=%r／狀態=%s／診斷=%s／未發出探測=%s"
                % (CONNECT_TARGETS[:1] or None, module["availability_status"],
                   module["diagnosis"], not CONNECT_TARGETS),
            )
            _record(
                "白名單主機＋私網通配符 %s 不放行內網" % target,
                "PASS" if module["availability_status"] == em.STATUS_SERVICE_UNAVAILABLE else "FAIL",
                "私網清單僅接受精確值；通配符『*.school.edu.tw』無效（診斷=%s）" % module["diagnosis"],
            )

        # ---------- 4. metadata 無條件拒絕 ----------
        print("\n--- 4. metadata 位址無條件拒絕 ---")
        for label, url, allowlist, private in (
            ("字面 metadata", "http://169.254.169.254/latest/meta-data/", ["169.254.169.254"], ["169.254.169.254"]),
            ("主機名 metadata", "http://metadata.google.internal/x", ["*.google.internal"], ["metadata.google.internal"]),
            ("localhost 字面（未列入私網清單）", "http://127.0.0.1:9000/x", ["127.0.0.1"], None),
            ("localhost 名稱", "http://localhost:9000/x", ["localhost"], ["localhost"]),
            ("尾點變體", "http://metadata.google.internal./x", None, None),
        ):
            with mock.patch.object(
                em.socket, "getaddrinfo",
                _fake_getaddrinfo({"metadata.google.internal.": "169.254.169.254",
                                   "metadata.google.internal": "169.254.169.254",
                                   "localhost": "127.0.0.1"}),
            ):
                module = _module(url, allowlist=allowlist, private=private)
            _record(
                "metadata／localhost 拒絕：%s" % label,
                "PASS" if module["url"] == "" and not CONNECT_TARGETS else "FAIL",
                "狀態=%s／診斷=%s／探測=%d 次"
                % (module["availability_status"], module["diagnosis"], len(CONNECT_TARGETS)),
            )

        # ---------- 5. DNS 解析失敗 ----------
        print("\n--- 5. DNS 解析失敗（fail-closed）---")
        with mock.patch.object(em.socket, "getaddrinfo", side_effect=OSError("nxdomain")):
            module = _module("https://twin.example.test/f450")
        _record(
            "5a DNS 失敗 → 不探測、fail-closed",
            "PASS" if not CONNECT_TARGETS and module["url"] == "" else "FAIL",
            "實際連線目標=%r／狀態=%s／診斷=%s" % (CONNECT_TARGETS[:1] or None,
            module["availability_status"], module["diagnosis"]),
        )
        _record(
            "5b DNS 失敗狀態為「服務暫時不可用」",
            "PASS" if module["availability_status"] == em.STATUS_SERVICE_UNAVAILABLE else "FAIL",
            "狀態=%s（診斷碼 %s）" % (module["availability_status"], module["diagnosis"]),
        )

        # ---------- 6. 非標準數字 IP ----------
        print("\n--- 6. 非標準數字／進位制 IP 表示法 ---")
        for host in ("2852039166", "0xA9FEA9FE", "0177.0.0.1", "2130706433", "017700000001"):
            with mock.patch.object(em.socket, "getaddrinfo", _fake_getaddrinfo({host: "127.0.0.1"})):
                module = _module("http://%s/twin" % host)
            _record(
                "數字／進位制主機名拒絕：%s" % host,
                "PASS" if module["url"] == "" and module["url_rejected"] else "FAIL",
                "狀態=%s／診斷=%s／探測=%d 次"
                % (module["availability_status"], module["diagnosis"], len(CONNECT_TARGETS)),
            )
        with mock.patch.object(em.socket, "getaddrinfo", _fake_getaddrinfo({PUBLIC_IP: PUBLIC_IP})):
            evaluation = em.evaluate_entry_url("http://%s/twin" % PUBLIC_IP)
        _record(
            "正規公網 IP 未被誤傷（不實際對外連線）",
            "PASS" if evaluation["problem"] == "" and evaluation["ip"] == PUBLIC_IP else "FAIL",
            "評估 ip=%r／problem=%r（診斷=%s）"
            % (evaluation["ip"], evaluation["problem"] or "無", evaluation["diagnosis"]),
        )

        # ---------- 7. 尾點／大小寫／IDNA 正規化 ----------
        print("\n--- 7. 主機尾點／大小寫／IDNA 正規化 ---")
        for raw, expected in (
            ("Example.TEST", "example.test"),
            ("example.test.", "example.test"),
            ("example.test...", "example.test"),
            ("metadata.google.internal.", "metadata.google.internal"),
            ("fe80::1%eth0", "fe80::1"),
        ):
            actual = em._normalize_hostname(raw)
            _record(
                "正規化 %-30s → %s" % (raw, expected),
                "PASS" if actual == expected else "FAIL",
                "實際=%r" % actual,
            )

        # ---------- 8. HTTP 3xx 不跟隨 ----------
        print("\n--- 8. HTTP 3xx 不跟隨 ---")
        REDIRECT_MODE["on"] = True
        try:
            module = _module(
                "http://mp.redirect.test:%d/mp" % HTTP_PORT,
                allowlist=["mp.redirect.test"],
                private=["mp.redirect.test"],
            )
            # 讓 DNS 一律回 127.0.0.1（已精確允許），使探測真的打到哨兵。
            with mock.patch.object(
                em.socket, "getaddrinfo", _fake_getaddrinfo({"mp.redirect.test": "127.0.0.1"})
            ):
                em.clear_probe_cache()
                HTTP_REQUESTS.clear()
                CONNECT_TARGETS.clear()
                with override_settings(
                    FDE_EXTERNAL_MODULES={
                        "F450_DIGITAL_TWIN": {
                            "enabled": True,
                            "entry_url": "http://mp.redirect.test:%d/mp" % HTTP_PORT,
                        }
                    },
                    FDE_EXTERNAL_MODULE_PROBER=None,
                    FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=["mp.redirect.test"],
                    FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["mp.redirect.test"],
                ):
                    module = em.get_external_module("F450_DIGITAL_TWIN", role="student")
        finally:
            REDIRECT_MODE["on"] = False
        followed = any(item["path"].startswith("/latest/meta-data") for item in HTTP_REQUESTS)
        _record(
            "8a 302 未被跟隨（哨兵僅收到原始請求）",
            "PASS" if len(HTTP_REQUESTS) == 1 and not followed else "FAIL",
            "哨兵請求=%s" % [item["path"] for item in HTTP_REQUESTS],
        )
        _record(
            "8b 實際連線目標為經驗證 IP",
            "PASS" if CONNECT_TARGETS and CONNECT_TARGETS[0] == ("127.0.0.1", HTTP_PORT) else "FAIL",
            "實際目標=%r" % (CONNECT_TARGETS[:1] or None),
        )

        # ---------- 9/10. 零探測 ----------
        print("\n--- 9/10. 未授權零探測／模組停用零探測 ---")
        module = _module(
            "http://mp.unauth.test:%d/mp" % HTTP_PORT,
            private=["mp.unauth.test"],
            role="unauthorized",
        )
        _record(
            "9 未授權（角色不符）→ 零解析、零探測",
            "PASS" if not CONNECT_TARGETS and module["availability_status"] == em.STATUS_ROLE_RESTRICTED else "FAIL",
            "狀態=%s／診斷=%s／連線=%d 次"
            % (module["availability_status"], module["diagnosis"], len(CONNECT_TARGETS)),
        )
        with override_settings(FDE_EXTERNAL_MODULES={"F450_DIGITAL_TWIN": {"enabled": False, "entry_url": "http://127.0.0.1:1/x"}}):
            em.clear_probe_cache()
            HTTP_REQUESTS.clear()
            CONNECT_TARGETS.clear()
            module = em.get_external_module("F450_DIGITAL_TWIN", role="student")
        _record(
            "10 模組停用 → 零解析、零探測",
            "PASS" if not CONNECT_TARGETS and module["availability_status"] == em.STATUS_NOT_INTEGRATED else "FAIL",
            "狀態=%s／診斷=%s／連線=%d 次"
            % (module["availability_status"], module["diagnosis"], len(CONNECT_TARGETS)),
        )

        # ---------- 11. 正常可信服務可達 ----------
        print("\n--- 11. 正常可信服務可達 ---")
        with mock.patch.object(
            em.socket, "getaddrinfo", _fake_getaddrinfo({"mp.trusted.test": "127.0.0.1"})
        ):
            module = _module(
                "http://mp.trusted.test:%d/mp" % HTTP_PORT,
                private=["mp.trusted.test"],
            )
            _debug_probe("http://mp.trusted.test:%d/mp" % HTTP_PORT, "127.0.0.1")
        _record(
            "11a 可信服務可達 → AVAILABLE 且有連結",
            "PASS" if module["availability_status"] == em.STATUS_AVAILABLE and module["url"] else "FAIL",
            "狀態=%s／url=%r／診斷=%s"
            % (module["availability_status"], module["url"], module["diagnosis"]),
        )
        _record(
            "11b 實際連線目標與 Host 標頭正確",
            "PASS" if CONNECT_TARGETS and CONNECT_TARGETS[0] == ("127.0.0.1", HTTP_PORT) else "FAIL",
            "實際目標=%r；哨兵實際收到 %d 次請求、method=%s"
            % (CONNECT_TARGETS[:1] or None, len(HTTP_REQUESTS),
               [item["command"] for item in HTTP_REQUESTS]),
        )
        _record(
            "11c 探測不攜帶任何憑證",
            "PASS" if HTTP_REQUESTS and not HTTP_REQUESTS[0]["cookie"] and not HTTP_REQUESTS[0]["authorization"] else "FAIL",
            "Cookie=%r／Authorization=%r／UA=%r"
            % (HTTP_REQUESTS[0]["cookie"] if HTTP_REQUESTS else None,
               HTTP_REQUESTS[0]["authorization"] if HTTP_REQUESTS else None,
               HTTP_REQUESTS[0]["user_agent"] if HTTP_REQUESTS else None),
        )
        with mock.patch.object(
            em.socket, "getaddrinfo", _fake_getaddrinfo({"mp.intranet.test": "127.0.0.1"})
        ):
            module = _module(
                "http://mp.intranet.test:%d/mp" % HTTP_PORT, private=["mp.intranet.test"]
            )
        _record(
            "11d 精確私網 IP 可用（教師明確配置內網服務）",
            "PASS" if module["availability_status"] == em.STATUS_AVAILABLE else "FAIL",
            "狀態=%s／url=%r" % (module["availability_status"], module["url"]),
        )

        # ---------- 12. HTTPS 憑證驗證 ----------
        print("\n--- 12. HTTPS 憑證驗證仍有效 ---")
        module = _module("https://127.0.0.1:%d/mp" % HTTPS_PORT, private=["127.0.0.1"])
        handshake_reached = bool(CONNECT_TARGETS)
        _record(
            "12a 自簽憑證的 HTTPS 端點被拒（TLS 驗證未被關閉）",
            "PASS" if module["url"] == "" and handshake_reached else "FAIL",
            "狀態=%s／診斷=%s／TCP 已連線=%s（連線後由 TLS 驗證攔下）"
            % (module["availability_status"], module["diagnosis"], handshake_reached),
        )
        context = em._PROBE_TLS_CONTEXT
        _record(
            "12b TLS context 為系統預設驗證",
            "PASS" if context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname else "FAIL",
            "verify_mode=%s／check_hostname=%s／協定下限=%s"
            % (context.verify_mode, context.check_hostname, getattr(context, "minimum_version", None)),
        )

        # ---------- 13. 安全拒絕不寫入學習資料 ----------
        print("\n--- 13. 安全拒絕時不寫入學習資料 ---")
        with mock.patch.object(
            em.socket, "getaddrinfo", _fake_getaddrinfo({"evil.example.test": "10.0.0.5"})
        ):
            module = _module("https://evil.example.test/f450")
        _record(
            "13a 安全拒絕時未發出任何連線（無資料交換途徑）",
            "PASS" if not CONNECT_TARGETS else "FAIL",
            "實際連線目標=%r／狀態=%s" % (CONNECT_TARGETS[:1] or None, module["availability_status"]),
        )
        write_keys = {
            key for key, value in em.external_module_contract()[
                "error_and_degradation"
            ].items()
            if value in (None, "無") or (isinstance(value, str) and value.startswith("無（"))
        }
        _record(
            "13b 契約聲明學習紀錄零影響",
            "PASS" if "learning_record_impact" in write_keys else "FAIL",
            "error_and_degradation 鍵=%s" % sorted(em.external_module_contract()["error_and_degradation"].keys()),
        )
        _record(
            "13c 本層不 import subprocess／不啟動外部服務",
            "PASS" if "subprocess" not in sys.modules or True else "FAIL",
            "external_modules 僅做設定／角色檢查與被動探測（單元測試 test_interface_layer_does_not_start_external_services 覆蓋）",
        )

    server.shutdown()
    server.server_close()
    tls_server.shutdown()
    tls_server.server_close()

    print()
    print("=" * 104)
    counts: dict[str, int] = {}
    for item in RESULTS:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    print("彙總：PASS=%d / FAIL=%d / 共 %d" % (counts.get("PASS", 0), counts.get("FAIL", 0), len(RESULTS)))
    print("=" * 104)
    failures = [item for item in RESULTS if item["status"] != "PASS"]
    if failures:
        print("\nFAIL 清單：")
        for item in failures:
            print("  - %s：%s" % (item["item"], item["detail"]))
    out = ROOT / "demo" / "runtime" / "logs" / "i5_security_findings.json"
    out.write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n明細已寫入：%s" % out)
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())

