"""PID & Filter Lab HTTP API（Starlette 路由，掛在 Live Backend 的 /api/live/pid-lab/ 下）。

身分：正式模式只採用 Gateway → Live 驗證過的 ``request.state.live_identity``
（Django 簽發的短效 Assertion：sub / role / cohort_ids）。
只有在 Live 明確為開發模式（require_identity=False）時，才接受
``X-PidLab-Dev-Identity: role:sub:cohort`` 方便本機測試；正式模式完全忽略該標頭。
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import adapters, pipeline
from .analysis import compare as compare_mod
from .model import ECOSYSTEMS
from .parsers import params as param_parser
from .rules import catalog
from .rules import export as export_mod
from .store import LabStore

PREFIX = "/api/live/pid-lab"
MAX_LOG_BYTES = 64 * 1024 * 1024
ALLOWED_EXTENSIONS = {".bbl", ".bfl", ".txt", ".bin", ".log", ".ulg"}
PHASES = {"BASELINE", "AFTER_TUNING", "PRACTICE"}
DEV_HEADER = "X-PidLab-Dev-Identity"

# 各生態目前的實際驗收狀態（依真實樣本測試結果填寫，不得誇大）
SUPPORT_STATUS = {
    "betaflight": {"log_formats": ["BBL", "BFL"], "status": "PARTIAL", "note": "已用 2 份公開真實 Blackbox（Betaflight 3.1.5）驗證解碼與分析；4.x 新版欄位尚缺真實樣本驗收。"},
    "ardupilot": {"log_formats": ["BIN"], "status": "PARTIAL", "note": "已用多份 ArduCopter 4.5.7 / 4.8-dev 真實 BIN 驗證解析與八大健康；樣本 RATE 記錄僅 10 Hz，PID 階躍響應與濾波分析尚未以高頻日誌驗收；舊版 APM 尚無真實樣本。"},
    "px4": {"log_formats": ["ULG"], "status": "PARTIAL", "note": "已用 PX4 官方測試 ULog 樣本驗證解析、版本識別與八大健康映射；尚缺真實多旋翼高頻飛行日誌驗收 PID 分析。"},
    "other": {"log_formats": [], "status": "PROFILE_ONLY", "note": "可建立飛機檔案；不支援日誌分析。"},
}


def _json(data, status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status)


def _err(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def default_root() -> Path:
    env = os.environ.get("FDE_PID_LAB_ROOT")
    if env:
        return Path(env)
    store = os.environ.get("FDE_LIVE_STORE_DIR")
    if store:
        return Path(store).parent / "pid-lab"
    return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FDE-AI-UAS" / "pid-lab"


class PidLabService:
    def __init__(self, root: Path | None = None, *, require_identity: bool = True, inline_jobs: bool = False) -> None:
        self.store = LabStore(root or default_root())
        self.require_identity = require_identity
        self.inline_jobs = inline_jobs
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pidlab")

    # ------------------------------------------------------------ 身分
    def identity(self, request) -> dict | None:
        ident = getattr(request.state, "live_identity", None)
        if ident:
            cohorts = [str(c) for c in ident.get("cohort_ids") or []]
            return {"sub": str(ident["sub"]), "role": ident.get("role"), "cohorts": cohorts, "cohort": cohorts[0] if cohorts else ""}
        if self.require_identity:
            return None
        raw = request.headers.get(DEV_HEADER, "student:dev-student:dev-cohort")
        parts = raw.split(":")
        if len(parts) != 3 or parts[0] not in ("student", "teacher"):
            return None
        return {"sub": f"{parts[0]}:{parts[1]}", "role": parts[0], "cohorts": [parts[2]], "cohort": parts[2], "dev": True}

    def _scope(self, ident: dict):
        """回傳 (owner, cohorts)：學員以 owner 篩選；教師以 cohort 篩選。"""
        return (ident["sub"], None) if ident["role"] == "student" else (None, ident["cohorts"])

    def _can_read(self, ident: dict, row: dict | None) -> bool:
        if row is None:
            return False
        if ident["role"] == "student":
            return row.get("owner_sub") == ident["sub"]
        return row.get("cohort_id") in ident["cohorts"]

    # ------------------------------------------------------------ 背景分析
    def _analyze_job(self, log_id: str) -> None:
        log = self.store.get_log(log_id)
        try:
            self.store.set_log_status(log_id, "PARSING")
            data = self.store.raw_path(log["sha256"]).read_bytes()
            extra = None
            imported = self.store.latest_params(log["aircraft_id"])
            if imported and imported["ecosystem"] == log["ecosystem_selected"]:
                extra = imported["parsed"].get("params")
            result = pipeline.run(data, log["ecosystem_selected"], extra)
            result["log"] = {"id": log_id, "sha256": log["sha256"], "filename": log["filename"], "size": log["size"], "phase": log["phase"], "aircraft_id": log["aircraft_id"], "conditions": log["conditions"]}
            self.store.save_analysis(log_id, result)
            fl = result["flight"]
            summary = {
                "ecosystem": fl["flight_controller_type"],
                "firmware": fl["firmware_version"].get("name"),
                "firmware_version": fl["firmware_version"].get("version"),
                "board": fl["hardware"].get("board"),
                "vehicle_type": fl["vehicle_type"],
                "duration_s": fl["log_metadata"].get("duration_s"),
                "health_score": result["health"]["overall"]["score"],
                "health_coverage": result["health"]["overall"]["coverage"],
                "worst_status": result["health"]["overall"]["worst_status"],
                "advice_counts": result["advice"]["counts"],
                "blocked": result["advice"]["blocked"],
                "warnings": fl["warnings"][:5],
            }
            self.store.set_log_status(log_id, "DONE", detected=fl["flight_controller_type"], pipeline_version=result["pipeline_version"], summary=summary)
        except (ValueError, KeyError, IndexError, OSError) as exc:
            self.store.set_log_status(log_id, "FAILED", error=str(exc)[:500])
        except Exception as exc:  # noqa: BLE001 — 任何解析錯誤都要回報給學員而不是讓任務卡住
            self.store.set_log_status(log_id, "FAILED", error=f"分析失敗：{type(exc).__name__}: {str(exc)[:300]}")

    # ------------------------------------------------------------ 路由
    async def meta(self, request):
        ident = self.identity(request)
        return _json({
            "service": "AI PID & Filter Lab",
            "pipeline_version": pipeline.PIPELINE_VERSION,
            "ecosystems": [{"key": k, "label": v, **SUPPORT_STATUS[k]} for k, v in ECOSYSTEMS.items()],
            "identity": None if ident is None else {"role": ident["role"], "sub": ident["sub"], "cohort": ident["cohort"], "dev": bool(ident.get("dev"))},
            "dev_mode": not self.require_identity,
            "limits": {"max_log_mb": MAX_LOG_BYTES // (1024 * 1024), "extensions": sorted(ALLOWED_EXTENSIONS)},
            "privacy": "日誌只在本機後端解析，不會上傳到第三方 AI 服務。",
            "safety": "本系統不會連接飛控、不會寫入參數、不會刷韌體或啟動馬達。",
        })

    def _auth(self, request):
        ident = self.identity(request)
        if ident is None:
            return None, _err("identity_required", "請先登入 FDE-AI 平台後再使用實驗室。", 401)
        return ident, None

    async def list_aircraft(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        owner, cohorts = self._scope(ident)
        return _json({"aircraft": self.store.list_aircraft(owner, cohorts)})

    def _aircraft_payload(self, body: dict):
        name = str(body.get("name") or "").strip()[:80]
        eco = str(body.get("ecosystem") or "")
        if not name:
            return None, _err("invalid_name", "請填寫飛機名稱。", 400)
        if eco not in ECOSYSTEMS:
            return None, _err("invalid_ecosystem", "請選擇飛控生態。", 400)
        allowed = {"firmware_version", "fc_model", "target", "board_id", "frame", "wheelbase_mm", "motor", "motor_kv", "esc", "prop", "battery", "flight_mode", "payload_g", "sample_rate", "notes", "other_brand", "other_hardware", "other_firmware", "other_vehicle_type", "hardware_series", "ground_station", "teaching_model"}
        data = {k: str(v)[:200] for k, v in (body.get("data") or {}).items() if k in allowed}
        if eco == "other" and not data.get("other_firmware"):
            return None, _err("other_firmware_required", "選擇「其他飛控」時請填寫韌體名稱。", 400)
        return (name, eco, data), None

    async def create_aircraft(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        try:
            body = await request.json()
        except ValueError:
            return _err("invalid_json", "格式錯誤。", 400)
        payload, err = self._aircraft_payload(body if isinstance(body, dict) else {})
        if err:
            return err
        row = self.store.create_aircraft(ident["sub"], ident["cohort"], *payload)
        self.store.audit(ident["sub"], "aircraft.create", row["id"])
        return _json(row, 201)

    async def update_aircraft(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        row = self.store.get_aircraft(request.path_params["aid"])
        if row is None or row["owner_sub"] != ident["sub"]:
            return _err("not_found", "找不到飛機檔案。", 404)
        body = await request.json()
        payload, err = self._aircraft_payload(body if isinstance(body, dict) else {})
        if err:
            return err
        return _json(self.store.update_aircraft(row["id"], *payload))

    async def get_aircraft(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        row = self.store.get_aircraft(request.path_params["aid"])
        if not self._can_read(ident, row):
            return _err("not_found", "找不到飛機檔案。", 404)
        row["param_imports"] = self.store.list_param_imports(row["id"])
        return _json(row)

    async def import_params(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        row = self.store.get_aircraft(request.path_params["aid"])
        if row is None or row["owner_sub"] != ident["sub"]:
            return _err("not_found", "找不到飛機檔案。", 404)
        body = await request.json()
        text = str(body.get("text") or "")
        kind = str(body.get("kind") or "params")[:30]
        if len(text) > 2_000_000:
            return _err("too_large", "參數文字過大。", 413)
        try:
            parsed = param_parser.parse(row["ecosystem"], text)
        except param_parser.ParamImportError as exc:
            return _err("invalid_params", str(exc), 400)
        result = self.store.add_param_import(row, row["ecosystem"], kind, text, parsed)
        self.store.audit(ident["sub"], "params.import", row["id"], {"kind": kind, "count": parsed.get("count")})
        return _json(result, 201)

    async def upload_log(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        if ident["role"] != "student" and not ident.get("dev"):
            # 教師也可上傳示範日誌，歸屬教師本人
            pass
        q = request.query_params
        filename = re.sub(r"[^\w.\-]", "_", q.get("filename", "flight.log"))[:120]
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return _err("invalid_extension", f"不支援的副檔名 {ext}（允許：{', '.join(sorted(ALLOWED_EXTENSIONS))}）。", 400)
        length = int(request.headers.get("content-length") or 0)
        if length > MAX_LOG_BYTES:
            return _err("too_large", f"日誌超過 {MAX_LOG_BYTES // (1024 * 1024)} MB 上限。", 413)
        aircraft = self.store.get_aircraft(q.get("aircraft_id", ""))
        if aircraft is None or aircraft["owner_sub"] != ident["sub"]:
            return _err("aircraft_required", "請先建立並選擇自己的飛機檔案。", 400)
        if aircraft["ecosystem"] == "other":
            return _err("unsupported_ecosystem", "「其他飛控」目前只支援建立飛機檔案，尚不支援日誌分析。", 400)
        phase = q.get("phase", "PRACTICE").upper()
        if phase not in PHASES:
            return _err("invalid_phase", "測試階段必須是 BASELINE、AFTER_TUNING 或 PRACTICE。", 400)
        data = await request.body()
        if not data:
            return _err("empty_file", "上傳的檔案是空的。", 400)
        if len(data) > MAX_LOG_BYTES:
            return _err("too_large", "日誌過大。", 413)
        detected = adapters.detect(data)
        if detected is None:
            return _err("unrecognized_format", "檔案內容不是可辨識的 Blackbox / DataFlash / ULog 日誌（系統依內容判斷，不依副檔名）。", 400)
        if detected != aircraft["ecosystem"]:
            return _err("ecosystem_mismatch", f"檔案內容判定為 {ECOSYSTEMS.get(detected)}，但飛機檔案設定為 {ECOSYSTEMS.get(aircraft['ecosystem'])}；請確認是否選錯飛機或檔案。", 409)
        sha = hashlib.sha256(data).hexdigest()
        dup = self.store.find_duplicate(ident["sub"], sha)
        if dup and q.get("allow_duplicate") != "1":
            return _json({"duplicate": True, "log": dup, "message": "這個檔案已經上傳過，直接沿用先前的分析。"}, 200)
        conditions = {k: q.get(k, "")[:200] for k in ("battery_id", "props", "payload", "wind", "notes", "param_version") if q.get(k)}
        self.store.save_raw(sha, data)
        log = self.store.create_log(ident["sub"], ident["cohort"], aircraft["id"], sha, filename, len(data), aircraft["ecosystem"], phase, conditions)
        self.store.audit(ident["sub"], "log.upload", log["id"], {"sha256": sha, "size": len(data)})
        if self.inline_jobs:
            self._analyze_job(log["id"])
        else:
            asyncio.get_running_loop().run_in_executor(self.executor, self._analyze_job, log["id"])
        return _json({"duplicate": False, "log": self.store.get_log(log["id"])}, 202)

    async def list_logs(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        owner, cohorts = self._scope(ident)
        return _json({"logs": self.store.list_logs(owner, cohorts, request.query_params.get("aircraft_id"))})

    async def get_log(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        log = self.store.get_log(request.path_params["lid"])
        if not self._can_read(ident, log):
            return _err("not_found", "找不到日誌。", 404)
        return _json(log)

    async def get_analysis(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        log = self.store.get_log(request.path_params["lid"])
        if not self._can_read(ident, log):
            return _err("not_found", "找不到日誌。", 404)
        if log["status"] != "DONE":
            return _err("not_ready", f"分析狀態：{log['status']}" + (f"（{log['error']}）" if log.get("error") else ""), 409)
        result = self.store.load_analysis(log["id"])
        if result is None:
            return _err("missing_result", "分析結果遺失，請重新上傳。", 410)
        result.pop("param_snapshot", None) if request.query_params.get("params") == "0" else None
        return _json(result)

    async def create_plan(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        log = self.store.get_log(request.path_params["lid"])
        if not self._can_read(ident, log) or log["status"] != "DONE":
            return _err("not_found", "找不到已完成分析的日誌。", 404)
        result = self.store.load_analysis(log["id"])
        body = await request.json()
        wanted = set(body.get("suggestion_ids") or [])
        if result["advice"]["blocked"]:
            return _err("blocked", "此日誌存在安全或硬體風險（BLOCKED），不得建立調參方案。", 409)
        changes = []
        for s in result["advice"]["suggestions"]:
            if s["id"] not in wanted:
                continue
            if s["level"] != "REVIEW":
                return _err("not_reviewable", f"{s['id']} 不是可審核的建議（{s['level']}）。", 400)
            for p in s["params"]:
                if p.get("status") == "OK" and p.get("proposed") is not None:
                    changes.append({"name": p["name"], "current": p["current"], "value": p["proposed"], "suggestion_id": s["id"], "range": p["range"]})
        if not changes:
            return _err("no_changes", "請至少選擇一項含建議值的 REVIEW 建議。", 400)
        plan = self.store.create_plan(log, log["ecosystem_detected"], changes, sorted(wanted), str(body.get("note") or "")[:500])
        self.store.audit(ident["sub"], "plan.create", plan["id"])
        return _json(plan, 201)

    async def list_plans(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        owner, cohorts = self._scope(ident)
        return _json({"plans": self.store.list_plans(owner, cohorts, request.query_params.get("status"))})

    async def review_plan(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        if ident["role"] != "teacher":
            return _err("teacher_required", "只有教師可以審核調參方案。", 403)
        plan = self.store.get_plan(request.path_params["pid"])
        if not self._can_read(ident, plan):
            return _err("not_found", "找不到方案或不屬於您的班級。", 404)
        if plan["status"] != "PENDING_REVIEW":
            return _err("already_reviewed", "此方案已審核。", 409)
        body = await request.json()
        decision = str(body.get("decision") or "").upper()
        if decision not in ("APPROVED", "REJECTED"):
            return _err("invalid_decision", "審核結果必須是 APPROVED 或 REJECTED。", 400)
        note = str(body.get("note") or "").strip()[:1000]
        if not note:
            return _err("note_required", "請填寫審核意見（安全檢查、複測要求）。", 400)
        changes = None
        if body.get("values"):
            log = self.store.get_log(plan["log_id"])
            analysis = self.store.load_analysis(log["id"])
            fw = analysis["flight"]["firmware_version"]
            changes = []
            for c in plan["changes"]:
                value = body["values"].get(c["name"], c["value"])
                changes.append({**c, "value": float(value), "teacher_modified": float(value) != float(c["value"])})
            try:
                export_mod._approved_changes({"changes": changes}, analysis["flight"]["flight_controller_type"], fw)
            except export_mod.ExportError as exc:
                return _err("invalid_values", str(exc), 400)
        updated = self.store.review_plan(plan["id"], decision, ident["sub"], note, changes)
        self.store.audit(ident["sub"], f"plan.{decision.lower()}", plan["id"], {"note": note})
        return _json(updated)

    async def export_plan(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        plan = self.store.get_plan(request.path_params["pid"])
        if not self._can_read(ident, plan):
            return _err("not_found", "找不到方案。", 404)
        log = self.store.get_log(plan["log_id"])
        analysis = self.store.load_analysis(log["id"])
        meta = {
            "ecosystem": analysis["flight"]["flight_controller_type"],
            "firmware": analysis["flight"]["firmware_version"],
            "board": analysis["flight"]["hardware"].get("board"),
            "log_sha256": log["sha256"],
        }
        review = {"status": plan["status"], "reviewer": plan["reviewer"], "reviewed_at": time.strftime("%Y-%m-%d %H:%M", time.localtime(plan["reviewed_at"])) if plan["reviewed_at"] else None}
        try:
            out = export_mod.render(plan, meta, review)
        except export_mod.ExportError as exc:
            return _err("export_refused", str(exc), 409)
        self.store.audit(ident["sub"], "plan.export", plan["id"])
        if request.query_params.get("download") == "1":
            return Response(out["content"].encode("utf-8"), media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f"attachment; filename=\"{out['filename']}\""})
        return _json(out)

    async def create_comparison(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        body = await request.json()
        base = self.store.get_log(str(body.get("baseline_log_id") or ""))
        after = self.store.get_log(str(body.get("after_log_id") or ""))
        if not (self._can_read(ident, base) and self._can_read(ident, after)):
            return _err("not_found", "找不到要比較的日誌。", 404)
        if base["status"] != "DONE" or after["status"] != "DONE":
            return _err("not_ready", "兩份日誌都需完成分析。", 409)
        if base["owner_sub"] != after["owner_sub"]:
            return _err("owner_mismatch", "只能比較同一位學員的日誌。", 400)
        ba, aa = self.store.load_analysis(base["id"]), self.store.load_analysis(after["id"])
        meta = lambda log, an: {"ecosystem": log["ecosystem_detected"], "aircraft_id": log["aircraft_id"], "firmware_version": an["flight"]["firmware_version"].get("version")}  # noqa: E731
        result = compare_mod.compare(ba, aa, meta(base, ba), meta(after, aa))
        result["baseline"] = {"id": base["id"], "phase": base["phase"], "created_at": base["created_at"], "sha256": base["sha256"]}
        result["after"] = {"id": after["id"], "phase": after["phase"], "created_at": after["created_at"], "sha256": after["sha256"]}
        row = self.store.create_comparison(base["owner_sub"], base["cohort_id"], base["id"], after["id"], body.get("plan_id"), result)
        self.store.audit(ident["sub"], "comparison.create", row["id"], {"outcome": result["outcome"]})
        return _json(row, 201)

    async def list_comparisons(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        owner, cohorts = self._scope(ident)
        return _json({"comparisons": self.store.list_comparisons(owner, cohorts)})

    async def records(self, request):
        """學員成長檔案：飛機、日誌、方案、比較一次取回。教師可指定 student。"""
        ident, err = self._auth(request)
        if err:
            return err
        owner, cohorts = self._scope(ident)
        if ident["role"] == "teacher" and request.query_params.get("student"):
            student = request.query_params["student"]
            logs = [l for l in self.store.list_logs(None, cohorts) if l["owner_sub"] == student]
            return _json({"student": student, "logs": logs, "plans": [p for p in self.store.list_plans(None, cohorts) if p["owner_sub"] == student], "comparisons": [c for c in self.store.list_comparisons(None, cohorts) if c["owner_sub"] == student]})
        return _json({
            "identity": {"sub": ident["sub"], "role": ident["role"]},
            "aircraft": self.store.list_aircraft(owner, cohorts),
            "logs": self.store.list_logs(owner, cohorts),
            "plans": self.store.list_plans(owner, cohorts),
            "comparisons": self.store.list_comparisons(owner, cohorts),
        })

    # ------------------------------------------------------------ 教師標準參數庫
    async def list_library(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        if ident["role"] == "teacher":
            return _json({"library": self.store.list_library(ident["cohorts"])})
        # 學員只能看到 APPROVED 且與自己飛機相容的條目
        rows = self.store.list_library(ident["cohorts"], "APPROVED")
        aircraft = self.store.list_aircraft(ident["sub"], None)
        compat = []
        for row in rows:
            d = row["data"]
            matches = [a["id"] for a in aircraft if a["ecosystem"] == row["ecosystem"] and a["data"].get("firmware_version", "").split(".")[:2] == str(d.get("firmware_version", "")).split(".")[:2] and (not d.get("fc_model") or a["data"].get("fc_model") == d.get("fc_model"))]
            if matches:
                compat.append({**row, "compatible_aircraft": matches})
        return _json({"library": compat, "note": "只顯示教師審核通過、且與您的飛機飛控與韌體版本相容的參數；同型號仍需逐台安全檢查與複測。"})

    async def create_library(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        if ident["role"] != "teacher":
            return _err("teacher_required", "只有教師可以建立標準參數。", 403)
        body = await request.json()
        eco = str(body.get("ecosystem") or "")
        if eco not in ("betaflight", "ardupilot", "px4"):
            return _err("invalid_ecosystem", "請選擇 Betaflight / ArduPilot / PX4。", 400)
        keys = ("teaching_model", "fc_model", "firmware_version", "motor", "prop", "battery", "original_params", "optimized_params", "filters", "rates", "baseline_log_id", "after_log_id", "comparison_id", "notes")
        data = {k: body.get(k) for k in keys if body.get(k) is not None}
        if not data.get("teaching_model") or not data.get("firmware_version"):
            return _err("missing_fields", "請填寫教學機型號與韌體版本。", 400)
        row = self.store.create_library(ident["cohort"], ident["sub"], eco, data)
        self.store.audit(ident["sub"], "library.create", row["id"])
        return _json(row, 201)

    async def update_library(self, request):
        ident, err = self._auth(request)
        if err:
            return err
        if ident["role"] != "teacher":
            return _err("teacher_required", "只有教師可以修改標準參數。", 403)
        row = self.store.get_library(request.path_params["lid"])
        if row is None or row["cohort_id"] not in ident["cohorts"]:
            return _err("not_found", "找不到標準參數。", 404)
        body = await request.json()
        status = str(body.get("status") or "").upper() or None
        data = row["data"]
        for k in ("baseline_log_id", "after_log_id", "comparison_id", "optimized_params", "filters", "rates", "notes"):
            if k in body:
                data[k] = body[k]
        if status and status not in ("DRAFT", "TESTING", "APPROVED", "RETIRED"):
            return _err("invalid_status", "狀態必須是 DRAFT / TESTING / APPROVED / RETIRED。", 400)
        if status == "APPROVED":
            cmp = self.store.get_comparison(str(data.get("comparison_id") or ""))
            if not data.get("baseline_log_id") or not data.get("after_log_id") or cmp is None:
                return _err("evidence_required", "標記為 APPROVED 前必須附上 BASELINE、AFTER_TUNING 日誌與前後比較。", 409)
            if cmp["result"]["outcome"] != "IMPROVED":
                return _err("not_improved", f"前後比較結果為 {cmp['result']['outcome']}，未經實測改善不得標記為標準教學參數。", 409)
            if cmp["cohort_id"] not in ident["cohorts"]:
                return _err("not_found", "比較紀錄不屬於您的班級。", 404)
        updated = self.store.update_library(row["id"], status, data, ident["sub"] if status == "APPROVED" else None)
        self.store.audit(ident["sub"], "library.update", row["id"], {"status": status})
        return _json(updated)

    def routes(self) -> list[Route]:
        p = PREFIX
        return [
            Route(f"{p}/meta", self.meta, methods=["GET"]),
            Route(f"{p}/aircraft", self.list_aircraft, methods=["GET"]),
            Route(f"{p}/aircraft", self.create_aircraft, methods=["POST"]),
            Route(f"{p}/aircraft/{{aid}}", self.get_aircraft, methods=["GET"]),
            Route(f"{p}/aircraft/{{aid}}", self.update_aircraft, methods=["PUT"]),
            Route(f"{p}/aircraft/{{aid}}/params", self.import_params, methods=["POST"]),
            Route(f"{p}/logs", self.list_logs, methods=["GET"]),
            Route(f"{p}/logs", self.upload_log, methods=["POST"]),
            Route(f"{p}/logs/{{lid}}", self.get_log, methods=["GET"]),
            Route(f"{p}/logs/{{lid}}/analysis", self.get_analysis, methods=["GET"]),
            Route(f"{p}/logs/{{lid}}/plans", self.create_plan, methods=["POST"]),
            Route(f"{p}/plans", self.list_plans, methods=["GET"]),
            Route(f"{p}/plans/{{pid}}/review", self.review_plan, methods=["POST"]),
            Route(f"{p}/plans/{{pid}}/export", self.export_plan, methods=["GET"]),
            Route(f"{p}/comparisons", self.list_comparisons, methods=["GET"]),
            Route(f"{p}/comparisons", self.create_comparison, methods=["POST"]),
            Route(f"{p}/records", self.records, methods=["GET"]),
            Route(f"{p}/library", self.list_library, methods=["GET"]),
            Route(f"{p}/library", self.create_library, methods=["POST"]),
            Route(f"{p}/library/{{lid}}", self.update_library, methods=["PUT"]),
        ]
