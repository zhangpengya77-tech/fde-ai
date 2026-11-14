"""
FDE-GCS SITL Gateway（P4／S6：多機仿真）——只連本機 ArduPilot SITL，絕不連真實飛控。

- WebSocket：ws://127.0.0.1:8261/?ticket=<Django 簽發的短效票證>
  - 唯讀票（scope=read）：只收多機遙測。
  - 控制票（scope=control，只有教師拿得到）：另外可送一鍵起飛／降落／返航／開始任務／編隊指令。
  - 票證以 HMAC-SHA256 簽章（金鑰 FDE_GCS_GATEWAY_SECRET，與 Django 相同），驗證到期時間與撤銷名單。
- 每架 SITL 由「腳本埠」tcp:127.0.0.1:(5763 + 10×i) 連入（SITL 的 SERIAL2），
  不占用地面站（UDP 14550）與考照場景轉接程式（SERIAL1）。
- 只接受 127.0.0.1 的 SITL：--sitl-host 寫死，不提供任何序列埠／遠端位址選項。
- POST /revoke（標頭 X-Gateway-Secret）：Django 教師撤銷控制票時呼叫，撤銷所有控制票或指定 jti。
- GET /health：服務狀態（不含遙測細節以外的資訊）。
- 編隊進行中寫入隊形檔（--formation-file），考照場景的轉接程式會轉給 3D 畫面顯示目標圈與誤差。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import re
import threading
import time
from http import HTTPStatus
from pathlib import Path

from pymavlink import mavutil
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

SITL_HOST = "127.0.0.1"          # 寫死：只連本機 SITL
R_EARTH = 6_371_000.0
MODE_GUIDED, MODE_AUTO, MODE_RTL, MODE_LAND, MODE_BRAKE = 4, 3, 6, 9, 17
MODE_NAMES = {v: k for k, v in mavutil.mode_mapping_acm.items()}
LOCAL_ORIGIN = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$")


# ---------------------------------------------------------------- 票證
def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_ticket(ticket: str, secret: bytes, revoked: set[str], revoke_all_before: float, now: float | None = None) -> dict | None:
    """回傳票證內容；簽章錯誤、過期、被撤銷、格式不符都回 None。"""
    now = time.time() if now is None else now
    try:
        body, sig = ticket.split(".", 1)
        expect = hmac.new(secret, body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expect, _b64d(sig)):
            return None
        claims = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(claims, dict) or claims.get("v") != 1 or claims.get("inst") != "sitl-fleet":
        return None
    if claims.get("scope") not in ("read", "control"):
        return None
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now:
        return None
    if claims.get("jti") in revoked:
        return None
    if claims["scope"] == "control" and claims.get("iat", 0) < revoke_all_before:
        return None
    return claims


# ---------------------------------------------------------------- 隊形（與模擬器 formation.ts 相同公式）
def formation_offsets(shape: str, n: int, s: float, heading_deg: float) -> list[tuple[float, float]]:
    """各機相對領航機的（東, 北）偏移；第 0 架為 (0, 0)。"""
    r = math.radians(heading_deg)
    out = []
    for k in range(n):
        if k == 0:
            right, fwd = 0.0, 0.0
        elif shape == "line":
            right, fwd = k * s, 0.0
        elif shape == "column":
            right, fwd = 0.0, -k * s
        else:  # triangle
            row = math.ceil(k / 2)
            right, fwd = (-1 if k % 2 == 1 else 1) * row * s, -row * s
        out.append((right * math.cos(r) + fwd * math.sin(r), -right * math.sin(r) + fwd * math.cos(r)))
    return out


class Trapezoid:
    """一段直線的速度曲線：等加速 → 等速 → 等減速。"""

    def __init__(self, dist: float, vmax: float, acc: float) -> None:
        self.d, self.a = dist, acc
        self.v = min(vmax, math.sqrt(max(dist, 1e-6) * acc))
        self.ta = self.v / acc
        self.tc = max(0.0, (dist - self.v * self.ta) / self.v)
        self.duration = 2 * self.ta + self.tc

    def at(self, t: float) -> tuple[float, float]:
        if t <= 0:
            return 0.0, 0.0
        if t < self.ta:
            return 0.5 * self.a * t * t, self.a * t
        d_acc = 0.5 * self.a * self.ta * self.ta
        if t < self.ta + self.tc:
            return d_acc + self.v * (t - self.ta), self.v
        td = t - self.ta - self.tc
        if td < self.ta:
            return d_acc + self.v * self.tc + self.v * td - 0.5 * self.a * td * td, self.v - self.a * td
        return self.d, 0.0


# ---------------------------------------------------------------- 單架 SITL
class Vehicle:
    def __init__(self, idx: int, port: int) -> None:
        self.idx, self.port = idx, port
        self.m = None
        self.lock = threading.Lock()
        self.linked = False
        self.last_rx = 0.0
        self.sysid = idx + 1
        self.lat = self.lon = 0.0
        self.alt = 0.0
        self.vn = self.ve = 0.0
        self.armed = False
        self.mode = -1
        self.gps_fix = self.sats = 0
        self.battery: int | None = None
        self.home: tuple[float, float] | None = None
        self.boot_ms = 0
        self.last_text = ""

    def loop(self, stop: threading.Event) -> None:
        """背景執行緒：連線、讀遙測；斷線自動重連（每次都關閉舊連線，避免占住 SITL 的 TCP 埠）。"""
        while not stop.is_set():
            m = None
            try:
                m = mavutil.mavlink_connection(f"tcp:{SITL_HOST}:{self.port}", source_system=255, source_component=194)
                if m.wait_heartbeat(timeout=10) is None:
                    raise TimeoutError("no heartbeat")
                self.sysid = m.target_system
                m.mav.request_data_stream_send(m.target_system, 1, mavutil.mavlink.MAV_DATA_STREAM_ALL, 10, 1)
                m.mav.command_long_send(m.target_system, 1, mavutil.mavlink.MAV_CMD_REQUEST_MESSAGE, 0,
                                        mavutil.mavlink.MAVLINK_MSG_ID_HOME_POSITION, 0, 0, 0, 0, 0, 0)
                with self.lock:
                    self.m = m
                self.last_rx = time.time()
                while not stop.is_set():
                    msg = m.recv_match(blocking=True, timeout=1.0)
                    if msg is None:
                        if time.time() - self.last_rx > 5:
                            raise TimeoutError("silent")
                        continue
                    if msg.get_srcSystem() != m.target_system:
                        continue
                    self.last_rx = time.time()
                    self._on(msg)
            except Exception:  # noqa: BLE001 — 任何錯誤都重連
                pass
            finally:
                with self.lock:
                    self.m = None
                if m is not None:
                    try:
                        m.close()
                    except Exception:  # noqa: BLE001
                        pass
            self.linked = False
            time.sleep(2)

    def _on(self, msg) -> None:
        t = msg.get_type()
        if t == "HEARTBEAT" and msg.type != mavutil.mavlink.MAV_TYPE_GCS:
            self.armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
            self.mode = msg.custom_mode
            self.linked = True
        elif t == "GLOBAL_POSITION_INT":
            self.lat, self.lon, self.alt = msg.lat / 1e7, msg.lon / 1e7, msg.relative_alt / 1000
            self.vn, self.ve = msg.vx / 100, msg.vy / 100
            self.boot_ms = msg.time_boot_ms
        elif t == "GPS_RAW_INT":
            self.gps_fix, self.sats = msg.fix_type, msg.satellites_visible
        elif t == "SYS_STATUS":
            self.battery = msg.battery_remaining if msg.battery_remaining >= 0 else None
        elif t == "HOME_POSITION":
            self.home = (msg.latitude / 1e7, msg.longitude / 1e7)
        elif t == "STATUSTEXT":
            self.last_text = msg.text

    # ---- 指令（只送給 SITL；沒有連線時略過）
    def _send(self, fn) -> bool:
        with self.lock:
            if self.m is None:
                return False
            fn(self.m)
            return True

    def cmd(self, command: int, *p: float) -> bool:
        ps = list(p) + [0.0] * (7 - len(p))
        return self._send(lambda m: m.mav.command_long_send(m.target_system, 1, command, 0, *ps))

    def set_mode(self, mode: int) -> bool:
        return self.cmd(mavutil.mavlink.MAV_CMD_DO_SET_MODE, mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode)

    def goto(self, lat: float, lon: float, alt: float, vn: float = 0.0, ve: float = 0.0, yaw_deg: float = 0.0) -> bool:
        mask = 0b1001_1100_0000  # 位置＋速度前饋＋機頭；忽略加速度與偏航角速度
        return self._send(lambda m: m.mav.set_position_target_global_int_send(
            0, m.target_system, 1, mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, mask,
            int(lat * 1e7), int(lon * 1e7), alt, vn, ve, 0, 0, 0, 0, math.radians(yaw_deg), 0))

    def snapshot(self) -> dict:
        online = self.linked and time.time() - self.last_rx < 3
        return {"id": self.idx + 1, "sysid": self.sysid, "online": online, "armed": self.armed,
                "mode": MODE_NAMES.get(self.mode, "—" if self.mode < 0 else str(self.mode)),
                "alt_m": round(self.alt, 2), "lat": self.lat, "lon": self.lon,
                "speed_mps": round(math.hypot(self.vn, self.ve), 2), "battery_pct": self.battery,
                "gps_fix": self.gps_fix, "sats": self.sats, "last_text": self.last_text}


# ---------------------------------------------------------------- 機隊與工作
class Fleet:
    def __init__(self, count: int, formation_file: Path | None) -> None:
        self.vs = [Vehicle(i, 5763 + 10 * i) for i in range(count)]
        self.stop = threading.Event()
        self.cancel = threading.Event()
        self.job_thread: threading.Thread | None = None
        self.job = {"name": "idle", "text": "待命", "ok": True}
        self.formation: dict | None = None
        self.errors: list[float] = []
        self.formation_file = formation_file
        for v in self.vs:
            threading.Thread(target=v.loop, args=(self.stop,), daemon=True).start()

    # ---- 座標工具（以第 1 架 Home 為共同原點）
    def origin(self) -> tuple[float, float] | None:
        v = self.vs[0]
        return v.home or ((v.lat, v.lon) if v.lat else None)

    def enu(self, v: Vehicle, o) -> tuple[float, float]:
        return (math.radians(v.lon - o[1]) * R_EARTH * math.cos(math.radians(o[0])), math.radians(v.lat - o[0]) * R_EARTH)

    def latlon(self, e: float, n: float, o) -> tuple[float, float]:
        return (o[0] + math.degrees(n / R_EARTH), o[1] + math.degrees(e / (R_EARTH * math.cos(math.radians(o[0])))))

    def status(self) -> dict:
        return {"type": "fleet", "t_ms": int(time.time() * 1000), "vehicles": [v.snapshot() for v in self.vs],
                "job": self.job, "formation": self.formation, "formation_err_m": self.errors}

    # ---- 工作排程：同一時間只有一個工作；新指令會取消舊工作
    def run(self, name: str, text: str, fn) -> None:
        self.cancel.set()
        if self.job_thread and self.job_thread.is_alive():
            self.job_thread.join(timeout=5)
        self.cancel = threading.Event()
        self.job = {"name": name, "text": text, "ok": True}
        cancel = self.cancel

        def wrapper():
            try:
                fn(cancel)
                if not cancel.is_set():
                    self.job = {"name": name, "text": f"{text}：完成", "ok": True}
            except Exception as e:  # noqa: BLE001
                self.job = {"name": name, "text": f"{text}：失敗（{e}）", "ok": False}
            finally:
                if name == "formation":
                    self._write_formation(False)
        self.job_thread = threading.Thread(target=wrapper, daemon=True)
        self.job_thread.start()

    def wait(self, cancel: threading.Event, pred, timeout: float, what: str) -> None:
        end = time.time() + timeout
        while time.time() < end:
            if cancel.is_set():
                raise RuntimeError("已被新指令取消")
            if pred():
                return
            time.sleep(0.1)
        raise TimeoutError(what)

    def _takeoff(self, cancel, alt: float) -> None:
        online = [v for v in self.vs if v.snapshot()["online"]]
        if not online:
            raise RuntimeError("沒有連線中的 SITL")
        for _ in range(30):
            for v in online:
                if not v.armed:
                    v.set_mode(MODE_GUIDED)
                    v.cmd(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 1)
            try:
                self.wait(cancel, lambda: all(v.armed for v in online), 2, "解鎖")
                break
            except TimeoutError:
                continue
        else:
            raise RuntimeError("解鎖失敗：" + "、".join(f"機{v.idx + 1} {v.last_text}" for v in online if not v.armed))
        for v in online:
            v.cmd(mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, alt)
        self.wait(cancel, lambda: all(v.alt > alt * 0.9 for v in online), 120, "爬升逾時")

    # ---- 對外指令
    def command(self, action: str, a: dict) -> str:
        alt = float(min(max(float(a.get("alt", 8)), 3), 30))
        if action == "takeoff":
            self.run("takeoff", f"一鍵起飛 {alt:g} m", lambda c: self._takeoff(c, alt))
        elif action == "mission_start":
            def mission(c):
                self._takeoff(c, alt)
                for v in self.vs:
                    v.cmd(mavutil.mavlink.MAV_CMD_MISSION_START)
                self.wait(c, lambda: all(v.mode == MODE_AUTO for v in self.vs if v.armed), 10, "切換 AUTO 逾時")
            self.run("mission", "開始任務（先起飛再 AUTO）", mission)
        elif action in ("land", "rtl", "brake"):
            mode = {"land": MODE_LAND, "rtl": MODE_RTL, "brake": MODE_BRAKE}[action]
            text = {"land": "全部降落", "rtl": "全部返航", "brake": "全部停在原地"}[action]
            self.run(action, text, lambda c: [v.set_mode(mode) for v in self.vs])
        elif action == "formation":
            shape = a.get("shape") if a.get("shape") in ("line", "triangle", "column") else "triangle"
            spacing = float(min(max(float(a.get("spacing", 3)), 2), 20))
            heading = float(a.get("heading", 0)) % 360
            path = a.get("path") if a.get("path") in ("hold", "square") else "square"
            leg = float(min(max(float(a.get("leg", 8)), 4), 40))
            self.run("formation", f"編隊（{shape}、間距 {spacing:g} m）",
                     lambda c: self._formation(c, shape, spacing, heading, alt, path, leg))
        else:
            raise ValueError("不支援的指令")
        return self.job["text"]

    def _write_formation(self, active: bool) -> None:
        if not self.formation_file or not self.formation:
            return
        try:
            self.formation_file.parent.mkdir(parents=True, exist_ok=True)
            self.formation_file.write_text(json.dumps({**self.formation, "active": active, "updated_unix": time.time()}), encoding="utf-8")
        except OSError:
            pass

    def _formation(self, cancel, shape, spacing, heading, alt, path, leg) -> None:
        """領航機＋僚機偏移跟隨（與模擬器驗收過的演算法相同）。"""
        vs = [v for v in self.vs if v.snapshot()["online"]]
        if len(vs) < 2:
            raise RuntimeError("至少要 2 架連線中的 SITL")
        if not all(v.armed and v.alt > 2 for v in vs):
            self._takeoff(cancel, alt)
        o = self.origin()
        offs = formation_offsets(shape, len(vs), spacing, heading)
        lead = vs[0]
        self.formation = {"shape": shape, "spacing_m": spacing, "heading_deg": heading, "count": len(vs)}
        last_file = 0.0

        def tick(lead_target, v_lead=(0.0, 0.0)):
            nonlocal last_file
            le, ln = self.enu(lead, o)
            lat, lon = self.latlon(*lead_target, o)
            lead.goto(lat, lon, alt, v_lead[0], v_lead[1], heading)
            errs = []
            for v, (oe, on) in zip(vs[1:], offs[1:]):
                te, tn = le + oe, ln + on
                lat, lon = self.latlon(te, tn, o)
                v.goto(lat, lon, alt, v_lead[0], v_lead[1], heading)
                ve, vnn = self.enu(v, o)
                errs.append(round(math.hypot(ve - te, vnn - tn), 2))
            self.errors = errs
            if time.time() - last_file > 1:
                self._write_formation(True)
                last_file = time.time()

        anchor = self.enu(lead, o)
        # 集結：僚機到位
        self.job = {"name": "formation", "text": "編隊：集結中", "ok": True}
        end = time.time() + 90
        while time.time() < end:
            if cancel.is_set():
                return
            tick(anchor)
            if self.errors and max(self.errors) < 0.8:
                break
            time.sleep(0.1)
        if path == "square":
            r = math.radians(heading)
            f, rt = (math.sin(r), math.cos(r)), (math.cos(r), -math.sin(r))
            pts = [(0, 0), (f[0] * leg, f[1] * leg), (f[0] * leg + rt[0] * leg, f[1] * leg + rt[1] * leg), (rt[0] * leg, rt[1] * leg), (0, 0)]
            pts = [(anchor[0] + p[0], anchor[1] + p[1]) for p in pts]
            for k, (p, q) in enumerate(zip(pts[:-1], pts[1:]), 1):
                self.job = {"name": "formation", "text": f"編隊：正方形第 {k}/4 邊", "ok": True}
                dist = math.hypot(q[0] - p[0], q[1] - p[1])
                ux, uy = (q[0] - p[0]) / dist, (q[1] - p[1]) / dist
                prof = Trapezoid(dist, 1.5, 0.5)
                sim0, t0 = lead.boot_ms, time.time()
                while True:
                    if cancel.is_set():
                        return
                    along, vel = prof.at((lead.boot_ms - sim0) / 1000)   # 用飛控模擬時鐘推進
                    s = along / dist
                    tick((p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s), (uy * vel, ux * vel))
                    le, ln = self.enu(lead, o)
                    if s >= 1 and math.hypot(le - q[0], ln - q[1]) < 0.5:
                        break
                    if time.time() - t0 > prof.duration * 4 + 60:
                        raise TimeoutError(f"第 {k} 邊逾時")
                    time.sleep(0.1)
        # 之後保持隊形，直到下一個指令（降落、返航等）取消本工作
        self.job = {"name": "formation", "text": "編隊：保持隊形中", "ok": True}
        hold = self.enu(lead, o)
        while not cancel.is_set():
            tick(hold)
            time.sleep(0.2)


# ---------------------------------------------------------------- 伺服器
async def main() -> None:
    ap = argparse.ArgumentParser(description="FDE-GCS SITL Gateway（只連本機 SITL）")
    ap.add_argument("--count", type=int, default=3)
    ap.add_argument("--port", type=int, default=8261)
    ap.add_argument("--origin", action="append", default=[], help="另外允許的網頁來源（例如正式站網域）")
    ap.add_argument("--formation-file", default="", help="隊形檔（給考照場景轉接程式）")
    a = ap.parse_args()
    secret = os.environ.get("FDE_GCS_GATEWAY_SECRET", "").encode()
    if len(secret) < 16:
        raise SystemExit("請設定 FDE_GCS_GATEWAY_SECRET（至少 16 字元，與 Django 相同）")
    fleet = Fleet(min(max(a.count, 1), 6), Path(a.formation_file) if a.formation_file else None)
    revoked: set[str] = set()
    state = {"revoke_all_before": 0.0}
    extra_origins = set(a.origin)
    clients: dict[ServerConnection, dict] = {}

    def http(connection: ServerConnection, request: Request) -> Response | None:
        if request.path.startswith("/health"):
            body = json.dumps({"ok": True, "vehicles": sum(v.snapshot()["online"] for v in fleet.vs)}).encode()
            return Response(HTTPStatus.OK.value, "OK", Headers({"Content-Type": "application/json"}), body)
        origin = request.headers.get("Origin")
        if origin is not None and not (LOCAL_ORIGIN.match(origin) or origin in extra_origins):
            return Response(HTTPStatus.FORBIDDEN.value, "Forbidden", Headers(), b"origin")
        ticket = request.path.split("ticket=", 1)[1].split("&", 1)[0] if "ticket=" in request.path else ""
        claims = verify_ticket(ticket, secret, revoked, state["revoke_all_before"])
        if claims is None:
            return Response(HTTPStatus.UNAUTHORIZED.value, "Unauthorized", Headers(), b"ticket")
        connection.claims = claims  # type: ignore[attr-defined]
        return None

    async def handler(ws: ServerConnection) -> None:
        claims = getattr(ws, "claims", {})
        clients[ws] = claims
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if msg.get("type") != "cmd":
                    continue
                c = claims
                if c.get("scope") != "control" or not verify_ticket_live(c):
                    await ws.send(json.dumps({"type": "ack", "ok": False, "error": "需要有效的教師控制票"}))
                    continue
                try:
                    text = fleet.command(str(msg.get("action")), msg.get("args") or {})
                    print(f"[指令] {c.get('sub')} {msg.get('action')} {msg.get('args')}", flush=True)
                    await ws.send(json.dumps({"type": "ack", "ok": True, "text": text}, ensure_ascii=False))
                except (ValueError, TypeError) as e:
                    await ws.send(json.dumps({"type": "ack", "ok": False, "error": str(e)}, ensure_ascii=False))
        except ConnectionClosed:
            pass
        finally:
            clients.pop(ws, None)

    def verify_ticket_live(c: dict) -> bool:
        # 控制票在每個指令都重新檢查：過期或被撤銷就拒絕
        return c["exp"] >= time.time() and c.get("jti") not in revoked and c.get("iat", 0) >= state["revoke_all_before"]

    async def broadcast() -> None:
        while True:
            if clients:
                body = json.dumps(fleet.status(), ensure_ascii=False)
                for ws, c in list(clients.items()):
                    if c.get("exp", 0) < time.time() or c.get("jti") in revoked:
                        await ws.close(4001, "ticket expired")
                        continue
                    try:
                        await ws.send(body)
                    except ConnectionClosed:
                        clients.pop(ws, None)
            await asyncio.sleep(0.2)

    async def revoke_server(reader, writer) -> None:
        # 簡易 HTTP：POST /revoke，標頭 X-Gateway-Secret；只綁 127.0.0.1（給 Django 呼叫）
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
            lines = head.decode("latin-1").split("\r\n")
            hdr = {k.lower(): v.strip() for k, v in (ln.split(":", 1) for ln in lines[1:] if ":" in ln)}
            length = int(hdr.get("content-length", "0") or 0)
            body = json.loads((await reader.readexactly(length)) or b"{}") if length else {}
            ok = lines[0].startswith("POST /revoke") and hmac.compare_digest(hdr.get("x-gateway-secret", "").encode(), secret)
            if ok:
                if body.get("jti"):
                    revoked.add(str(body["jti"]))
                else:
                    state["revoke_all_before"] = time.time()
                    for ws, c in list(clients.items()):
                        if c.get("scope") == "control":
                            await ws.close(4003, "revoked")
                fleet.command("brake", {}) if body.get("brake") else None
            writer.write(b"HTTP/1.1 " + (b"200 OK" if ok else b"403 Forbidden") + b"\r\nContent-Length: 0\r\n\r\n")
        except Exception:  # noqa: BLE001
            writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
        finally:
            await writer.drain()
            writer.close()

    revoke_srv = await asyncio.start_server(revoke_server, "127.0.0.1", a.port + 100)  # 8361：撤銷專用
    async with serve(handler, "127.0.0.1", a.port, process_request=http), revoke_srv:
        print(f"[FDE-GCS Gateway] ws://127.0.0.1:{a.port}  撤銷 http://127.0.0.1:{a.port + 100}/revoke  "
              f"SITL {len(fleet.vs)} 架（tcp:{SITL_HOST}:5763+10i）", flush=True)
        await broadcast()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
