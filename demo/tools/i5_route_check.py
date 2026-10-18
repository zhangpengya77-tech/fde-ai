"""I5-A：Live Backend 路由解析靜態核對（唯讀，不啟動任何服務）。

目的：客觀證明 I4 新增的 /platform/ 代理
  1. 不覆蓋既有路由
  2. 不影響 /live/、/downloads/、/flight-health/
  3. 不影響 AI Live Coach（/api/live/*）與 RAG（/api/rag/*）

作法：直接建構 Starlette app，對代表性路徑做 route.matches()。
判準（兩層）：
  A. 每個樣本至少要有一個 FULL match。
  B. 同一樣本的所有 FULL match 必須指向**同一個 endpoint**（否則即為真覆蓋）。
Starlette 的 {x:path} 轉換器可匹配空字串，因此 "/platform/" 會同時命中
"/platform/" 與 "/platform/{portal_path:path}"；本腳本以 endpoint 同一性
區分「無害重複」與「真覆蓋」，並列出所有 FULL match 供人工覆核。

不啟動 uvicorn、不發出任何網路請求、不觸碰資料庫。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from starlette.routing import Match, Mount  # noqa: E402


class _StubVisionCenter:
    """避免建構真實 VisionCenter（不建立任何目錄）。"""

    def active_model(self, _model_type):
        return None


class _StubSandbox:
    def run(self, *_args, **_kwargs):
        raise RuntimeError("not used in route check")

    def history(self, *_args, **_kwargs):
        return []


def _label(route) -> str:
    if isinstance(route, Mount):
        return "Mount(%s)" % route.path
    return "Route(%s)" % getattr(route, "path", "?")


def _endpoint(route):
    if isinstance(route, Mount):
        return route.app
    return getattr(route, "endpoint", None)


def _endpoint_name(endpoint) -> str:
    if endpoint is None:
        return "(none)"
    name = getattr(endpoint, "__name__", None)
    if name:
        return name
    return type(endpoint).__name__


# (路徑, 方法, 期望 endpoint 名稱)
SAMPLES = [
    # ---- I4 新增（本輪審查重點）----
    ("/platform/", "GET", "django_portal_proxy"),
    ("/platform/f450", "GET", "django_portal_proxy"),
    ("/platform/f450/", "GET", "django_portal_proxy"),
    ("/platform/course/1", "POST", "django_portal_proxy"),
    # ---- 既有 Django 代理 ----
    ("/login/", "POST", "django_portal_proxy"),
    ("/student/", "GET", "django_portal_proxy"),
    ("/student/learning-path/", "GET", "django_portal_proxy"),
    ("/teacher/", "GET", "django_portal_proxy"),
    ("/teacher/login/", "GET", "django_portal_proxy"),
    ("/courses/14/learning-path/", "GET", "django_portal_proxy"),
    ("/evidence/1", "GET", "django_portal_proxy"),
    ("/static/learning/x.css", "GET", "django_portal_proxy"),
    ("/logout/", "POST", "django_portal_proxy"),
    ("/register/", "POST", "django_portal_proxy"),
    # ---- 既有 Live Backend 靜態區塊 ----
    ("/live/", "GET", "StaticFiles"),
    ("/live/index.html", "GET", "StaticFiles"),
    ("/downloads/", "GET", "StaticFiles"),
    ("/downloads/index.html", "GET", "StaticFiles"),
    ("/flight-health/", "GET", "StaticFiles"),
    ("/flight-health/index.html", "GET", "StaticFiles"),
    ("/src/app.js", "GET", "StaticFiles"),
    # ---- 首頁與前端區塊 ----
    ("/", "GET", "homepage"),
    ("/eagle", "GET", "homepage"),
    # ---- AI Live Coach / RAG ----
    ("/api/rag/ask", "POST", "rag_ask_proxy"),
    ("/api/rag/health", "GET", "<lambda>"),
    ("/api/live/health", "GET", "health"),
    ("/api/live/sessions", "POST", "create_session"),
    ("/api/live/sessions/s1/ask", "POST", "ask_coach"),
    ("/api/live/sessions/s1/snapshot", "POST", "snapshot"),
    # ---- 下載中心 API ----
    ("/api/downloads", "GET", "downloads_manifest"),
    ("/api/downloads/x/file", "GET", "download_file"),
    # ---- 視覺模型倉庫（教師，受保護區）----
    ("/api/v1/vision/models", "GET", "models"),
    ("/api/v1/vision/prop-check", "GET", "prop_check"),
]


def main() -> int:
    from live_backend.app.main import create_app

    app = create_app(
        vision_center=_StubVisionCenter(),
        benchmark_sandbox=_StubSandbox(),
        vision_adapter=object(),
        rag_adapter=object(),
    )
    routes = app.router.routes

    print("=" * 96)
    print("I5-A 路由解析核對（靜態；未啟動服務、未發出網路請求）")
    print("=" * 96)
    print("路由總數：%d" % len(routes))
    print()

    failures = []
    duplicates = []
    print("%-4s %-34s %-6s %-8s %-9s %s" % ("", "路徑", "方法", "FULL數", "首命中", "所有 FULL match（依序）"))
    print("-" * 96)
    for path, method, expect in SAMPLES:
        scope = {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [],
            "query_string": b"",
            "root_path": "",
        }
        hits = []
        for index, route in enumerate(routes):
            matched, _child = route.matches(scope)
            if matched == Match.FULL:
                hits.append((index, _label(route), _endpoint(route)))

        first_name = _endpoint_name(hits[0][2]) if hits else "(無命中)"
        same_endpoint = len({id(item[2]) for item in hits}) <= 1
        ok = bool(hits) and same_endpoint and first_name == expect
        if len(hits) > 1:
            duplicates.append((path, method, len(hits)))
        if not ok:
            failures.append((path, method, expect, first_name, len(hits)))

        print(
            "%-4s %-34s %-6s %-8d %-9s %s"
            % (
                "OK " if ok else "!! ",
                path,
                method,
                len(hits),
                first_name,
                " | ".join("#%d %s" % (i, lab) for i, lab, _ in hits) or "(無命中)",
            )
        )

    print("-" * 96)
    print("A. 樣本數：%d；期望 endpoint 全數相符且無異質覆蓋：%s" % (len(SAMPLES), "是" if not failures else "否"))
    if failures:
        for path, method, expect, got, count in failures:
            print("   !! %s %s 期望=%s 實際首命中=%s FULL數=%d" % (method, path, expect, got, count))
    print("B. 同一路徑出現多重 FULL match 的樣本：%d" % len(duplicates))
    for path, method, count in duplicates:
        print("   - %s %s：%d 個 FULL match（皆指向同一 endpoint，屬 Starlette {x:path} 可匹配空字串之既有慣例）" % (method, path, count))
    print()
    print("結果：%s" % ("PASS（無路由被覆蓋；既有區塊與 API 全數命中且 endpoint 相符）" if not failures else "FAIL"))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
