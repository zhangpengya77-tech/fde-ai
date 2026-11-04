"""透過實驗室 API 預載驗收用的真實日誌（只上傳與分析，不代替使用者做審核 / 比較）。

用法：python seed_acceptance_data.py [http://127.0.0.1:8195]
樣本來源：D:/FDE-AI-Runtime/pidlab-samples（不在倉庫內）。驗收伺服器必須是開發模式。
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8195").rstrip("/") + "/api/live/pid-lab"
SAMPLES = Path("D:/FDE-AI-Runtime/pidlab-samples")
STUDENT = {"X-PidLab-Dev-Identity": "student:demo-student:dev-cohort"}

AIRCRAFT = [
    ("2.5寸教學機 A01（BF 3.1.5）", "betaflight", {"firmware_version": "3.1.5", "fc_model": "OMNIBUSF4", "frame": "Quad X", "prop": "2.5 寸", "teaching_model": "FDE 2.5 寸標準教學機"}, [
        ("betaflight/plasmatree_stock_tune.BFL", "BASELINE", {"param_version": "原廠 PID", "battery_id": "B-01"}),
        ("betaflight/plasmatree_good_tune.BBL", "AFTER_TUNING", {"param_version": "調參後", "battery_id": "B-01"}),
    ]),
    ("BF 4.2 AIKONF7", "betaflight", {"firmware_version": "4.2.8", "fc_model": "AIKONF7"}, [
        ("betaflight/fc-blackbox/btfl_002.bbl", "PRACTICE", {}),
    ]),
    ("BF 4.2 KAKUTEF7", "betaflight", {"firmware_version": "4.2.0", "fc_model": "KAKUTEF7"}, [
        ("betaflight/fc-blackbox/LOG00037.BFL", "BASELINE", {}),
    ]),
    ("F450-01（ArduCopter 4.5.7）", "ardupilot", {"firmware_version": "4.5.7", "hardware_series": "Pixhawk", "ground_station": "Mission Planner", "frame": "F450"}, [
        ("ardupilot/f450_log484_20261015.bin", "PRACTICE", {"notes": "10/15 長航"}),
        ("ardupilot/f450_log496_20261018.bin", "PRACTICE", {"notes": "10/18"}),
        ("ardupilot/f450_log498_20261101_crash.bin", "PRACTICE", {"notes": "11/01 墜機"}),
    ]),
    ("Tarot X4（ArduCopter 4.5.5，批次取樣）", "ardupilot", {"firmware_version": "4.5.5", "hardware_series": "Pixhawk 6X"}, [
        ("ardupilot/tarot_x4_methodic.bin", "PRACTICE", {}),
    ]),
    ("PX4 CubeOrange（1.11.2）", "px4", {"firmware_version": "1.11.2", "hardware_series": "CubeOrange", "ground_station": "QGroundControl"}, [
        ("px4/sample_log_small.ulg", "PRACTICE", {}),
    ]),
]


def main() -> int:
    with httpx.Client(timeout=120) as c:
        meta = c.get(f"{BASE}/meta").json()
        if not meta.get("dev_mode"):
            print("驗收伺服器不是開發模式，停止。")
            return 1
        existing = {a["name"] for a in c.get(f"{BASE}/aircraft", headers=STUDENT).json()["aircraft"]}
        log_ids = []
        for name, eco, data, logs in AIRCRAFT:
            if name in existing:
                print("已存在，略過：", name)
                continue
            ac = c.post(f"{BASE}/aircraft", json={"name": name, "ecosystem": eco, "data": data}, headers=STUDENT).json()
            for rel, phase, cond in logs:
                path = SAMPLES / rel
                if not path.exists():
                    print("缺少樣本，略過：", path)
                    continue
                params = {"aircraft_id": ac["id"], "filename": path.name, "phase": phase, "allow_duplicate": "1", **cond}
                r = c.post(f"{BASE}/logs", params=params, content=path.read_bytes(), headers={**STUDENT, "Content-Type": "application/octet-stream"})
                r.raise_for_status()
                log_ids.append((r.json()["log"]["id"], name, path.name))
        for lid, name, fn in log_ids:
            for _ in range(240):
                log = c.get(f"{BASE}/logs/{lid}", headers=STUDENT).json()
                if log["status"] in ("DONE", "FAILED"):
                    break
                time.sleep(1)
            s = log.get("summary") or {}
            print(f"{log['status']:6} {name} / {fn} · 健康分 {s.get('health_score')} · {s.get('advice_counts')} {log.get('error') or ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
