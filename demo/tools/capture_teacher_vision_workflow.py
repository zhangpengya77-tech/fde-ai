"""Capture the real DEMO teacher vision workflow at desktop and mobile sizes.

The shared DEMO password is read from the existing restricted delivery file and
is never printed or written to the screenshot manifest.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".test-temp" / "acceptance-r24"))
import cdp as cdp_mod  # noqa: E402


BASE = os.environ.get("FDE_DEMO_BROWSER_BASE", "http://192.168.1.114:8111")
DELIVERY_FILE = Path.home() / ".fde-demo-credentials" / "demo.shared.password.txt"
SCREENSHOT_DIR = ROOT / "demo" / "screenshots"
TEACHER_EMAIL = "demo.teacher@fde-demo.local"


def read_shared_password() -> str:
    lines = DELIVERY_FILE.read_text(encoding="utf-8").splitlines()
    capture_next = False
    for line in lines:
        if capture_next and line.strip() and not line.strip().startswith("----"):
            return line.strip()
        if "以下為密碼" in line and "----" in line:
            capture_next = True
    raise RuntimeError("DEMO restricted credential is unavailable")


def set_viewport(browser, width: int, height: int, mobile: bool) -> None:
    browser.cdp.call(
        "Emulation.setDeviceMetricsOverride",
        {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": mobile,
        },
    )


def main() -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    cdp_mod.SHOTS = str(SCREENSHOT_DIR)
    browser = cdp_mod.Browser()
    password = read_shared_password()
    try:
        set_viewport(browser, 1440, 900, False)
        browser.goto(f"{BASE}/teacher/login/?next=/teacher/vision-models/", wait=1.2)
        assert browser.fill('input[name="username"]', TEACHER_EMAIL) == "OK"
        assert browser.fill('input[name="password"]', password) == "OK"
        submit_result = browser.eval(
            "document.querySelector('form')?.requestSubmit(); 'OK'"
        )
        assert submit_result == "OK"
        time.sleep(1.5)

        browser.goto(f"{BASE}/teacher/vision-models/", wait=1.5)
        text = browser.text()
        if "教師登入" in text:
            raise RuntimeError("DEMO teacher login did not establish a session")
        headings = [
            "01｜學員模型提交",
            "02｜教師圖片驗證",
            "03｜確認並啟用網站模型",
            "04｜下一期教學模型資源庫",
        ]
        positions = [text.index(heading) for heading in headings]
        assert positions == sorted(positions)
        assert "區域一｜" not in text
        assert "vision_api_unavailable" not in text

        selection_href = browser.eval(
            "document.querySelector('a[href*=\"?model=\"]')?.getAttribute('href') || ''"
        )
        if selection_href:
            browser.goto(urljoin(f"{BASE}/teacher/vision-models/", selection_href), wait=1.0)
            selected_text = browser.text()
            assert "目前選擇的學員" in selected_text
            assert "目前選擇的模型" in selected_text

        desktop = browser.shot("teacher-vision-workflow-desktop.png")
        set_viewport(browser, 390, 844, True)
        browser.goto(browser.url(), wait=0.8)
        mobile = browser.shot("teacher-vision-workflow-mobile.png")

        manifest = {
            "url": browser.url(),
            "desktop": desktop,
            "mobile": mobile,
            "four_step_order": "PASS",
            "old_horizontal_tabs_absent": "PASS",
            "vision_api_raw_error_absent": "PASS",
            "selected_model_context": "PASS" if selection_href else "BLOCKED_NO_R07_MODEL",
        }
        output = ROOT / "demo" / "runtime" / "logs" / "teacher_vision_workflow_screenshots.json"
        output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    finally:
        password = ""
        browser.close()


if __name__ == "__main__":
    main()
