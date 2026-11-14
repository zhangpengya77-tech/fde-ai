"""產生 FDE-GCS 前端使用的 MAVLink 訊息定義（defs.js）。

來源是 pymavlink 由官方 MAVLink XML（ardupilotmega 方言，含 common）產生的訊息類別。
依 MAVLink COPYING 的例外條款，產生器輸出的程式碼以 MIT 授權釋出；本檔輸出的 defs.js
只包含訊息編號、欄位名稱、型別、陣列長度與 CRC_EXTRA，不含任何 LGPL 執行期程式碼。

用法（開發環境，需要 pymavlink）：
    python gcs_portal/tools/gen_mavlink_defs.py > gcs_portal/static/gcs_portal/mavlink/defs.js
"""
import importlib.metadata
import json
import sys

from pymavlink.dialects.v20 import ardupilotmega as dialect

# 只包含需要的訊息；送出訊息另有白名單（codec.js），PARAM_SET 只有寫入模組能編碼。
MESSAGES = [
    "HEARTBEAT",
    "SYS_STATUS",
    "PARAM_REQUEST_READ",
    "PARAM_REQUEST_LIST",
    "PARAM_SET",
    "PARAM_VALUE",
    "GPS_RAW_INT",
    "ATTITUDE",
    "GLOBAL_POSITION_INT",
    "COMMAND_LONG",
    "COMMAND_ACK",
    "AUTOPILOT_VERSION",
    "STATUSTEXT",
]

TYPE_SIZES = {
    "char": 1, "uint8_t": 1, "int8_t": 1, "uint16_t": 2, "int16_t": 2,
    "uint32_t": 4, "int32_t": 4, "float": 4, "uint64_t": 8, "int64_t": 8, "double": 8,
}


def build():
    defs = {}
    for name in MESSAGES:
        cls = getattr(dialect, "MAVLink_%s_message" % name.lower())
        types = dict(zip(cls.fieldnames, cls.fieldtypes))
        fields = []
        offset = 0
        for field_name, array_length in zip(cls.ordered_fieldnames, cls.array_lengths):
            field_type = types[field_name]
            count = array_length or 1
            fields.append([field_name, field_type, array_length, offset])
            offset += TYPE_SIZES[field_type] * count
        if offset != cls.unpacker.size:
            raise SystemExit("payload size mismatch for %s" % name)
        defs[cls.id] = {"name": name, "crcExtra": cls.crc_extra, "length": offset, "fields": fields}
    return defs


def render():
    version = importlib.metadata.version("pymavlink")
    body = json.dumps(build(), ensure_ascii=False, indent=1, sort_keys=True)
    return (
        "// 本檔由 gcs_portal/tools/gen_mavlink_defs.py 自動產生，請勿手動修改。\n"
        "// 來源：pymavlink %s，ardupilotmega 方言（MAVLink v2）。\n"
        "// 授權：MAVLink 產生器輸出，依 MAVLink COPYING 例外條款以 MIT 授權釋出。\n"
        "// 欄位格式：[名稱, 型別, 陣列長度(0=單值), 位元組位移]，依線上傳輸順序排列。\n"
        "export const PYMAVLINK_VERSION = %s;\n"
        "export const MESSAGE_DEFS = %s;\n"
    ) % (version, json.dumps(version), body)


if __name__ == "__main__":
    sys.stdout.write(render())
