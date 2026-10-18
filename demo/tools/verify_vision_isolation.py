"""視覺驗收隔離證明（唯讀 + 只在「隔離區」寫入）。

用途
----
證明 8112 驗收環境使用的是「獨立」的 vision center 儲存區：
隔離的 `vision_center.json`、模型檔案、ACTIVE 指標與驗證輸出，
且**不會**寫入 DEMO 共用儲存區（`demo/runtime/vision-center`）或正式儲存區。

作法（行為證明，非只看設定）
--------------------------
1. 記錄 DEMO 儲存區與正式儲存區 `vision_center.json` 的 sha256 / mtime / ACTIVE。
2. 透過「隔離 Live Backend」實際寫入兩件事：
   a. 建立一筆模型提交（submission）。
   b. 啟用一個 VALIDATED 模型（切換 ACTIVE），再回滾還原。
3. 驗證：
   - 隔離儲存區確實增加該筆 submission，且 ACTIVE 確實改變後又被還原。
   - DEMO 儲存區與正式儲存區的 sha256 / mtime / ACTIVE **完全未變**。
4. 輸出 JSON 結果，並以 exit code 表示成功與否。

環境變數（皆有預設值）
--------------------
  FDE_ISOLATED_LIVE   default http://127.0.0.1:8117
  FDE_ISOLATED_STORE  default <project>/.test-temp/vision-isolated/live-vision-store
  FDE_DEMO_STORE      default <project>/demo/runtime/vision-center
  FDE_PROD_STORE      default %LOCALAPPDATA%/FDE-AI-UAS/vision-center
  FDE_ISOLATION_RESULT default <project>/.test-temp/vision-center-v1/isolation_result.json

本腳本**永不**對 DEMO / 正式儲存區發出任何寫入請求。
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

PROJECT = pathlib.Path(r"D:\FDE-AI-UAS-v2.0")
RESULT_PATH = pathlib.Path(
    os.environ.get(
        "FDE_ISOLATION_RESULT",
        str(PROJECT / ".test-temp" / "vision-center-v1" / "isolation_result.json"),
    )
)

ISOLATED_LIVE = os.environ.get("FDE_ISOLATED_LIVE", "http://127.0.0.1:8117").rstrip("/")
ISOLATED_STORE = pathlib.Path(
    os.environ.get(
        "FDE_ISOLATED_STORE",
        str(PROJECT / ".test-temp" / "vision-isolated" / "live-vision-store"),
    )
)
DEMO_STORE = pathlib.Path(
    os.environ.get("FDE_DEMO_STORE", str(PROJECT / "demo" / "runtime" / "vision-center"))
)
PROD_STORE = pathlib.Path(
    os.environ.get(
        "FDE_PROD_STORE",
        str(pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home())) / "FDE-AI-UAS" / "vision-center"),
    )
)

TEACHER_HEADERS = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1"}

RESULTS: list[dict] = []


def record(case: str, ok: bool, detail: str, evidence: dict | None = None) -> None:
    RESULTS.append(
        {"case": case, "status": "PASS" if ok else "FAIL", "detail": detail, "evidence": evidence or {}}
    )
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {case} :: {detail}", flush=True)


def _http(method: str, url: str, payload: dict | None = None, headers: dict | None = None,
          timeout: int = 60) -> tuple[int, dict | str]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    hdrs = {"Content-Type": "application/json"} if data else {}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body
    except Exception as exc:  # noqa: BLE001 - connection refused / timeout etc.
        return 0, f"{type(exc).__name__}: {exc}"


def store_fingerprint(store: pathlib.Path) -> dict:
    """唯讀：檔案的 sha256 / size / mtime + 解析出的 ACTIVE 指標。"""
    path = store / "vision_center.json"
    if not path.exists():
        return {"exists": False, "path": str(path)}
    raw = path.read_bytes()
    stat = path.stat()
    active = {}
    try:
        data = json.loads(raw.decode("utf-8"))
        for item in data.get("models", []):
            if item.get("status") == "ACTIVE":
                active[item.get("model_type")] = item.get("model_id")
    except Exception:  # noqa: BLE001
        active = {"__parse_error__": True}
    return {
        "exists": True,
        "path": str(path),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "active": active,
    }


def load_store(store: pathlib.Path) -> dict:
    path = store / "vision_center.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    print("== 視覺驗收隔離證明 ==", flush=True)
    print(f"隔離 Live Backend : {ISOLATED_LIVE}", flush=True)
    print(f"隔離儲存區        : {ISOLATED_STORE}", flush=True)
    print(f"DEMO 共用儲存區   : {DEMO_STORE}", flush=True)
    print(f"正式儲存區        : {PROD_STORE}", flush=True)
    print("", flush=True)

    # --- 0. 路徑必須互不相同 ---
    paths = {
        "isolated": ISOLATED_STORE.resolve(),
        "demo": DEMO_STORE.resolve(),
        "prod": PROD_STORE.resolve(),
    }
    distinct = len({str(p).lower() for p in paths.values()}) == 3
    record(
        "0. 三個儲存區路徑互不相同",
        distinct,
        f"isolated={paths['isolated']} | demo={paths['demo']} | prod={paths['prod']}",
        {k: str(v) for k, v in paths.items()},
    )
    if not distinct:
        return finish()

    isolated_under_test_temp = str(paths["isolated"]).lower().startswith(
        str((PROJECT / ".test-temp").resolve()).lower()
    )
    record(
        "0b. 隔離儲存區位於 .test-temp 之下",
        isolated_under_test_temp,
        str(paths["isolated"]),
    )

    # --- 1. 基線指紋 ---
    before_demo = store_fingerprint(DEMO_STORE)
    before_prod = store_fingerprint(PROD_STORE)
    before_iso = store_fingerprint(ISOLATED_STORE)
    record(
        "1. 隔離儲存區存在且有資料",
        bool(before_iso.get("exists")),
        f"exists={before_iso.get('exists')} size={before_iso.get('size')}",
    )
    if not before_iso.get("exists"):
        return finish()

    iso_data_before = load_store(ISOLATED_STORE)
    iso_subs_before = {s.get("submission_id") for s in iso_data_before.get("submissions", [])}
    iso_active_before = before_iso.get("active", {}).get("PROP_DIRECTION")
    print("", flush=True)

    # --- 2. 隔離 Live Backend 可用 ---
    status, body = _http("GET", f"{ISOLATED_LIVE}/api/live/health")
    record(
        "2. 隔離 Live Backend 可用（:8117）",
        status == 200,
        f"HTTP {status}",
        {"body": body if isinstance(body, str) else "json"},
    )
    if status != 200:
        return finish()
    print("", flush=True)

    # --- 3. 寫入測試（只寫隔離區）---
    stamp = int(time.time())
    payload = {
        "task_id": "PROP_DIRECTION",
        "student_id": "ISOLATION-PROBE",
        "group_id": "ISO",
        "original_filename": f"isolation_probe_{stamp}.pt",
        "file_base64": base64.b64encode(b"\x00" * 4096).decode("ascii"),
        "notes": "isolation probe - must never appear in the shared DEMO store",
    }
    status, body = _http("POST", f"{ISOLATED_LIVE}/api/v1/vision/submissions", payload)
    probe_id = body.get("submission_id") if isinstance(body, dict) else None
    record(
        "3. 透過隔離 Live Backend 建立提交（僅隔離區）",
        status in (200, 201) and bool(probe_id),
        f"HTTP {status} submission_id={probe_id}",
        {"submission_id": probe_id},
    )
    if not probe_id:
        return finish()

    # --- 4. 隔離區確實收到；DEMO / 正式未變 ---
    iso_after = store_fingerprint(ISOLATED_STORE)
    iso_data_after = load_store(ISOLATED_STORE)
    iso_subs_after = {s.get("submission_id") for s in iso_data_after.get("submissions", [])}
    record(
        "4. 隔離儲存區確實新增該筆提交",
        probe_id in iso_subs_after,
        f"新增 {probe_id}（{len(iso_subs_before)} → {len(iso_subs_after)} 筆）",
    )

    after_demo = store_fingerprint(DEMO_STORE)
    demo_unchanged = (
        before_demo.get("sha256") == after_demo.get("sha256")
        and before_demo.get("mtime_ns") == after_demo.get("mtime_ns")
    )
    record(
        "4b. DEMO 共用儲存區未被寫入（sha256 + mtime 皆不變）",
        demo_unchanged,
        f"sha256 {str(before_demo.get('sha256'))[:12]}… → {str(after_demo.get('sha256'))[:12]}…",
        {"before": before_demo, "after": after_demo},
    )

    after_prod = store_fingerprint(PROD_STORE)
    prod_unchanged = (
        before_prod.get("sha256") == after_prod.get("sha256")
        and before_prod.get("mtime_ns") == after_prod.get("mtime_ns")
    )
    record(
        "4c. 正式儲存區未被寫入",
        prod_unchanged,
        f"exists={before_prod.get('exists')} sha256 不變={before_prod.get('sha256') == after_prod.get('sha256')}",
    )
    print("", flush=True)

    # --- 5. ACTIVE 指標獨立 ---
    status, history = _http(
        "GET", f"{ISOLATED_LIVE}/api/v1/vision/tasks/PROP_DIRECTION/history", headers=TEACHER_HEADERS
    )
    candidate = None
    if status == 200 and isinstance(history, dict):
        for item in history.get("history", []):
            if (
                item.get("validation_status") == "VALIDATED"
                and item.get("status") != "REJECTED"
                and item.get("model_id") != iso_active_before
                # 必須是隔離區內真的讀得到的檔案（DEMO 種子含歷史缺檔）
                and pathlib.Path(item.get("file_path", "")).exists()
            ):
                candidate = item.get("model_id")
                break
    record(
        "5. 隔離區找到可切換 ACTIVE 的 VALIDATED 模型（且模型檔可讀）",
        bool(candidate),
        f"candidate={candidate}（隔離區原 ACTIVE={iso_active_before}）",
    )
    if candidate:
        status, body = _http(
            "POST", f"{ISOLATED_LIVE}/api/v1/vision/models/{candidate}/activate", {}, TEACHER_HEADERS
        )
        iso_after_activate = store_fingerprint(ISOLATED_STORE).get("active", {}).get("PROP_DIRECTION")
        record(
            "5b. 隔離區 ACTIVE 確實切換",
            status in (200, 201) and iso_after_activate == candidate,
            f"HTTP {status}；隔離區 ACTIVE {iso_active_before} → {iso_after_activate}",
        )

        after_demo2 = store_fingerprint(DEMO_STORE)
        record(
            "5c. 切換 ACTIVE 後 DEMO 共用區 ACTIVE 未變",
            before_demo.get("active", {}).get("PROP_DIRECTION")
            == after_demo2.get("active", {}).get("PROP_DIRECTION")
            and before_demo.get("sha256") == after_demo2.get("sha256"),
            f"DEMO ACTIVE={after_demo2.get('active', {}).get('PROP_DIRECTION')}（原 {before_demo.get('active', {}).get('PROP_DIRECTION')}）",
        )

        # 回滾：Live Backend 的契約是「還原最近一次被 ARCHIVED 的 VALIDATED 版本」，
        # 不保證等於切換前的 ACTIVE（種子裡可能有更新的 ARCHIVED 版本）。
        # 因此這裡只驗證「已離開剛啟用的模型」且「仍是 VALIDATED」。
        status, body = _http(
            "POST", f"{ISOLATED_LIVE}/api/v1/vision/tasks/PROP_DIRECTION/rollback", {}, TEACHER_HEADERS
        )
        iso_after_rollback = store_fingerprint(ISOLATED_STORE).get("active", {}).get("PROP_DIRECTION")
        record(
            "5d. 隔離區回滾成功（已離開剛啟用的模型）",
            status in (200, 201) and iso_after_rollback not in (None, candidate),
            f"HTTP {status}；隔離區 ACTIVE={iso_after_rollback}（剛啟用的是 {candidate}）",
        )
    print("", flush=True)

    # --- 6. 最終確認 DEMO / 正式仍未被動 ---
    final_demo = store_fingerprint(DEMO_STORE)
    final_prod = store_fingerprint(PROD_STORE)
    record(
        "6. 全程結束後 DEMO 共用儲存區仍完全未變",
        final_demo.get("sha256") == before_demo.get("sha256")
        and final_demo.get("mtime_ns") == before_demo.get("mtime_ns"),
        "sha256 + mtime 皆與基線相同",
    )
    record(
        "6b. 全程結束後正式儲存區仍完全未變",
        final_prod.get("sha256") == before_prod.get("sha256")
        and final_prod.get("mtime_ns") == before_prod.get("mtime_ns"),
        "sha256 + mtime 皆與基線相同",
    )

    # --- 7. 模型檔案路徑必須指向隔離目錄（不能指回 DEMO）---
    iso_data_final = load_store(ISOLATED_STORE)
    iso_prefix = str(ISOLATED_STORE.resolve()).lower()
    demo_prefix = str(DEMO_STORE.resolve()).lower()
    inside = 0
    pointing_to_demo = 0
    pointing_elsewhere = []
    for collection, key in (("models", "file_path"), ("submissions", "file_path"), ("datasets", "storage_path")):
        for rec in iso_data_final.get(collection, []) or []:
            value = rec.get(key)
            if not isinstance(value, str) or not value:
                continue
            low = value.lower()
            if low.startswith(iso_prefix):
                inside += 1
            elif low.startswith(demo_prefix):
                pointing_to_demo += 1
            else:
                pointing_elsewhere.append(f"{collection}.{key}={value}")
    record(
        "7. 隔離區所有檔案路徑皆指向隔離目錄（不指回 DEMO）",
        pointing_to_demo == 0 and not pointing_elsewhere and inside > 0,
        f"指向隔離目錄 {inside} 筆｜指回 DEMO {pointing_to_demo} 筆｜其他 {len(pointing_elsewhere)} 筆",
        {"inside": inside, "to_demo": pointing_to_demo, "elsewhere": pointing_elsewhere[:5]},
    )

    return finish()


def finish() -> int:
    total = len(RESULTS)
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = total - passed
    summary = {"total": total, "PASS": passed, "FAIL": failed, "results": RESULTS}
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("", flush=True)
    print(f"== 結果：{passed}/{total} PASS，{failed} FAIL ==", flush=True)
    print(f"結果檔：{RESULT_PATH}", flush=True)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
