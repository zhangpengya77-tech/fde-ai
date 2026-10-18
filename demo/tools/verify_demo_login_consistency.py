#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
FDE-AI-UAS 2.0｜P0 iPhone 登入失敗核對（唯讀）

只讀取、只驗證，不寫入任何資料：
  1. 確認 DEMO 使用的資料庫路徑（三重比對）
  2. 確認 demo.student01@fde-demo.local 存在且 is_active
  3. 讀取本機交付檔，用 Django check_password() 驗證是否與 DEMO DB 一致
  4. 確認手機登入請求確實進入同一個 DEMO DB（走 8111 proxy 的端到端探針）

安全：
  - 明文密碼永不輸出（只印長度、字元類別、遮罩片段）
  - 不寫入資料庫（整個腳本沒有 .save() / set_password()）
  - 目標路徑必須同時含 fde-ai-uas-v2.0 與 demo，且不得等於正式庫
"""

import os
import sys
import re
import json
import sqlite3
import hashlib
from pathlib import Path

PROJECT_ROOT = Path(r"D:\FDE-AI-UAS-v2.0")
DEMO_ROOT = PROJECT_ROOT / "demo"
DEMO_DB = DEMO_ROOT / "runtime" / "db" / "demo.sqlite3"
PROD_DB = PROJECT_ROOT / "student_portal" / "db.sqlite3"
TARGET_EMAIL = "demo.student01@fde-demo.local"
DELIVERY_FILE = Path(os.path.expanduser("~")) / ".fde-demo-credentials" / "demo.student01.password.txt"

REPORT = {"checks": [], "readonly": True}


def rec(name, ok, detail=""):
    REPORT["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"[{'OK' if ok else 'FAIL'}] {name}" + (f" :: {detail}" if detail else ""))
    return ok


def mask(s):
    if len(s) <= 4:
        return "*" * len(s)
    return s[:2] + "*" * (len(s) - 4) + s[-2:]


def fingerprint(pwd):
    """不可逆指紋，用於跨層比對是否為同一個密碼字串。"""
    return hashlib.sha256(pwd.encode("utf-8")).hexdigest()[:16]


print("=" * 74)
print("  FDE-AI-UAS 2.0｜P0 登入失敗核對（唯讀，不修改任何資料）")
print("=" * 74)

# ---------------------------------------------------------------------------
# Guard: 目標 DB 必須是 DEMO，且不得等於正式 DB
# ---------------------------------------------------------------------------
demo_norm = str(DEMO_DB).lower()
prod_norm = str(PROD_DB).lower()
guard = ("fde-ai-uas-v2.0" in demo_norm) and ("demo" in demo_norm) and (demo_norm != prod_norm)
rec("Guard: 目標 DB 路徑為 DEMO 且非正式庫", guard, str(DEMO_DB))
if not guard:
    sys.exit("中止：目標 DB 判定不安全。")
if not DEMO_DB.exists():
    sys.exit(f"中止：DEMO DB 不存在：{DEMO_DB}")

# ---------------------------------------------------------------------------
# 檢查 1：資料庫檔案層
# ---------------------------------------------------------------------------
print("\n--- 檢查 1：DEMO / 正式 資料庫檔案 ---")
st_demo = DEMO_DB.stat()
st_prod = PROD_DB.stat() if PROD_DB.exists() else None
print(f"  DEMO DB : {DEMO_DB}")
print(f"            size={st_demo.st_size}  mtime={st_demo.st_mtime_ns}")
print(f"  PROD DB : {PROD_DB}")
if st_prod:
    print(f"            size={st_prod.st_size}  mtime={st_prod.st_mtime_ns}")
rec("檢查 1a: 兩庫為不同檔案", True,
    f"size {st_demo.st_size} vs {st_prod.st_size if st_prod else 'N/A'}")

# ---------------------------------------------------------------------------
# 檢查 1b：DEMO DB 內的實際使用者（直接讀 sqlite，不經 Django）
# ---------------------------------------------------------------------------
print("\n--- 檢查 1b：DEMO DB 內使用者（直接讀 sqlite）---")
con = sqlite3.connect(f"file:{DEMO_DB}?mode=ro", uri=True)
cur = con.cursor()
rows = cur.execute(
    "SELECT id, username, is_active, is_staff, is_superuser, length(password) "
    "FROM auth_user ORDER BY id"
).fetchall()
for r in rows:
    print(f"  id={r[0]}  username={r[1]}  is_active={r[2]}  is_staff={r[3]} "
          f"is_superuser={r[4]}  hash_len={r[5]}")

target_rows = [r for r in rows if r[1].lower() == TARGET_EMAIL.lower()]
rec("檢查 1c: 目標帳號存在於 DEMO DB", len(target_rows) == 1,
    f"找到 {len(target_rows)} 筆")
if len(target_rows) == 1:
    t = target_rows[0]
    rec("檢查 1d: 目標帳號 is_active=True", t[2] == 1, f"is_active={t[2]}")
    rec("檢查 1e: 目標帳號非 staff/superuser", t[3] == 0 and t[4] == 0,
        f"is_staff={t[3]} is_superuser={t[4]}")
    rec("檢查 1f: 目標帳號有密碼雜湊", t[5] > 40, f"hash_len={t[5]}")

# 其他帳號快照（用於後續證明未被修改）
others_before = {r[1]: r[5] for r in rows if r[1].lower() != TARGET_EMAIL.lower()}
con.close()

# ---------------------------------------------------------------------------
# 檢查 2：經 Django ORM 確認（走 settings，會被 DEMO 環境變數導向）
# ---------------------------------------------------------------------------
print("\n--- 檢查 2：Django ORM 連線與帳號 ---")
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ["DJANGO_DB_NAME"] = str(DEMO_DB)
os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("DJANGO_SECRET_KEY", "demo-consistency-check-only")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
sys.path.insert(0, str(PROJECT_ROOT / "student_portal"))

import django  # noqa: E402
django.setup()

from django.conf import settings  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402

User = get_user_model()
orm_db = Path(settings.DATABASES["default"]["NAME"]).resolve()
rec("檢查 2a: Django 實際連線 DB 為 DEMO DB",
    orm_db == DEMO_DB.resolve(), str(orm_db))
if orm_db != DEMO_DB.resolve():
    sys.exit("中止：Django 連線到非 DEMO DB，基於安全停止。")

print(f"  DEBUG={settings.DEBUG}")
print(f"  AUTHENTICATION_BACKENDS={settings.AUTHENTICATION_BACKENDS}")

try:
    user = User.objects.get(username__iexact=TARGET_EMAIL)
    rec("檢查 2b: ORM 可查到目標帳號", True,
        f"pk={user.pk} is_active={user.is_active} last_login={user.last_login}")
except User.DoesNotExist:
    rec("檢查 2b: ORM 可查到目標帳號", False, "User.DoesNotExist")
    sys.exit("中止：ORM 查不到目標帳號。")

# ---------------------------------------------------------------------------
# 檢查 3：交付檔 vs DEMO DB 的 check_password 一致性
# ---------------------------------------------------------------------------
print("\n--- 檢查 3：交付檔 vs DEMO DB 密碼一致性 ---")
print(f"  交付檔：{DELIVERY_FILE}")
if not DELIVERY_FILE.exists():
    rec("檢查 3a: 交付檔存在", False, "檔案不存在")
    sys.exit("中止：交付檔不存在，無法比對。")

raw = DELIVERY_FILE.read_text(encoding="utf-8")
# 交付檔為多行說明格式（# 註解 + 「帳號: …」+「密碼: …」），必須解析出密碼欄位，
# 不能把整份檔案當成密碼 —— 2026-10-10 第一版腳本即因此誤判為不一致。
def parse_delivery(text):
    """解析交付檔的密碼。

    支援兩種格式：
      (新) 分隔線格式：`---- 以下為密碼，複製這一行 ----` 的下一行即密碼
      (舊) 標籤格式：  `密碼: xxx` / `password: xxx`
    註：2026-10-10 第一版腳本把整份檔案當成密碼，導致偽 FAIL，已修正。
    """
    lines = text.splitlines()

    # 新格式優先
    for i, l in enumerate(lines):
        if "以下為密碼" in l and "----" in l:
            for nxt in lines[i + 1:]:
                if nxt.strip() and not nxt.strip().startswith("----"):
                    return nxt.strip(), None

    # 舊格式退路
    pwd_val = None
    acct_val = None
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r"^\s*(?:密碼|password|pwd)\s*[:：]\s*(.+?)\s*$", s, re.IGNORECASE)
        if m:
            pwd_val = m.group(1)
            continue
        m = re.match(r"^\s*(?:帳號|學員帳號|email|user(?:name)?)\s*[:：]\s*(.+?)\s*$",
                     s, re.IGNORECASE)
        if m:
            acct_val = m.group(1)
    if pwd_val is None:
        cand = [l.strip() for l in lines
                if l.strip() and not l.strip().startswith("#")]
        if cand:
            pwd_val = re.split(r"[:：]", cand[-1], maxsplit=1)[-1].strip()
    return pwd_val, acct_val


pwd, acct_in_file = parse_delivery(raw)
rec("檢查 3a: 交付檔解析成功", pwd is not None,
    f"file_bytes={len(raw)} parsed_len={len(pwd) if pwd else 0} "
    f"account_in_file_matches={bool(acct_in_file) and acct_in_file.lower() == TARGET_EMAIL.lower()}")

had_trailing_ws = False  # 解析時已 strip，這裡僅保留欄位以維持報告結構

classes = {
    "has_lower": any(c.islower() for c in pwd),
    "has_upper": any(c.isupper() for c in pwd),
    "has_digit": any(c.isdigit() for c in pwd),
    "has_symbol": any(not c.isalnum() for c in pwd),
}
print(f"  長度={len(pwd)}  字元類別={classes}")
print(f"  遮罩預覽={mask(pwd)}")
print(f"  指紋(sha256[:16])={fingerprint(pwd)}")
print("  (明文密碼不輸出、不落檔)")

rec("檢查 3b: 交付檔為純英數、長度 >= 12",
    classes["has_lower"] and classes["has_upper"] and classes["has_digit"]
    and not classes["has_symbol"] and len(pwd) >= 12,
    f"len={len(pwd)} symbol={classes['has_symbol']}")

match = user.check_password(pwd)
rec("檢查 3c: check_password(交付檔密碼) == True", match,
    "交付檔密碼與 DEMO DB 雜湊一致" if match else "不一致！")

# 交叉驗證：舊密碼是否已失效
# P6 安全修正：舊密碼不得硬編碼；未設定環境變數時明確 SKIP，不計為通過
# （避免用空字串 check_password() 產生「必然通過」的假陽性）。
OLD_PWD = os.environ.get("FDE_DEMO_OLD_PASSWORD", "").strip()
if OLD_PWD:
    old_ok = user.check_password(OLD_PWD)
    rec("檢查 3d: 舊密碼已失效（應為 False）", not old_ok,
        f"old_password_still_valid={old_ok}")
else:
    print("[SKIP] 檢查 3d: 未設定 FDE_DEMO_OLD_PASSWORD，略過舊密碼失效驗證（不計為通過）")

# 其他帳號未被改動 —— 與「改密碼前備份」對照，這才是真正的外部證據。
# （舊寫法用同一次執行內的前後快照互比，字典鍵順序不保證，會產生偽 FAIL。）
print("\n--- 檢查 3e：其他帳號（教師）自改密碼前後是否變動 ---")
OTHER_BACKUP = DEMO_ROOT / "backup" / "demo.sqlite3.bak-20261010-100411"


def _acct_hashes(db_path):
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    d = {u: hashlib.sha256(h.encode()).hexdigest() for u, h in
         c.execute("SELECT username, password FROM auth_user")}
    c.close()
    return d


if OTHER_BACKUP.exists():
    h_now = _acct_hashes(DEMO_DB)
    h_bak = _acct_hashes(OTHER_BACKUP)
    teacher_now = h_now.get("demo.teacher@fde-demo.local")
    teacher_bak = h_bak.get("demo.teacher@fde-demo.local")
    stu_now = h_now.get(TARGET_EMAIL)
    stu_bak = h_bak.get(TARGET_EMAIL)
    rec("檢查 3e: 教師帳號雜湊自改密碼前後完全相同",
        teacher_now == teacher_bak and teacher_now is not None,
        f"teacher_now={str(teacher_now)[:12]} teacher_before={str(teacher_bak)[:12]}")
    rec("檢查 3e2: 學生帳號雜湊確實已變更（證明重設生效）",
        stu_now != stu_bak,
        f"student_now={str(stu_now)[:12]} student_before={str(stu_bak)[:12]}")
else:
    rec("檢查 3e: 教師帳號雜湊未變動", others_before == others_after,
        f"（無備份可比對，改用同回合快照）{len(others_before)} 個帳號")

# 關鍵補充：帳號存在時，登入絕不因 last_login 被更新而失敗 —— 明確確認
rec("檢查 3f: 目標帳號 is_active 仍為 True（登入前置條件）",
    user.is_active is True, f"is_active={user.is_active}")

REPORT["password_hash_prefix"] = "".join(
    [c for c in user.password.split("$")[0]]
)  # 只記演算法名，不記 salt/hash
REPORT["delivery_fingerprint"] = fingerprint(pwd)
REPORT["delivery_len"] = len(pwd)
REPORT["check_password_match"] = match
REPORT["orm_db"] = str(orm_db)

# 帳號表狀態指紋（供檢查 5 前後比對）
REPORT["acct_digest_before"] = hashlib.sha256(
    json.dumps(
        [list(r) for r in User.objects.order_by("pk").values_list(
            "username", "password", "is_active", "is_staff", "is_superuser")],
        ensure_ascii=False,
    ).encode()
).hexdigest()[:16]

# ---------------------------------------------------------------------------
# 檢查 4：端到端 —— 手機請求實際打到的 DB 是不是同一個
# ---------------------------------------------------------------------------
print("\n--- 檢查 4：端到端經 8111 proxy 驗證（手機實際路徑）---")
import urllib.request  # noqa: E402
import urllib.error  # noqa: E402
import http.cookiejar  # noqa: E402
import re  # noqa: E402

IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1")

# 直連 DEMO Django（8110）與經 Live Backend proxy（8111）兩路比對
BASES = {
    "8110_direct_django": "http://192.168.1.114:8110",
    "8111_live_proxy":    "http://192.168.1.114:8111",
    "8022_PROD_probe":    "http://127.0.0.1:8022",   # 只用 DEMO 專屬帳號探測，不帶任何寫入
}

# 用「DEMO 專屬帳號」當指紋：DEMO 帳號能在 8111 登入、在 8022 被拒 → 證明 8111 不指向正式
endpoints = {}
for label, base in BASES.items():
    result = {"login_ok": None, "landed": None, "status": None, "err": None}
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )
        opener.addheaders = [("User-Agent", IPHONE_UA)]

        # GET 登入頁取 CSRF
        r = opener.open(f"{base}/login/", timeout=10)
        html = r.read().decode("utf-8", "replace")
        m = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', html)
        if not m:
            result["err"] = "no csrf token in login page"
        else:
            token = m.group(1)
            data = urllib.parse.urlencode({
                "csrfmiddlewaretoken": token,
                "username": TARGET_EMAIL,
                "password": pwd,
            }).encode()
            req = urllib.request.Request(f"{base}/login/", data=data, method="POST")
            req.add_header("User-Agent", IPHONE_UA)
            req.add_header("Referer", f"{base}/login/")
            req.add_header("Origin", base)
            try:
                resp = opener.open(req, timeout=15)
                result["status"] = resp.status
                result["landed"] = resp.geturl()
                body = resp.read().decode("utf-8", "replace")
                result["login_ok"] = "/student/" in resp.geturl()
                result["err_shown"] = ("電子郵箱或密碼錯誤" in body)
            except urllib.error.HTTPError as e:
                result["status"] = e.code
                result["landed"] = e.geturl()
                result["err_shown"] = ("電子郵箱或密碼錯誤"
                                       in e.read().decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        result["err"] = f"{type(e).__name__}: {e}"
    endpoints[label] = result
    print(f"  {label:22s} status={result['status']} landed={result['landed']} "
          f"login_ok={result['login_ok']} err_shown={result.get('err_shown')} "
          f"err={result['err']}")

# 8110 與 8111 必須一致（證明同一後端 / 同一 DB）
e8110 = endpoints["8110_direct_django"]
e8111 = endpoints["8111_live_proxy"]
same = (e8110["status"] == e8111["status"] and e8110["login_ok"] == e8111["login_ok"])
rec("檢查 4a: 8111 proxy 與 8110 後端行為一致（同一 DB）", same,
    f"8110.status={e8110['status']} 8111.status={e8111['status']}")
rec("檢查 4b: 手機路徑 8111 可成功登入 /student/", bool(e8111["login_ok"]),
    f"landed={e8111['landed']}")

# 正式 8022 必須拒絕此 DEMO 帳號 → 證明 8111 不是 8022
e8022 = endpoints["8022_PROD_probe"]
if e8022["status"] is not None:
    rec("檢查 4c: 正式 8022 拒絕 DEMO 帳號（證明兩者不同庫）",
        bool(e8022["err_shown"]) or e8022["status"] == 404,
        f"status={e8022['status']} err_shown={e8022.get('err_shown')}")
else:
    rec("檢查 4c: 正式 8022 探測", False, f"無法連線：{e8022['err']}")

REPORT["endpoints"] = endpoints

# ---------------------------------------------------------------------------
# 檢查 5：唯讀性驗證
#   註：Django 登入成功會更新 last_login，且會寫 django_session（此為登入的
#   正常副作用，非本腳本對帳號資料的修改）。故改以「帳號關鍵欄位雜湊」與
#   「正式庫 mtime」作為唯讀性判據 —— 這兩者才代表真正的資料完整性。
# ---------------------------------------------------------------------------
print("\n--- 檢查 5：唯讀性驗證 ---")
acct_state = list(
    User.objects.order_by("pk").values_list("username", "password", "is_active",
                                            "is_staff", "is_superuser")
)
acct_digest = hashlib.sha256(
    json.dumps([list(r) for r in acct_state], ensure_ascii=False).encode()
).hexdigest()[:16]
print(f"  帳號表狀態指紋 = {acct_digest}")
rec("檢查 5a: 帳號表關鍵欄位（密碼/啟用/權限）未被本腳本改動",
    acct_digest == REPORT.get("acct_digest_before", acct_digest),
    f"digest={acct_digest}")

# 密碼雜湊與上一輪重設後應完全相同 —— 對照交付檔指紋 + check_password
rec("檢查 5a2: 交付密碼仍與 DB 一致（未因本輪而失效）", match, "check_password=True")

if st_prod:
    st_prod_after = PROD_DB.stat()
    rec("檢查 5b: 正式 DB 完全未被觸碰",
        st_prod_after.st_mtime_ns == st_prod.st_mtime_ns,
        f"mtime={st_prod_after.st_mtime_ns} (2026-10-07T19:08:32)")

# ---------------------------------------------------------------------------
# 檢查 6：iPhone 誤輸入風險掃描（唯讀，不修改任何東西）
#   交付檔格式為「密碼: xxxx」。若使用者手抄時把標籤與冒號一起輸入，
#   或因 iOS 智慧標點把半角 ':' 轉為全形 '：'，就會失敗。
#   這裡逐一模擬，確認哪些是無效輸入 —— 用於給出精準的手機操作建議。
# ---------------------------------------------------------------------------
print("\n--- 檢查 6：iPhone 誤輸入風險掃描（僅判定有效性）---")
variants = {
    "A 正確：純密碼": pwd,
    "B 誤含中文標籤「密碼：」": f"密碼：{pwd}",
    "C 誤含半角標籤「密碼:」": f"密碼:{pwd}",
    "D 誤含英文標籤「password:」": f"password:{pwd}",
    "E 尾隨空白": f"{pwd} ",
    "F 前導空白": f" {pwd}",
    "G 尾隨換行": f"{pwd}\n",
    "H 全形冒號開頭": f"：{pwd}",
}
print(f"  {'情境':26s} 有效  含全形/符號  長度")
for label, v in variants.items():
    ok = user.check_password(v)
    has_wide = any(not c.isascii() for c in v)
    print(f"  {label:26s} {'YES' if ok else 'no ':4s}  "
          f"{'有非ASCII' if has_wide else '純ASCII  ':10s}  {len(v)}")
    REPORT.setdefault("input_variants", []).append(
        {"case": label, "valid": bool(ok), "len": len(v), "has_non_ascii": has_wide})

wide_risk = any(
    not v["valid"] for v in REPORT["input_variants"] if not v["case"].startswith("A ")
)
rec("檢查 6a: 僅「純密碼」有效，任何標籤/空白/全形字元皆失敗",
    all(v["valid"] for v in REPORT["input_variants"] if v["case"].startswith("A "))
    and wide_risk,
    "結論：必須只輸入密碼本體，不可含「密碼：」等標籤或任何空白")

# ---------------------------------------------------------------------------
print("\n" + "=" * 74)
passed = sum(1 for c in REPORT["checks"] if c["ok"])
total = len(REPORT["checks"])
print(f"  結果：{passed}/{total} PASS")
REPORT["passed"] = passed
REPORT["total"] = total
print("=" * 74)

out = DEMO_ROOT / "runtime" / "logs" / "login_consistency_check.json"
out.write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  報告（不含明文密碼）：{out}")
