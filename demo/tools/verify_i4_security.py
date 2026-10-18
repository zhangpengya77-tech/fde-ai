#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""I4-C 接口安全複查（external_modules.py，HTTP 層實證）。

對應 2026-10-13 教師 I4 指令第五節七問：
  1. URL 是否限定可信配置來源
  2. 是否禁止非預期的內網及 metadata 目標
  3. DNS 解析、重新導向是否可能繞過限制
  4. 是否有短逾時
  5. 是否可能傳送登入憑證
  6. 是否會因服務探測影響正式資料
  7. 未授權使用者是否完全不探測

實證手法：把模組入口指向「本機探測哨兵」（i4_sentinel.py），
以哨兵日誌客觀判定介面層是否真的發出探測（而非只讀程式碼推論）。

用法：python verify_i4_security.py --mode deny|allow
"""
import argparse
import hashlib
import http.cookiejar
import inspect
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = (os.environ.get("I4_SEC_BASE") or "http://127.0.0.1:8120").rstrip("/")
DB_PATH = os.environ.get("I4_DB") or r"D:\FDE-AI-UAS-v2.0\demo\runtime\db\i4_e2e.sqlite3"
SENTINEL_LOG = os.environ.get("I4_SENTINEL_LOG") or r"D:\FDE-AI-UAS-v2.0\demo\runtime\logs\i4_sentinel.log"
STUDENT_EMAIL = "p42-a-0001@fde-p42.local"
ENROLLMENT_ID = 14

PASS, FAIL, SKIP, PENDING = "PASS", "FAIL", "SKIPPED", "PENDING"
RESULTS = []

# 兩種配置的預期（與 run_i4_matrix.sh 傳入的環境變數一致）
# I5-B（2026-10-13 安全修復後）：白名單不再「授予」內網存取權，
# 內網 IP 一律改由 FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS 精確放行。
MODES = {
    "deny": {
        "allowlist": "",
        "private_hosts": "",
        "modules": {
            # 未列私網放行清單的迴路位址 → 安全設定拒絕（不探測）
            "F450_DIGITAL_TWIN": {"url": "http://127.0.0.1:8198/f450-twin", "expect": "服務暫時不可用"},
            # 未列私網放行清單的內網位址 → 安全設定拒絕（不探測）
            "MP_GROUND_STATION": {"url": "http://10.9.9.9:9000/mp", "expect": "服務暫時不可用"},
            # metadata 主機一律拒絕（白名單與私網清單皆不得放行）
            "HQGC_ASSESSMENT": {"url": "http://169.254.169.254/latest/meta-data/", "expect": "服務暫時不可用"},
        },
        "sentinel_must_be_quiet": True,
    },
    "allow": {
        "allowlist": "127.0.0.1",
        "private_hosts": "127.0.0.1",
        "modules": {
            # 白名單（主機名）不授予內網存取 → 仍拒絕
            "F450_DIGITAL_TWIN": {"url": "http://10.9.9.9:9000/twin", "expect": "服務暫時不可用"},
            # 教師精確放行內網 IP + 服務在線 → 已可使用並產生連結
            "MP_GROUND_STATION": {"url": "http://127.0.0.1:8198/mp", "expect": "已可使用", "link": True},
            # metadata 主機一律拒絕（即使出現在白名單也不放行）
            "HQGC_ASSESSMENT": {"url": "http://169.254.169.254/latest/meta-data/", "expect": "服務暫時不可用"},
        },
        "sentinel_must_be_quiet": False,
    },
}

CREDENTIALS_CANDIDATES = [
    os.environ.get("FDE_DEMO_CREDENTIALS_FILE"),
    os.path.expanduser("~/.fde-demo-credentials/demo.shared.password.txt"),
]


def record(name, result, detail=""):
    RESULTS.append((name, result, detail))
    print("%-7s - %s%s" % (result, name, (" | " + detail) if detail else ""))


def check(name, ok, detail=""):
    record(name, PASS if ok else FAIL, detail)


def skip(name, reason):
    record(name, SKIP, reason)


def pending(name, reason):
    record(name, PENDING, reason)


def load_password():
    env_pw = (os.environ.get("FDE_DEMO_STUDENT_PASSWORD") or "").strip()
    if env_pw:
        return env_pw
    for path in CREDENTIALS_CANDIDATES:
        if not path or not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
        for i, line in enumerate(lines):
            if "以下為密碼" in line and "----" in line:
                for nxt in lines[i + 1:]:
                    nxt = nxt.strip()
                    if nxt and not nxt.startswith("----"):
                        return nxt
    return None


PASSWORD = load_password()
if not PASSWORD:
    print("[安全停止] 無法取得驗收密碼。")
    sys.exit(2)

for _k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

# 安全閘：本腳本會 django.setup()，必須確認 DB 指向隔離測試庫，避免誤觸正式資料庫。
_DB_ENV = (os.environ.get("DJANGO_DB_NAME") or "").replace("\\", "/")
if "i4_e2e.sqlite3" not in _DB_ENV:
    print("[安全停止] DJANGO_DB_NAME 必須指向隔離測試庫 i4_e2e.sqlite3，實際為 %r。" % _DB_ENV)
    sys.exit(3)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def new_session():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj), _NoRedirect(), urllib.request.ProxyHandler({})
    )
    return cj, op


def fetch(op, url, headers=None, method="GET", data=None, timeout=30):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", "I4-Security/1.0")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with op.open(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), resp.headers
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), exc.headers
    except Exception as exc:
        return -1, "", {"x-error": "%s: %s" % (type(exc).__name__, exc)}


def login(op):
    login_url = BASE + "/login/"
    status, body, _ = fetch(op, login_url)
    if status != 200:
        return False
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', body)
    if not match:
        return False
    payload = urllib.parse.urlencode(
        {"csrfmiddlewaretoken": match.group(1), "username": STUDENT_EMAIL, "password": PASSWORD, "next": ""}
    ).encode()
    origin = "http://" + urllib.parse.urlsplit(BASE).netloc
    status, _, _ = fetch(
        op, login_url,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": login_url, "Origin": origin},
        method="POST", data=payload,
    )
    return status == 302


def db_fingerprint():
    if not os.path.isfile(DB_PATH):
        return None
    try:
        con = sqlite3.connect("file:{}?mode=ro".format(DB_PATH.replace("\\", "/")), uri=True)
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = sorted(r[0] for r in cur.fetchall())
        digest = hashlib.sha256()
        for table in tables:
            cur.execute('SELECT * FROM "%s"' % table)
            rows = cur.fetchall()
            digest.update(("%s:%d;" % (table, len(rows))).encode())
            for row in rows:
                digest.update(repr(row).encode("utf-8", "replace"))
        con.close()
        return {"sha256": digest.hexdigest(), "tables": len(tables)}
    except Exception as exc:
        return {"error": str(exc)}


def module_cards(html):
    """從工作台取出每個外部模組的 (名稱, 徽章文字, 是否有 <a> 連結)。"""
    cards = []
    for block in re.findall(r'<article class="lp-module.*?</article>', html, re.S):
        name = re.search(r"<strong>(.*?)</strong>", block, re.S)
        badge = re.search(r'class="lp-badge[^"]*">\s*([^<]+?)\s*<', block)
        cards.append(
            {
                "name": re.sub(r"\s+", " ", name.group(1)).strip() if name else "",
                "badge": badge.group(1).strip() if badge else "",
                "has_link": bool(re.search(r"<a\s[^>]*href=", block)),
                "block": block,
            }
        )
    return cards


def sentinel_lines():
    if not os.path.isfile(SENTINEL_LOG):
        return []
    with open(SENTINEL_LOG, "r", encoding="utf-8", errors="replace") as fh:
        return [line for line in fh.read().splitlines() if line.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=sorted(MODES), required=True)
    args = parser.parse_args()
    mode = MODES[args.mode]

    print("=" * 78)
    print("I4-C 接口安全複查｜模式 %s（allowlist=%r, private_hosts=%r）"
          % (args.mode, mode["allowlist"], mode["private_hosts"]))
    print("=" * 78)

    _, op = new_session()
    logged_in = login(op)
    check("學員登入成功（唯讀檢視工作台）", logged_in, "login ok=%s" % logged_in)
    if not logged_in:
        print("無法登入，中止。")
        return 1

    workbench = BASE + "/student/courses/%d/learning-path/" % ENROLLMENT_ID
    # 暖機：登入與首次載入會寫入 session／last_login／既有進度列（產品既有行為），
    # 故指紋基準點取在暖機之後，才能精確量測「複查動作本身」是否寫入資料。
    fetch(op, workbench)
    baseline = db_fingerprint()

    status, body, _ = fetch(op, workbench)
    check("五階段工作台 HTTP 200（設定不當不得拖垮工作台）", status == 200, "HTTP %s" % status)

    cards = module_cards(body)
    check("工作台顯示 3 個外部模組卡片", len(cards) == 3, "實際 %d 個" % len(cards))

    print("\n-- 逐模組：URL 可信來源／內網與 metadata 阻擋／不探測 --")
    by_name = {card["name"]: card for card in cards}
    name_map = {
        "F450_DIGITAL_TWIN": "F450 數位孿生",
        "MP_GROUND_STATION": "MP 地面站（預留）",
        "HQGC_ASSESSMENT": "HQGC 考核（預留）",
    }
    for module_id, spec in mode["modules"].items():
        card = by_name.get(name_map[module_id])
        if card is None:
            check("%s 卡片存在" % module_id, False, "找不到卡片")
            continue
        check(
            "%s 狀態為「%s」" % (module_id, spec["expect"]),
            card["badge"] == spec["expect"],
            "實際「%s」" % card["badge"],
        )
        if spec.get("link"):
            check("%s 已可使用時產生連結" % module_id, card["has_link"], "has_link=%s" % card["has_link"])
            check(
                "%s 已可使用時連結指向設定的入口 URL" % module_id,
                ('href="%s"' % spec["url"]) in card["block"],
                "url=%s" % spec["url"],
            )
        else:
            check("%s 非已可使用時不得產生連結" % module_id, not card["has_link"],
                  "has_link=%s" % card["has_link"])
            check("%s 的 URL 不得出現在頁面" % module_id, spec["url"] not in body,
                  "url=%s" % spec["url"])

    print("\n-- 探測哨兵（客觀證據） --")
    lines = sentinel_lines()
    hits_loopback = [line for line in lines if "/mp" in line or "/f450-twin" in line]
    if mode["sentinel_must_be_quiet"]:
        check("未通過安全檢查的入口完全未被探測（哨兵日誌為空）", not hits_loopback,
              "哨兵命中 %d 筆：%s" % (len(hits_loopback), hits_loopback[:3]))
    else:
        check("白名單允許且在線的入口確實被探測（哨兵有紀錄）", bool(hits_loopback),
              "哨兵命中 %d 筆：%s" % (len(hits_loopback), hits_loopback[:3]))
        check("探測方法為 HEAD（輕量、不取內容）",
              all(line.startswith("HEAD ") for line in hits_loopback),
              "%s" % hits_loopback[:2])

    print("\n-- 其他六問（程式碼／契約層） --")
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "..", "student_portal"))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()
    import learning.external_modules as mod

    src_probe = (
        inspect.getsource(mod._probe_pinned)
        + inspect.getsource(mod._PinnedHTTPConnection)
        + inspect.getsource(mod._PinnedHTTPSConnection)
    )
    # 以「實際送出的標頭」為準（避免文件字串造成假陽性；本檔 2026-10-13 收緊）。
    src_req = inspect.getsource(mod._probe_pinned)
    check("探測僅送 User-Agent，不送 Cookie／Authorization 等登入憑證",
          'headers={"User-Agent": PROBE_USER_AGENT}' in src_req and src_req.count("headers=") == 1,
          "僅送 User-Agent（其餘標頭一律未設定）")
    check("探測不跟隨重新導向（無法以重導繞過 URL 限制）",
          "getresponse" in src_probe
          and "HTTPRedirectHandler" not in src_probe
          and "redirect" not in src_probe.replace("重新導向", "").lower(),
          "http.client 單次取回應，無重新導向處理器")
    check("探測 IP 已釘選（不重新解析 DNS，無法重綁定繞過）",
          src_probe.count("create_connection((self._pinned_ip") == 2
          and src_probe.count("raise OSError(\"pinned_ip_required\")") == 2,
          "連線目標 = 安全檢查經驗證的 IP；未釘選即拋錯、不退回 hostname")
    src_url = inspect.getsource(mod.get_external_module) + inspect.getsource(mod.validate_entry_url)
    check("URL 僅來自伺服器端設定（不接受請求輸入）",
          not any(token in src_url for token in ("request.", "query_params", "POST.get", "GET.get")),
          "來源：settings.FDE_EXTERNAL_MODULES")
    timeout = mod._probe_timeout()
    check("探測逾時短且明確（<= 5 秒）", timeout <= 5.0, "%.1f 秒" % timeout)
    safety = mod.external_module_contract()["url_safety"]
    check("契約聲明 DNS 解析已檢查", safety["dns_resolution_checked"] is True, "")
    check("契約聲明白名單不再授予內網存取（allowlist_precedence=False）",
          safety["allowlist_precedence"] is False and safety["allowlist_grants_private_access"] is False,
          "內網 IP 改由 FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS 精確放行")
    check("契約聲明私網放行清單不使用通配符", safety["private_allowlist_wildcards"] is False, "")
    check("契約聲明探測不寫入資料", safety["probe_writes_data"] is False, "")
    check("契約聲明探測方法為 HEAD", safety["probe_method"] == "HEAD", "")
    check("契約聲明連線使用釘選 IP（每次探測僅 1 次 DNS）",
          safety["pinned_ip_used_for_connection"] is True and safety["dns_lookups_per_probe"] == 1, "")
    check("契約聲明 DNS 失敗為 fail-closed（不得放行）",
          safety["dns_failure_is_fail_closed"] is True, "")
    check("契約聲明 metadata／localhost 一律拒絕", safety["metadata_and_localhost_always_denied"] is True, "")

    src_all = inspect.getsource(mod)
    check("本層不自動啟動外部服務（無 subprocess／Popen／os.system／startfile）",
          not any(t in src_all for t in ("subprocess", "os.system", "Popen", "os.startfile")), "")

    print("\n-- 白名單不得繞過位址判定（I5-B R2 回歸證據） --")
    from django.test import override_settings

    calls = []

    def _prober(url):
        calls.append(url)
        return True

    # 僅列白名單、未列私網放行清單 → 必須拒絕（I5-B 修復前此情境會被放行）
    with override_settings(
        FDE_EXTERNAL_MODULES={"HQGC_ASSESSMENT": {"enabled": True,
                                                 "entry_url": "http://127.0.0.1:8198/hqgc"}},
        FDE_EXTERNAL_MODULE_PROBER=_prober,
        FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=["127.0.0.1"],
        FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=[],
    ):
        mod.clear_probe_cache()
        module = mod.get_external_module("HQGC_ASSESSMENT", role="teacher")
    check("僅有白名單時內網位址仍被拒", module["state"] == "服務暫時不可用", "state=%s" % module["state"])
    check("僅有白名單時完全未探測（未到達探測階段）", calls == [], "prober calls=%s" % calls)

    # 精確列入私網放行清單 → 允許並探測
    with override_settings(
        FDE_EXTERNAL_MODULES={"HQGC_ASSESSMENT": {"enabled": True,
                                                 "entry_url": "http://127.0.0.1:8198/hqgc"}},
        FDE_EXTERNAL_MODULE_PROBER=_prober,
        FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=[],
        FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["127.0.0.1"],
    ):
        mod.clear_probe_cache()
        module = mod.get_external_module("HQGC_ASSESSMENT", role="teacher")
    check("精確私網放行清單允許內網位址", module["state"] == "已可使用", "state=%s" % module["state"])
    check("放行後確實發出探測", calls == ["http://127.0.0.1:8198/hqgc"], "prober calls=%s" % calls)

    # 通配符不得生效（私網放行清單僅接受精確主機名／IP）
    with override_settings(
        FDE_EXTERNAL_MODULES={"HQGC_ASSESSMENT": {"enabled": True,
                                                 "entry_url": "http://127.0.0.1:8198/hqgc"}},
        FDE_EXTERNAL_MODULE_PROBER=_prober,
        FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=[],
        FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["*", "*.internal"],
    ):
        mod.clear_probe_cache()
        module = mod.get_external_module("HQGC_ASSESSMENT", role="teacher")
    check("私網放行清單不接受通配符", module["state"] == "服務暫時不可用", "state=%s" % module["state"])

    print("\n-- 未授權者不探測（角色不符先於探測） --")

    calls = []
    with override_settings(
        FDE_EXTERNAL_MODULES={"HQGC_ASSESSMENT": {"enabled": True, "entry_url": "http://127.0.0.1:8198/hqgc",
                                                 "allowed_roles": ["teacher"]}},
        FDE_EXTERNAL_MODULE_PROBER=_prober,
        FDE_EXTERNAL_MODULE_ALLOWED_HOSTS=["127.0.0.1"],
        FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["127.0.0.1"],
    ):
        mod.clear_probe_cache()
        module = mod.get_external_module("HQGC_ASSESSMENT", role="student")
    check("未授權角色（學員）得到「權限不足」", module["state"] == "權限不足", "state=%s" % module["state"])
    check("未授權角色完全不發出探測", calls == [], "prober calls=%s" % calls)

    print("\n-- 不影響正式資料（逐表指紋；基準點取於暖機後） --")
    after = db_fingerprint()
    if baseline and after and "sha256" in baseline and "sha256" in after:
        check("複查動作前後資料庫指紋一致（探測與渲染皆未寫入任何紀錄）",
              baseline["sha256"] == after["sha256"],
              "%d 張表 %s" % (after["tables"], after["sha256"][:16]))
    else:
        skip("複查動作前後資料庫指紋一致", "無法讀取測試庫")

    pending("真實 iPhone Safari 人工驗收", "須教師以實機確認（見 I4-E 測試表）。")

    print("\n" + "=" * 78)
    tally = {PASS: 0, FAIL: 0, SKIP: 0, PENDING: 0}
    for _, result, _ in RESULTS:
        tally[result] += 1
    print("MODE=%s PASS=%d FAIL=%d SKIPPED=%d PENDING=%d TOTAL=%d"
          % (args.mode, tally[PASS], tally[FAIL], tally[SKIP], tally[PENDING], len(RESULTS)))
    if tally[FAIL]:
        print("\n失敗項目：")
        for name, result, detail in RESULTS:
            if result == FAIL:
                print("  FAIL - %s | %s" % (name, detail))
    print("=" * 78)
    return 1 if tally[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
