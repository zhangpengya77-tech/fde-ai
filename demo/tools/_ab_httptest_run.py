"""A/B 硬规则 HTTP 实测（隔离实例 8031 + 临时 store）。

2026-10-23 教师指令验收：A「验证通过才可启用」硬规则 + B 数据飞轮种子模型。
隔离实例不触碰运行中的 DEMO 栈（8030/8110/8111）。用后由调用方清理。

探针：
  A1 activate override=true          -> 422 teacher_override_disabled
  A2 activate 合格模型                -> 200 ACTIVE（validation_confidence 0.65 >= 0.6）
  A3 activate LOW_QUALITY 模型        -> 422 model_health_not_ok
  B1 seed 合格模型                     -> 200 is_seed（generation 1）
  B2 recommended-seed                 -> good
  B3 seed-version-chain               -> 1 笔
  B4 seed/download（学员身份）         -> base64 精确解回 FAKE_PT_PROP_GOOD
  B5 unseed 非种子模型                 -> 422 model_not_seed
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(r"D:\FDE-AI-UAS-v2.0")
LIVE = REPO / "live_backend"
BASE = REPO / "demo" / "runtime" / "_ab_httptest"
STORE = BASE / "store"
PORT = 8031
OUT = REPO / "demo" / "runtime" / "logs" / "AB_HTTP_TEST_2026-10-23.json"

TEACHER = {"X-FDE-Role": "teacher", "X-FDE-Teacher-ID": "1"}
STUDENT = {"X-FDE-Student-ID": "DEMO-STU-0001"}


def call(path, *, method="GET", body=None, headers=None):
    url = f"http://127.0.0.1:{PORT}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode())
        except Exception:
            return exc.code, {}


def err_code(body):
    return ((body or {}).get("error") or {}).get("code")


def err_msg(body):
    return ((body or {}).get("error") or {}).get("message") or ""


def reason_of(body):
    """activate/unseed 等 handler 將 ValueError 原因碼包成 message；
    接受 wrapper code（如 activation_failed）或直接原因碼（如 model_health_not_ok）。"""
    code, msg = err_code(body), err_msg(body)
    return msg if msg in KNOWN_REASONS else code


KNOWN_REASONS = {
    "teacher_override_disabled", "model_health_not_ok", "model_validation_required",
    "model_validation_confidence_too_low", "model_class_names_invalid",
    "model_demo_imported_not_allowed", "model_quarantined", "model_file_unreadable",
    "model_rejected", "model_not_seed", "seed_health_not_ok",
    "seed_validation_required", "seed_validation_confidence_too_low",
}


def main():
    # 1) 重建隔离 store
    subprocess.run([sys.executable, str(REPO / "demo" / "tools" / "_ab_httptest_build.py")],
                   check=True, cwd=str(LIVE))
    # 2) 启动隔离 Live 实例（8031，临时 store）
    env = dict(os.environ)
    env["FDE_VISION_CENTER_ROOT"] = str(STORE)
    env["FDE_DEMO_SIMULATED_INFERENCE"] = "0"
    log = open(BASE / "server.log", "w")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=str(LIVE), env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    results = []
    try:
        ready = False
        for _ in range(80):
            if proc.poll() is not None:
                break
            try:
                status, _ = call("/api/live/health")
                if status == 200:
                    ready = True
                    break
            except Exception:
                pass
            time.sleep(0.5)
        results.append({"probe": "boot", "pass": ready,
                        "detail": "isolated live instance on 127.0.0.1:%d" % PORT})
        if not ready:
            raise RuntimeError("isolated instance did not become ready")

        # A1 覆寫路徑已撤銷
        s, b = call("/api/v1/vision/models/good/activate", method="POST",
                    body={"override": True}, headers=TEACHER)
        results.append({"probe": "A1_activate_override_rejected", "pass": s == 422 and err_code(b) == "teacher_override_disabled",
                        "http_status": s, "error_code": err_code(b), "detail": b})

        # A2 合格模型可啟用（最高信心 0.65 >= 0.6）
        s, b = call("/api/v1/vision/models/good/activate", method="POST",
                    body={}, headers=TEACHER)
        conf = ((b.get("activation") or {}).get("validation_confidence"))
        results.append({"probe": "A2_activate_eligible_ok", "pass": s == 200 and b.get("status") == "ACTIVE" and conf is not None and conf >= 0.6,
                        "http_status": s, "status": b.get("status"),
                        "validation_confidence": conf,
                        "activation_min_confidence": (b.get("activation") or {}).get("activation_min_confidence"),
                        "detail": {"previous_active_model_id": (b.get("activation") or {}).get("previous_active_model_id")}})

        # A3 健康度不合格不得啟用（原因碼 model_health_not_ok，包於 activation_failed）
        s, b = call("/api/v1/vision/models/badh/activate", method="POST",
                    body={}, headers=TEACHER)
        results.append({"probe": "A3_activate_low_quality_rejected", "pass": s == 422 and reason_of(b) == "model_health_not_ok",
                        "http_status": s, "wrapper_code": err_code(b), "reason_code": reason_of(b), "detail": b})

        # B1 合格模型入庫為種子
        s, b = call("/api/v1/vision/models/good/seed", method="POST",
                    body={"recommended": True, "note": "ab-httptest"}, headers=TEACHER)
        results.append({"probe": "B1_seed_model_ok", "pass": s == 200 and b.get("is_seed") is True,
                        "http_status": s, "is_seed": b.get("is_seed"),
                        "seed_generation": b.get("seed_generation"),
                        "seed_parent_model_id": b.get("seed_parent_model_id"),
                        "seed_validation_confidence": b.get("seed_validation_confidence")})

        # B2 當前推薦種子唯一
        s, b = call("/api/v1/vision/tasks/PROP_DIRECTION/recommended-seed")
        results.append({"probe": "B2_recommended_seed", "pass": s == 200 and (b.get("recommended_seed") or {}).get("model_id") == "good",
                        "http_status": s, "recommended_seed": b.get("recommended_seed")})

        # B3 版本鏈
        s, b = call("/api/v1/vision/tasks/PROP_DIRECTION/seed-version-chain")
        chain = b.get("version_chain") or []
        results.append({"probe": "B3_seed_version_chain", "pass": s == 200 and len(chain) == 1,
                        "http_status": s, "chain_len": len(chain), "version_chain": chain})

        # B4 學員下載種子 .pt（base64 精確還原）
        s, b = call("/api/v1/vision/seed/download?model_id=good", headers=STUDENT)
        raw = base64.b64decode(b.get("file_base64") or "")
        digest = hashlib.sha256(raw).hexdigest()
        results.append({"probe": "B4_seed_download_roundtrip", "pass": s == 200 and raw == b"FAKE_PT_PROP_GOOD" and digest == b.get("file_hash"),
                        "http_status": s, "file_name": b.get("file_name"),
                        "file_size": b.get("file_size"), "sha256_match": digest == b.get("file_hash"),
                        "content_match": raw == b"FAKE_PT_PROP_GOOD"})

        # B5 非種子不得取消種子（model_not_seed，包於 unseed_failed）
        s, b = call("/api/v1/vision/models/badh/unseed", method="POST",
                    body={"reason": "ab"}, headers=TEACHER)
        results.append({"probe": "B5_unseed_non_seed_rejected", "pass": s == 422 and reason_of(b) == "model_not_seed",
                        "http_status": s, "wrapper_code": err_code(b), "reason_code": reason_of(b), "detail": b})
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()

    passed = sum(1 for r in results if r["pass"])
    summary = {"suite": "A/B hard-rule HTTP probes (isolated instance)",
               "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "port": PORT, "store": str(STORE),
               "total": len(results), "passed": passed,
               "all_passed": passed == len(results), "results": results}
    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"total": len(results), "passed": passed,
                      "all_passed": passed == len(results),
                      "output": str(OUT)}, ensure_ascii=False))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
