"""開發用模擬飛控：用 pymavlink 送出真實 MAVLink 封包，供 FDE-GCS 端到端測試（不是 ArduPilot SITL）。

- 每秒送 ArduCopter 心跳（LOITER、已上鎖）
- 依 SET_MESSAGE_INTERVAL 回傳 SYS_STATUS／GPS_RAW_INT／ATTITUDE／GLOBAL_POSITION_INT
- REQUEST_MESSAGE 148 → AUTOPILOT_VERSION
- PARAM_REQUEST_LIST → 送出全部參數，第一輪刻意丟掉約 5%，用來驗證補讀
- PARAM_REQUEST_READ（依索引）→ 回傳該參數
- PARAM_SET → 更新參數並回傳 PARAM_VALUE（白名單以外的參數視為不允許）
- --armed：心跳回報「已解鎖」，用來驗證解鎖時無法寫入
- 收到的每一則訊息都記錄到 --log，結束時檢查有沒有不允許的訊息

用法：python mock_vehicle.py --port 8263 --log received.json --params 400
"""
import argparse
import json
import math
import random
import socket
import time

from pymavlink.dialects.v20 import ardupilotmega as mavlink

ALLOWED = {"HEARTBEAT", "PARAM_REQUEST_LIST", "PARAM_REQUEST_READ", "COMMAND_LONG", "PARAM_SET"}
ALLOWED_COMMANDS = {511, 512}
WRITABLE = {"ATC_RAT_%s_%s" % (axis, term) for axis in ("RLL", "PIT", "YAW") for term in ("P", "I", "D")}


class Conn:
    def __init__(self, sock):
        self.sock = sock

    def write(self, data):
        self.sock.sendall(data)


def build_params(count):
    params = [("FRAME_CLASS", 1.0, 2), ("FRAME_TYPE", 1.0, 2), ("ATC_RAT_RLL_P", 0.135, 9), ("ATC_RAT_PIT_P", 0.135, 9)]
    i = 0
    while len(params) < count:
        params.append(("FDE_TEST_%03d" % i, round(i * 0.25, 2), 9 if i % 2 else 4))
        i += 1
    return params


def serve(args):
    params = build_params(args.params)
    received = []
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", args.port))
    server.listen(1)
    print("mock vehicle listening on", args.port, flush=True)
    sock, _ = server.accept()
    sock.setblocking(False)
    mav = mavlink.MAVLink(Conn(sock), srcSystem=1, srcComponent=1)
    intervals = {}
    last_sent = {}
    last_hb = 0
    start = time.time()
    rng = random.Random(7)
    try:
        while time.time() - start < args.duration:
            now = time.time()
            if now - last_hb >= 1:
                mav.heartbeat_send(2, 3, 209 if args.armed else 81, 5, 4 if args.armed else 3, 3)
                last_hb = now
            for msg_id, interval in intervals.items():
                if now - last_sent.get(msg_id, 0) < interval:
                    continue
                last_sent[msg_id] = now
                t = now - start
                if msg_id == 1:
                    mav.sys_status_send(1, 1, 1, 500, 12456, 153, 87, 0, 0, 0, 0, 0, 0)
                elif msg_id == 24:
                    mav.gps_raw_int_send(int(t * 1e6), 6, 241908834, 1205945494, 120000, 80, 120, 0, 0, 14)
                elif msg_id == 30:
                    mav.attitude_send(int(t * 1000), 0.05 * math.sin(t), -0.03, 1.2, 0, 0, 0)
                elif msg_id == 33:
                    mav.global_position_int_send(int(t * 1000), 241908834, 1205945494, 120000, 0, 0, 0, 0, 7000)
            try:
                data = sock.recv(4096)
            except BlockingIOError:
                time.sleep(0.01)
                continue
            if not data:
                break
            for msg in mav.parse_buffer(data) or []:
                name = msg.get_type()
                entry = {"name": name}
                if name == "COMMAND_LONG":
                    entry["command"] = msg.command
                if name == "PARAM_SET":
                    entry["param_id"] = msg.param_id
                    entry["value"] = msg.param_value
                received.append(entry)
                if name == "COMMAND_LONG" and msg.command == 511:
                    intervals[int(msg.param1)] = msg.param2 / 1e6
                    mav.command_ack_send(511, 0)
                elif name == "COMMAND_LONG" and msg.command == 512 and int(msg.param1) == 148:
                    mav.autopilot_version_send(0, 0x040500FF, 0, 0, 0, [0] * 8, [0] * 8, [0] * 8, 0, 0, 0)
                    mav.command_ack_send(512, 0)
                elif name == "PARAM_REQUEST_LIST":
                    for index, (pname, value, ptype) in enumerate(params):
                        if rng.random() < args.drop:
                            continue
                        mav.param_value_send(pname.encode(), value, ptype, len(params), index)
                elif name == "PARAM_REQUEST_READ":
                    index = msg.param_index
                    if index < 0:
                        index = next((i for i, p in enumerate(params) if p[0] == msg.param_id), -1)
                    if 0 <= index < len(params):
                        pname, value, ptype = params[index]
                        mav.param_value_send(pname.encode(), value, ptype, len(params), index)
                elif name == "PARAM_SET":
                    index = next((i for i, p in enumerate(params) if p[0] == msg.param_id), -1)
                    if index >= 0 and not args.armed:
                        pname, _, ptype = params[index]
                        params[index] = (pname, msg.param_value, ptype)
                        mav.param_value_send(pname.encode(), msg.param_value, ptype, len(params), index)
    finally:
        sock.close()
        server.close()
        forbidden = [r for r in received if r["name"] not in ALLOWED
                     or (r["name"] == "COMMAND_LONG" and r["command"] not in ALLOWED_COMMANDS)
                     or (r["name"] == "PARAM_SET" and (r["param_id"] not in WRITABLE or args.armed))]
        with open(args.log, "w", encoding="utf-8") as fh:
            json.dump({"received": received, "forbidden": forbidden}, fh, ensure_ascii=False, indent=1)
        print("received", len(received), "forbidden", len(forbidden), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8263)
    parser.add_argument("--log", default="mock_vehicle_received.json")
    parser.add_argument("--params", type=int, default=400)
    parser.add_argument("--drop", type=float, default=0.05)
    parser.add_argument("--duration", type=float, default=60)
    parser.add_argument("--armed", action="store_true")
    serve(parser.parse_args())
