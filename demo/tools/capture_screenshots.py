"""FDE-AI-UAS 2.0 DEMO — 離線備援截圖工具。

透過既有的 Chrome（CDP :9222）擷取展示頁面。
所有請求都打 127.0.0.1:8111（Live，包含首頁）與 127.0.0.1:8110（Django）。

截圖清單（含登入流程）：
  01-home.png            首頁（無登入）
  02-student-login.png   學員登入頁
  03-student-dashboard.png 學員儀表板（已登入）
  04-student-R07.png     學員 R07 任務卡（已登入）
  05-teacher-login.png   教師登入頁
  06-teacher-dashboard.png 教師後台（已登入）
  07-teacher-flywheel.png  模型倉庫 V1（已登入）
  08-teacher-goldenset.png Golden Set 管理（已登入）
  09-teacher-goldenset-detail.png Golden Set 詳情 FROZEN（已登入）

安全：不直接修改任何檔案；僅把 PNG 寫入 demo/screenshots/。
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time

sys.path.insert(0, r"D:\FDE-AI-UAS-v2.0\.test-temp\acceptance-r24")
import cdp as cdp_mod  # 複用既有純標準函式庫 CDP 驅動
import demo_credentials

LIVE = "http://127.0.0.1:8111"
DJANGO = "http://127.0.0.1:8110"
SHOTS = r"D:\FDE-AI-UAS-v2.0\demo\screenshots"

STUDENT_EMAIL = "demo.student01@fde-demo.local"
STUDENT_PASSWORD = demo_credentials.student_password()
TEACHER_EMAIL = "demo.teacher@fde-demo.local"
TEACHER_PASSWORD = demo_credentials.teacher_password()

os.makedirs(SHOTS, exist_ok=True)

browser = cdp_mod.Browser()


def shot(name: str):
    path = browser.shot(name)
    print(f"  [OK] {name} → {path}")
    return path


def goto(url, wait=2.0):
    browser.goto(url, wait=wait)


def get_text():
    return browser.text() or ""


def login_via_form(login_url, email, password):
    """透過 Django 登入表單送出（含 CSRF）。"""
    goto(login_url, wait=2.0)
    # 取出 CSRF token
    html = browser.html() or ""
    import re
    m = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', html)
    token = m.group(1) if m else ""
    # 填入並送出
    browser.fill('input[name="username"]', email)
    browser.fill('input[name="password"]', password)
    # 直接呼叫 Django 登入 POST（避免表單選擇器差異）
    browser.eval(f"""(() => {{
        const f = document.querySelector('form');
        if (!f) return 'NO_FORM';
        const inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = 'csrfmiddlewaretoken';
        inp.value = {json.dumps(token)};
        f.appendChild(inp);
        f.submit();
        return 'SUBMITTED';
    }})()""")
    time.sleep(2.5)


def main():
    print("=" * 72)
    print("  FDE-AI-UAS 2.0 DEMO — 離線備援截圖")
    print("=" * 72)

    # 1. 首頁
    goto(f"{LIVE}/", wait=2.5)
    print(f"  首頁標題：{(browser.title() or '')[:50]}")
    shot("01-home.png")

    # 2. 學員登入頁
    goto(f"{DJANGO}/login/", wait=2.0)
    shot("02-student-login.png")

    # 3. 學員登入後儀表板
    login_via_form(f"{DJANGO}/login/", STUDENT_EMAIL, STUDENT_PASSWORD)
    goto(f"{DJANGO}/student/", wait=2.5)
    shot("03-student-dashboard.png")

    # 4. 學員 R07 任務卡
    html = browser.html() or ""
    import re
    m = re.search(r'/student/courses/(\d+)/', html)
    if m:
        eid = m.group(1)
        goto(f"{DJANGO}/student/courses/{eid}/growth/R07/", wait=2.5)
        shot("04-student-R07.png")
    else:
        print("  [WARN] 找不到 enrollment 連結，略過 R07 截圖")

    # 5. 教師登入頁
    goto(f"{DJANGO}/teacher/login/", wait=2.0)
    shot("05-teacher-login.png")

    # 6. 教師登入後後台
    login_via_form(f"{DJANGO}/teacher/login/", TEACHER_EMAIL, TEACHER_PASSWORD)
    goto(f"{DJANGO}/teacher/", wait=2.5)
    shot("06-teacher-dashboard.png")

    # 7. 模型倉庫
    goto(f"{DJANGO}/teacher/vision-flywheel/", wait=2.5)
    shot("07-teacher-flywheel.png")

    # 8. Golden Set 管理
    goto(f"{DJANGO}/teacher/golden-sets/", wait=2.5)
    shot("08-teacher-goldenset.png")

    # 9. Golden Set 詳情
    goto(f"{DJANGO}/teacher/golden-sets/PROP_GOLDEN_DEMO_v1/", wait=2.5)
    shot("09-teacher-goldenset-detail.png")

    browser.close()
    print()
    print("[OK] 9 張截圖完成，存放於：")
    print(f"      {SHOTS}")


if __name__ == "__main__":
    main()
