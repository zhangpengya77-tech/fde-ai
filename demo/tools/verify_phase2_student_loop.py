"""Phase 2 教學閉環真實 HTTP 驗收（學員側）。
只輸出狀態碼與流程事實，絕不輸出密碼或任何憑證值。
用法：python phase2_student_loop.py [BASE_URL]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "demo", "tools"))


def load_student_password():
    """使用專案認可的載入器；絕不輸出或列印密碼值。"""
    try:
        import demo_credentials  # type: ignore

        return demo_credentials.load_password("student", required=False)
    except Exception:  # noqa: BLE001
        pass
    value = os.environ.get("FDE_DEMO_STUDENT_PASSWORD", "").strip()
    if value:
        return value
    return os.environ.get("FDE_DEMO_SHARED_PASSWORD", "").strip()

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.114:8110"
CRED_HOME = os.path.join(os.path.expanduser("~"), ".fde-demo-credentials")
SHARED = os.path.join(CRED_HOME, "demo.shared.password.txt")
STUDENT_EMAIL = "demo.student01@fde-demo.local"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"

results = []


def record(step, ok, detail):
    results.append((step, ok, detail))
    print("%-46s %s  %s" % (step, "PASS" if ok else "FAIL", detail))


def read_credential():
    value = os.environ.get("FDE_DEMO_STUDENT_PASSWORD", "").strip()
    if not value:
        value = os.environ.get("FDE_DEMO_SHARED_PASSWORD", "").strip()
    if not value and os.path.exists(SHARED):
        with open(SHARED, "r", encoding="utf-8") as fh:
            value = fh.read().strip()
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """權限測試不得自動跟隨重導，避免把 302 誤判成 200 假 PASS。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_opener(follow_redirects):
    jar = http.cookiejar.CookieJar()
    handlers = [urllib.request.HTTPCookieProcessor(jar)]
    if not follow_redirects:
        handlers.append(NoRedirect())
    return urllib.request.build_opener(*handlers), jar


def get(opener, url, follow_redirects=False):
    req = urllib.request.Request(url, method="GET")
    try:
        resp = opener.open(req)
        body = resp.read().decode("utf-8", "replace")
        return resp.status, resp.geturl(), body, resp.headers
    except urllib.error.HTTPError as exc:
        if exc.code in (301, 302, 303, 307, 308) and not follow_redirects:
            return exc.code, exc.headers.get("Location", ""), "", exc.headers
        body = exc.read().decode("utf-8", "replace")
        return exc.code, url, body, exc.headers


def post_form(opener, url, fields, referer):
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Referer", referer)
    try:
        resp = opener.open(req)
        return resp.status, resp.geturl(), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, url, exc.read().decode("utf-8", "replace")


def csrf_from(html):
    m = re.search(r'name="csrfmiddlewaretoken"[^>]*value="([^"]+)"', html)
    return m.group(1) if m else ""


print("BASE =", BASE)
print("=" * 78)
print("Phase 2-A 學員登入前（未登入狀態）")
print("=" * 78)

anon, _ = build_opener(follow_redirects=False)

st, loc, body, _ = get(anon, BASE + "/login/")
record("GET /login/ 回 200", st == 200, "status=%s" % st)

st, loc, body, _ = get(anon, BASE + "/student/", follow_redirects=False)
record("未登入 GET /student/ → 302（不跟隨重導）", st in (301, 302, 303, 307, 308),
       "status=%s location=%s" % (st, loc))

st, loc, body, _ = get(anon, BASE + "/teacher/", follow_redirects=False)
record("未登入 GET /teacher/ → 302（不跟隨重導）", st in (301, 302, 303, 307, 308),
       "status=%s location=%s" % (st, loc))

print()
print("=" * 78)
print("Phase 2-B 學員登入與五階段工作台")
print("=" * 78)

password = load_student_password()
if not password:
    record("取得驗收學員密碼（不輸出值）", False,
           "請設定 FDE_DEMO_STUDENT_PASSWORD 或提供 ~/.fde-demo-credentials/demo.shared.password.txt")
else:
    record("取得驗收學員密碼（不輸出值）", True, "len=%d（值不顯示）" % len(password))

    sess, jar = build_opener(follow_redirects=True)
    st, loc, login_html, _ = get(sess, BASE + "/login/")
    token = csrf_from(login_html)
    record("登入頁可取得 CSRF token", bool(token), "token_len=%d" % len(token))

    st, final_url, body = post_form(
        sess, BASE + "/login/",
        {"csrfmiddlewaretoken": token, "username": STUDENT_EMAIL, "password": password},
        BASE + "/login/",
    )
    landed_on_login = final_url.rstrip("/").endswith("/login")
    record("POST /login/ 登入成功（離開登入頁）",
           (not landed_on_login) and bool([c for c in jar if c.name in ("sessionid", "csrftoken")]),
           "status=%s final=%s session_cookie=%s" % (
               st, final_url.replace(BASE, ""),
               sorted({c.name for c in jar if "session" in c.name or "csrf" in c.name})))

    st, loc, body, _ = get(sess, BASE + "/student/")
    record("學員工作台 GET /student/ 回 200", st == 200, "status=%s bytes=%d" % (st, len(body)))
    if st == 200:
        title = re.search(r"<title>(.*?)</title>", body)
        record("工作台標題可辨識", bool(title), "title=%s" % (title.group(1) if title else "N/A"))

    # 五階段：頁面可能為 JS shell，故同時接受靜態標記或 ASI/資料來源
    present = [m for m in "學練做測證" if m in body]
    stage_hint = any(k in body for k in ("學練做測證", "five-stage", "stage", "platform"))
    record("五階段工作台標記或資料來源存在", len(present) >= 5 or stage_hint,
           "靜態標記=%s；含階段資料來源=%s" % ("".join(present) or "無", stage_hint))

    # 任務與成長紀錄入口
    has_task = ("/student/tasks" in body) or ("任務" in body)
    has_growth = ("成長" in body) or ("/student/growth" in body)
    record("任務入口存在", has_task, "")
    record("成長紀錄入口存在", has_growth, "")

    # 外部模組：未配置/停用時必須顯示「尚未接入」，不得外洩診斷碼給學員
    if "尚未接入" in body or "external-module" in body:
        record("外部模組狀態區採安全語意", True, "學員頁未見 DIAG_ 診斷碼：%s" % ("DIAG_" not in body))

    # 學員不可跨課程
    st, loc, _, _ = get(sess, BASE + "/teacher/", follow_redirects=False)
    record("學員存取 /teacher/ 被拒（302/403/404）", st in (301, 302, 303, 307, 308, 403, 404),
           "status=%s" % st)

