"""PID & Filter Lab 的持久化（SQLite + 檔案），與 Live 其他資料完全分開。

- 原始日誌以 SHA-256 命名存放（同內容只存一份），不會上傳到任何外部服務。
- 每筆分析結果記錄 pipeline / 演算法版本。
- 權限：學員只能看自己的資料；教師只能看自己班級（cohort）的資料。
"""

from __future__ import annotations

import contextlib
import gzip
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS aircraft (
  id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, cohort_id TEXT NOT NULL,
  name TEXT NOT NULL, ecosystem TEXT NOT NULL, data TEXT NOT NULL,
  created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS param_imports (
  id TEXT PRIMARY KEY, aircraft_id TEXT NOT NULL, owner_sub TEXT NOT NULL, cohort_id TEXT NOT NULL,
  ecosystem TEXT NOT NULL, kind TEXT NOT NULL, raw_text TEXT NOT NULL, parsed TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, cohort_id TEXT NOT NULL, aircraft_id TEXT NOT NULL,
  sha256 TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL,
  ecosystem_selected TEXT NOT NULL, ecosystem_detected TEXT, phase TEXT NOT NULL, conditions TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, pipeline_version TEXT, summary TEXT,
  created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_owner ON logs(owner_sub, sha256);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, log_id TEXT NOT NULL, owner_sub TEXT NOT NULL, cohort_id TEXT NOT NULL,
  ecosystem TEXT NOT NULL, changes TEXT NOT NULL, suggestion_ids TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL, reviewer TEXT, review_note TEXT, reviewed_at REAL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY, owner_sub TEXT NOT NULL, cohort_id TEXT NOT NULL,
  baseline_log TEXT NOT NULL, after_log TEXT NOT NULL, plan_id TEXT, result TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL, created_by TEXT NOT NULL, ecosystem TEXT NOT NULL,
  status TEXT NOT NULL, data TEXT NOT NULL, approved_by TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT NOT NULL, detail TEXT, at REAL NOT NULL
);
"""


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class LabStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        (self.root / "raw").mkdir(parents=True, exist_ok=True)
        (self.root / "analyses").mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "pid_lab.sqlite3"
        self._lock = threading.RLock()
        with self._conn() as c:
            c.executescript(SCHEMA)
            # 服務重啟時，中斷的任務標為失敗而不是假裝完成
            c.execute("UPDATE logs SET status='FAILED', error='服務重新啟動，分析中斷，請重新上傳' WHERE status IN ('QUEUED','PARSING')")

    @contextlib.contextmanager
    def _conn(self):
        # sqlite3 的 with 只負責 commit，不會關閉連線；這裡明確關閉，避免 Windows 檔案鎖與連線洩漏。
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _exec(self, sql: str, args: tuple = ()) -> None:
        with self._lock, self._conn() as c:
            c.execute(sql, args)

    def _one(self, sql: str, args: tuple = ()) -> dict | None:
        with self._conn() as c:
            row = c.execute(sql, args).fetchone()
        return dict(row) if row else None

    def _all(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute(sql, args).fetchall()]

    def audit(self, actor: str, action: str, target: str, detail: dict | None = None) -> None:
        self._exec("INSERT INTO audit(actor, action, target, detail, at) VALUES (?,?,?,?,?)", (actor, action, target, json.dumps(detail or {}, ensure_ascii=False), time.time()))

    # ------------------------------------------------------------ 機體
    def create_aircraft(self, owner: str, cohort: str, name: str, ecosystem: str, data: dict) -> dict:
        aid, now = _id("AC"), time.time()
        self._exec("INSERT INTO aircraft VALUES (?,?,?,?,?,?,?,?)", (aid, owner, cohort, name, ecosystem, json.dumps(data, ensure_ascii=False), now, now))
        return self.get_aircraft(aid)

    def update_aircraft(self, aid: str, name: str, ecosystem: str, data: dict) -> dict:
        self._exec("UPDATE aircraft SET name=?, ecosystem=?, data=?, updated_at=? WHERE id=?", (name, ecosystem, json.dumps(data, ensure_ascii=False), time.time(), aid))
        return self.get_aircraft(aid)

    def get_aircraft(self, aid: str) -> dict | None:
        row = self._one("SELECT * FROM aircraft WHERE id=?", (aid,))
        if row:
            row["data"] = json.loads(row["data"])
        return row

    def list_aircraft(self, owner: str | None, cohorts: list[str] | None) -> list[dict]:
        rows = self._scoped("aircraft", owner, cohorts, "updated_at DESC")
        for r in rows:
            r["data"] = json.loads(r["data"])
        return rows

    def _scoped(self, table: str, owner: str | None, cohorts: list[str] | None, order: str, extra: str = "", args: tuple = ()) -> list[dict]:
        if owner is not None:
            return self._all(f"SELECT * FROM {table} WHERE owner_sub=? {extra} ORDER BY {order}", (owner, *args))
        if not cohorts:
            return []
        marks = ",".join("?" * len(cohorts))
        return self._all(f"SELECT * FROM {table} WHERE cohort_id IN ({marks}) {extra} ORDER BY {order}", (*cohorts, *args))

    # ------------------------------------------------------------ 參數匯入
    def add_param_import(self, aircraft: dict, ecosystem: str, kind: str, raw: str, parsed: dict) -> dict:
        pid = _id("PI")
        self._exec("INSERT INTO param_imports VALUES (?,?,?,?,?,?,?,?,?)", (pid, aircraft["id"], aircraft["owner_sub"], aircraft["cohort_id"], ecosystem, kind, raw, json.dumps(parsed, ensure_ascii=False), time.time()))
        return {"id": pid, "kind": kind, "count": parsed.get("count"), "firmware": parsed.get("firmware"), "board": parsed.get("board")}

    def latest_params(self, aircraft_id: str) -> dict | None:
        row = self._one("SELECT * FROM param_imports WHERE aircraft_id=? ORDER BY created_at DESC LIMIT 1", (aircraft_id,))
        if row:
            row["parsed"] = json.loads(row["parsed"])
        return row

    def list_param_imports(self, aircraft_id: str) -> list[dict]:
        return [{"id": r["id"], "kind": r["kind"], "ecosystem": r["ecosystem"], "created_at": r["created_at"], "count": json.loads(r["parsed"]).get("count")} for r in self._all("SELECT * FROM param_imports WHERE aircraft_id=? ORDER BY created_at DESC", (aircraft_id,))]

    # ------------------------------------------------------------ 日誌
    def raw_path(self, sha: str) -> Path:
        return self.root / "raw" / sha[:2] / f"{sha}.log"

    def save_raw(self, sha: str, data: bytes) -> None:
        path = self.raw_path(sha)
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    def find_duplicate(self, owner: str, sha: str) -> dict | None:
        return self._one("SELECT * FROM logs WHERE owner_sub=? AND sha256=? AND status!='FAILED' ORDER BY created_at DESC LIMIT 1", (owner, sha))

    def create_log(self, owner, cohort, aircraft_id, sha, filename, size, ecosystem, phase, conditions) -> dict:
        lid, now = _id("LOG"), time.time()
        self._exec("INSERT INTO logs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (lid, owner, cohort, aircraft_id, sha, filename, size, ecosystem, None, phase, json.dumps(conditions, ensure_ascii=False), "QUEUED", None, None, None, now, now))
        return self.get_log(lid)

    def set_log_status(self, lid: str, status: str, error: str | None = None, detected: str | None = None, pipeline_version: str | None = None, summary: dict | None = None) -> None:
        self._exec(
            "UPDATE logs SET status=?, error=?, ecosystem_detected=COALESCE(?, ecosystem_detected), pipeline_version=COALESCE(?, pipeline_version), summary=COALESCE(?, summary), updated_at=? WHERE id=?",
            (status, error, detected, pipeline_version, json.dumps(summary, ensure_ascii=False) if summary else None, time.time(), lid),
        )

    def get_log(self, lid: str) -> dict | None:
        row = self._one("SELECT * FROM logs WHERE id=?", (lid,))
        if row:
            row["conditions"] = json.loads(row["conditions"])
            row["summary"] = json.loads(row["summary"]) if row["summary"] else None
        return row

    def list_logs(self, owner, cohorts, aircraft_id: str | None = None) -> list[dict]:
        extra, args = ("AND aircraft_id=?", (aircraft_id,)) if aircraft_id else ("", ())
        rows = self._scoped("logs", owner, cohorts, "created_at DESC", extra, args)
        for r in rows:
            r["conditions"] = json.loads(r["conditions"])
            r["summary"] = json.loads(r["summary"]) if r["summary"] else None
        return rows

    def save_analysis(self, lid: str, result: dict) -> None:
        path = self.root / "analyses" / f"{lid}.json.gz"
        tmp = path.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False)
        tmp.replace(path)

    def load_analysis(self, lid: str) -> dict | None:
        path = self.root / "analyses" / f"{lid}.json.gz"
        if not path.exists():
            return None
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return json.load(fh)

    # ------------------------------------------------------------ 參數方案與審核
    def create_plan(self, log: dict, ecosystem: str, changes: list, suggestion_ids: list, note: str) -> dict:
        pid = _id("PLAN")
        self._exec("INSERT INTO plans VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (pid, log["id"], log["owner_sub"], log["cohort_id"], ecosystem, json.dumps(changes, ensure_ascii=False), json.dumps(suggestion_ids), note, "PENDING_REVIEW", None, None, None, time.time()))
        return self.get_plan(pid)

    def get_plan(self, pid: str) -> dict | None:
        row = self._one("SELECT * FROM plans WHERE id=?", (pid,))
        if row:
            row["changes"] = json.loads(row["changes"])
            row["suggestion_ids"] = json.loads(row["suggestion_ids"])
            row["plan_id"] = row["id"]
        return row

    def list_plans(self, owner, cohorts, status: str | None = None) -> list[dict]:
        extra, args = ("AND status=?", (status,)) if status else ("", ())
        rows = self._scoped("plans", owner, cohorts, "created_at DESC", extra, args)
        for r in rows:
            r["changes"] = json.loads(r["changes"])
            r["suggestion_ids"] = json.loads(r["suggestion_ids"])
            r["plan_id"] = r["id"]
        return rows

    def review_plan(self, pid: str, status: str, reviewer: str, note: str, changes: list | None) -> dict:
        if changes is not None:
            self._exec("UPDATE plans SET changes=? WHERE id=?", (json.dumps(changes, ensure_ascii=False), pid))
        self._exec("UPDATE plans SET status=?, reviewer=?, review_note=?, reviewed_at=? WHERE id=?", (status, reviewer, note, time.time(), pid))
        return self.get_plan(pid)

    # ------------------------------------------------------------ 比較
    def create_comparison(self, owner, cohort, base_id, after_id, plan_id, result) -> dict:
        cid = _id("CMP")
        self._exec("INSERT INTO comparisons VALUES (?,?,?,?,?,?,?,?)", (cid, owner, cohort, base_id, after_id, plan_id, json.dumps(result, ensure_ascii=False), time.time()))
        return self.get_comparison(cid)

    def get_comparison(self, cid: str) -> dict | None:
        row = self._one("SELECT * FROM comparisons WHERE id=?", (cid,))
        if row:
            row["result"] = json.loads(row["result"])
        return row

    def list_comparisons(self, owner, cohorts) -> list[dict]:
        rows = self._scoped("comparisons", owner, cohorts, "created_at DESC")
        for r in rows:
            r["result"] = json.loads(r["result"])
        return rows

    # ------------------------------------------------------------ 教師標準參數庫
    def create_library(self, cohort, teacher, ecosystem, data) -> dict:
        lid, now = _id("LIB"), time.time()
        self._exec("INSERT INTO library VALUES (?,?,?,?,?,?,?,?,?)", (lid, cohort, teacher, ecosystem, "DRAFT", json.dumps(data, ensure_ascii=False), None, now, now))
        return self.get_library(lid)

    def get_library(self, lid: str) -> dict | None:
        row = self._one("SELECT * FROM library WHERE id=?", (lid,))
        if row:
            row["data"] = json.loads(row["data"])
        return row

    def update_library(self, lid: str, status: str | None = None, data: dict | None = None, approved_by: str | None = None) -> dict:
        if data is not None:
            self._exec("UPDATE library SET data=?, updated_at=? WHERE id=?", (json.dumps(data, ensure_ascii=False), time.time(), lid))
        if status is not None:
            self._exec("UPDATE library SET status=?, approved_by=COALESCE(?, approved_by), updated_at=? WHERE id=?", (status, approved_by, time.time(), lid))
        return self.get_library(lid)

    def list_library(self, cohorts: list[str], status: str | None = None) -> list[dict]:
        if not cohorts:
            return []
        marks = ",".join("?" * len(cohorts))
        sql = f"SELECT * FROM library WHERE cohort_id IN ({marks})" + (" AND status=?" if status else "") + " ORDER BY updated_at DESC"
        rows = self._all(sql, (*cohorts, status) if status else tuple(cohorts))
        for r in rows:
            r["data"] = json.loads(r["data"])
        return rows

    def list_audit(self, limit: int = 200) -> list[dict]:
        return self._all("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))
