from __future__ import annotations


COMPONENT_IDS = frozenset({
    "F450_FRAME",
    "MOTOR_2212",
    "ESC_30A",
    "PIXHAWK_248",
    "GPS_COMPASS",
    "RC_RECEIVER",
    "TELEMETRY_RADIO",
    "POWER_MODULE",
    "PROPELLER_CW",
    "PROPELLER_CCW",
})

CONNECTOR_IDS = frozenset({
    "FC_MAIN_OUT_1",
    "FC_MAIN_OUT_2",
    "FC_MAIN_OUT_3",
    "FC_MAIN_OUT_4",
    "FC_GPS",
    "FC_I2C",
    "FC_TELEM1",
    "FC_TELEM2",
    "FC_RCIN",
})

POWER_IDS = frozenset({"ESC_POWER_POS", "ESC_POWER_NEG", "XT60_POS", "XT60_NEG"})

ERROR_CODES = frozenset({
    "ERR_COMPONENT_MISSING",
    "ERR_MOTOR_SCREW_RISK",
    "ERR_POWER_POLARITY",
    "ERR_RECEIVER_PINOUT",
    "ERR_FC_DIRECTION",
    "ERR_GPS_DIRECTION",
    "ERR_WRONG_MOTOR_PORT",
    "ERR_PROP_DIRECTION",
    "ERR_TEACHER_CHECK_REQUIRED",
    "ERR_CONTINUITY_CHECK_REQUIRED",
})

_CATALOGS = {
    "component": COMPONENT_IDS,
    "connector": CONNECTOR_IDS,
    "power": POWER_IDS,
    "error": ERROR_CODES,
}


def validate_identifier(kind: str, value: str) -> None:
    catalog = _CATALOGS.get(kind)
    if catalog is None:
        raise ValueError(f"unknown_identifier_kind:{kind}")
    if value not in catalog:
        raise ValueError(f"unknown_{kind}_id:{value}")