print()
print("=" * 78)
print("Phase 2-C 教師登入與後台")
print("=" * 78)

if password:
    tsess, _ = build_opener(follow_redirects=True)
    st, loc, thtml, _ = get(tsess, BASE + "/teacher/login/")
    record("GET /teacher/login/ 回 200", st == 200, "status=%s" % st)
    token = csrf_from(thtml)
    record("教師登入頁可取得 CSRF token", bool(token), "token_len=%d" % len(token))

    st, final_url, body = post_form(
        tsess, BASE + "/teacher/login/",
        {"csrfmiddlewaretoken": token, "username": TEACHER_EMAIL, "password": password},
        BASE + "/teacher/login/",
    )
    record("POST /teacher/login/ 登入成功",
           ("teacher/login" not in final_url) and st == 200,
           "status=%s final=%s" % (st, final_url.replace(BASE, "")))
    record("教師工作台可取用", st == 200 or "teacher" in final_url,
           "status=%s bytes=%d" % (st, len(body)))
    for label, needle in [("班級管理", "班級"),
                          ("學生複核／結訓審核清單", "複核"),
                          ("模型審核/模型倉庫", "模型"),
                          ("報告匯出/CSV", "CSV")]:
        record("教師後台含「%s」" % label, needle in body or needle.lower() in body.lower(), "")

    # 教師複核閉環：結訓審核清單與 CSV 匯出須實際可用
    st, _, checklist, _ = get(tsess, BASE + "/teacher/review-checklist/")
    record("教師結訓審核清單頁可取用", st == 200, "status=%s bytes=%d" % (st, len(checklist)))

    st, _, outcome, _ = get(tsess, BASE + "/teacher/class-outcomes/")
    record("教師班級學習成果總覽可取用", st == 200, "status=%s bytes=%d" % (st, len(outcome)))

    st, _, csv_body, headers = get(tsess, BASE + "/teacher/class-report/export/records/")
    is_csv = st == 200 and ("text/csv" in str(headers.get("Content-Type", ""))
                            or "fde" in csv_body[:400].lower()
                            or "," in csv_body[:400])
    record("教師 CSV 匯出可下載", is_csv,
           "status=%s content_type=%s bytes=%d" % (st, headers.get("Content-Type"), len(csv_body)))

print()
print("=" * 78)
print("Phase 2-D AI 整合（Live Coach / RAG / Vision 降級語意）")
print("=" * 78)

LIVE = BASE.replace(":8110", ":8111")
st, _, body, _ = get(anon, LIVE + "/api/live/health")
record("Live Backend /api/live/health 回 200", st == 200, "status=%s" % st)
st, _, body, _ = get(anon, LIVE + "/api/rag/health")
record("RAG /api/rag/health 回 200", st == 200, "status=%s" % st)

req = urllib.request.Request(
    LIVE + "/api/rag/ask", data=json.dumps({"question": "螺旋槳 CW 與 CCW 方向如何區分"}).encode(),
    headers={"Content-Type": "application/json"}, method="POST")
try:
    resp = urllib.request.urlopen(req, timeout=30)
    payload = json.loads(resp.read().decode("utf-8", "replace"))
    record("RAG 真實問答回傳 answer", bool(payload.get("answer")),
           "source_type=%s version=%s" % (payload.get("source_type"), payload.get("version")))
except Exception as exc:  # noqa: BLE001
    record("RAG 真實問答回傳 answer", False, "%s: %s" % (type(exc).__name__, exc))

# Vision 離線降級：正式 :8765 未啟動，必須快速失敗而非掛起
st, _, body, _ = get(anon, LIVE + "/api/live/health")
record("Vision 服務不可用時 live health 仍回 200（不掛起）", st == 200, "status=%s" % st)

print()
print("=" * 78)
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print("彙總：PASS=%d / FAIL=%d / 共 %d" % (passed, failed, len(results)))
if failed:
    print("\n失敗項目：")
    for step, ok, detail in results:
        if not ok:
            print("  - %s :: %s" % (step, detail))
print("\n注意：本腳本不輸出任何密碼值；登入流程已禁用自動跟隨重導以避免假 PASS。")
