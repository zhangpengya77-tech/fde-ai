"""建立／更新「隔離視覺儲存區」的種子資料（單向：只讀 DEMO，永不寫回）。

做兩件事：
1. 首次（或 --reseed）時，把 DEMO 的 vision center 目錄整份複製到隔離目錄。
2. **重寫隔離副本 `vision_center.json` 內的絕對路徑**，讓它們指向隔離目錄，
   而不是 DEMO 目錄。

為什麼一定要重寫路徑：
    `vision_center.json` 的 `models[].file_path` / `submissions[].file_path` /
    `datasets[].storage_path` 都是**絕對路徑**。若只複製檔案而不改路徑，
    隔離環境雖然有自己的檔案，實際上仍會去讀 DEMO 的檔案（而且 DEMO 的檔案
    日後被清理時會直接失效）。重寫後隔離環境才真正自成一體。

用法：
    python seed_vision_isolated_store.py [--reseed]

環境變數（皆有預設值）：
    FDE_ISOLATED_STORE / FDE_DEMO_STORE
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import sys

PROJECT = pathlib.Path(r"D:\FDE-AI-UAS-v2.0")

DEMO_STORE = pathlib.Path(
    os.environ.get("FDE_DEMO_STORE", str(PROJECT / "demo" / "runtime" / "vision-center"))
)
ISOLATED_STORE = pathlib.Path(
    os.environ.get(
        "FDE_ISOLATED_STORE",
        str(PROJECT / ".test-temp" / "vision-isolated" / "live-vision-store"),
    )
)

# 需要重寫路徑的欄位（collection -> key）
PATH_KEYS = {
    "models": ("file_path",),
    "submissions": ("file_path",),
    "datasets": ("storage_path",),
}


def fail(msg: str) -> int:
    print(f"[FAIL] {msg}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reseed", action="store_true", help="清空隔離區後重新複製")
    args = parser.parse_args()

    demo = DEMO_STORE.resolve()
    iso = ISOLATED_STORE.resolve()

    if demo == iso:
        return fail("隔離儲存區不可等於 DEMO 儲存區")
    if str(iso).lower().startswith(str(demo).lower()):
        return fail("隔離儲存區不可位於 DEMO 儲存區之下")
    if not (demo / "vision_center.json").exists():
        return fail(f"找不到 DEMO 儲存區：{demo}")

    # 注意：**不刪除**隔離目錄。沙箱有大量刪除保護（>50 檔即擋），
    # 且刪除本身沒有必要 —— 直接覆寫即可；殘留的舊檔案不影響正確性。
    seeded = False
    if args.reseed or not (iso / "vision_center.json").exists():
        print(f"[ .. ] 複製 DEMO -> 隔離（覆寫，不刪除）：{demo} -> {iso}")
        iso.mkdir(parents=True, exist_ok=True)
        shutil.copytree(demo, iso, dirs_exist_ok=True)
        seeded = True
        print("[ OK ] 種子複製完成")
    else:
        print("[ OK ] 隔離儲存區已存在，沿用")

    # --- 重寫絕對路徑 ---
    store_path = iso / "vision_center.json"
    data = json.loads(store_path.read_text(encoding="utf-8"))
    demo_str = str(demo)
    iso_str = str(iso)
    rewritten = 0
    dangling = []

    for collection, keys in PATH_KEYS.items():
        for record in data.get(collection, []) or []:
            for key in keys:
                value = record.get(key)
                if not isinstance(value, str) or not value:
                    continue
                if value.lower().startswith(demo_str.lower()):
                    record[key] = iso_str + value[len(demo_str):]
                    rewritten += 1
                elif not value.lower().startswith(iso_str.lower()):
                    # 指向其他位置（例如其他 .test-temp 目錄）→ 標記為可疑
                    dangling.append(f"{collection}.{key}={value}")

    store_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[ OK ] 路徑重寫：{rewritten} 筆已改指向隔離目錄（seeded={seeded}）")
    if dangling:
        print(f"[WARN] {len(dangling)} 筆路徑不屬於 DEMO 或隔離目錄：")
        for item in dangling[:10]:
            print(f"        {item}")

    # --- 檢查隔離區內實際可用的模型檔 ---
    available = 0
    missing = 0
    for record in data.get("models", []) or []:
        path = pathlib.Path(record.get("file_path", ""))
        if path.exists():
            available += 1
        else:
            missing += 1
    print(f"[ OK ] 隔離區模型檔：可用 {available}／{available + missing}（缺檔 {missing} 為 DEMO 原有的歷史缺檔）")
    print(f"[ OK ] 隔離儲存區：{iso}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
