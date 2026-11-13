"""用 pymavlink 產生標準封包，供 js_tests 比對 FDE-GCS 編解碼器（開發環境，需要 pymavlink）。

用法：python gcs_portal/tools/gen_mavlink_fixtures.py > gcs_portal/js_tests/fixtures/mavlink_fixtures.json
"""
import importlib.metadata
import json
import sys

from pymavlink.dialects.v10 import ardupilotmega as dialect_v1
from pymavlink.dialects.v20 import ardupilotmega as dialect


class Sink:
    def write(self, data):
        pass


def make(version, srcSystem=1, srcComponent=1):
    module = dialect_v1 if version == 1 else dialect
    return module.MAVLink(Sink(), srcSystem=srcSystem, srcComponent=srcComponent)


def plain(value):
    if isinstance(value, bytes):
        return value.rstrip(b"\x00").decode("utf-8")
    if isinstance(value, float):
        return value
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return int(value) if isinstance(value, int) and abs(value) < 2 ** 53 else str(value)


def frame(mav, msg):
    buf = msg.pack(mav)
    mav.seq = (mav.seq + 1) % 256
    return buf


SAMPLES = [
    lambda m: m.heartbeat_encode(2, 3, 209, 5, 3, 3),
    lambda m: m.heartbeat_encode(2, 3, 81, 0, 3, 3),
    lambda m: m.sys_status_encode(1, 1, 1, 500, 12456, 1534, 87, 0, 0, 0, 0, 0, 0),
    lambda m: m.gps_raw_int_encode(123456789, 3, 241908834, 1205945494, 120000, 80, 120, 0, 0, 14),
    lambda m: m.attitude_encode(1000, 0.1, -0.2, 1.5, 0.01, 0.02, 0.03),
    lambda m: m.global_position_int_encode(2000, 241908834, 1205945494, 120000, 25300, 10, -5, 0, 9000),
    lambda m: m.param_value_encode(b"ATC_RAT_RLL_P", 0.135, 9, 1234, 17),
    lambda m: m.param_value_encode(b"FRAME_CLASS", 1.0, 2, 1234, 0),
    lambda m: m.autopilot_version_encode(0, 0x040500FF, 0, 0, 0, [0] * 8, [0] * 8, [0] * 8, 0, 0, 0),
    lambda m: m.statustext_encode(6, b"ArduCopter V4.5.0"),
    lambda m: m.command_ack_encode(512, 0),
]

OUTGOING = [
    ("HEARTBEAT", dict(type=6, autopilot=8, base_mode=0, custom_mode=0, system_status=4, mavlink_version=3)),
    ("PARAM_REQUEST_LIST", dict(target_system=1, target_component=1)),
    ("PARAM_REQUEST_READ", dict(target_system=1, target_component=1, param_id="", param_index=42)),
    ("COMMAND_LONG", dict(target_system=1, target_component=1, command=511, confirmation=0,
                          param1=30, param2=200000, param3=0, param4=0, param5=0, param6=0, param7=0)),
    ("COMMAND_LONG", dict(target_system=1, target_component=1, command=512, confirmation=0,
                          param1=148, param2=0, param3=0, param4=0, param5=0, param6=0, param7=0)),
]


def build():
    incoming = []
    for version in (2, 1):
        mav = make(version)
        for sample in SAMPLES:
            msg = sample(mav)
            if version == 1 and msg.id > 255:
                continue
            raw = frame(mav, msg)
            fields = {name: plain(getattr(msg, name)) for name in msg.fieldnames}
            incoming.append({"version": version, "name": msg.get_type(), "hex": bytes(raw).hex(), "fields": fields})
    outgoing = []
    mav = make(2, srcSystem=255, srcComponent=190)
    for seq, (name, fields) in enumerate(OUTGOING):
        args = {k: (v.encode() if isinstance(v, str) else v) for k, v in fields.items()}
        msg = getattr(mav, name.lower() + "_encode")(**args)
        mav.seq = seq
        outgoing.append({"name": name, "seq": seq, "fields": fields, "hex": bytes(msg.pack(mav)).hex()})
    return {"pymavlink": importlib.metadata.version("pymavlink"), "incoming": incoming, "outgoing": outgoing}


if __name__ == "__main__":
    json.dump(build(), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
