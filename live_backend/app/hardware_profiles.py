from __future__ import annotations

from dataclasses import dataclass

from .identifiers import COMPONENT_IDS, CONNECTOR_IDS, POWER_IDS
from .safety import SAFETY_REMINDERS


REQUIRES_HARDWARE_VERIFICATION = "REQUIRES_HARDWARE_VERIFICATION"


@dataclass(frozen=True)
class ConnectorMapping:
    connector_id: str
    function: str
    pin_definition: str | None = None
    verification_status: str = REQUIRES_HARDWARE_VERIFICATION


@dataclass(frozen=True)
class HardwareProfile:
    profile_id: str
    display_name: str
    airframe: str
    flight_controller: str
    motor: str
    esc: str
    receiver: str
    gps_compass: str
    telemetry: str
    power_module: str
    component_ids: frozenset[str]
    connector_mapping: dict[str, ConnectorMapping]
    orientation_rules: dict[str, str]
    safety_notes: tuple[str, ...]
    supported_vision_tasks: tuple[str, ...]


def _unverified_mapping(connector_id: str) -> ConnectorMapping:
    return ConnectorMapping(connector_id, "Hardware-specific mapping; verify against the actual manufacturer documentation.")


F450_PIXHAWK248 = HardwareProfile(
    profile_id="F450_PIXHAWK248",
    display_name="F450 + Pixhawk 2.4.8",
    airframe="F450",
    flight_controller="Pixhawk 2.4.8",
    motor="2212",
    esc="30A",
    receiver=REQUIRES_HARDWARE_VERIFICATION,
    gps_compass=REQUIRES_HARDWARE_VERIFICATION,
    telemetry=REQUIRES_HARDWARE_VERIFICATION,
    power_module=REQUIRES_HARDWARE_VERIFICATION,
    component_ids=COMPONENT_IDS,
    connector_mapping={identifier: _unverified_mapping(identifier) for identifier in CONNECTOR_IDS | POWER_IDS},
    orientation_rules={
        "PIXHAWK_248": "VEHICLE_FORWARD",
        "GPS_COMPASS": REQUIRES_HARDWARE_VERIFICATION,
    },
    safety_notes=tuple(SAFETY_REMINDERS),
    supported_vision_tasks=(
        "component_present",
        "component_class",
        "pixhawk_orientation_assist",
        "gps_orientation_assist",
        "propeller_orientation_assist",
    ),
)


_PROFILES = {F450_PIXHAWK248.profile_id: F450_PIXHAWK248}


def get_hardware_profile(profile_id: str) -> HardwareProfile:
    try:
        return _PROFILES[profile_id]
    except KeyError as error:
        raise KeyError(profile_id) from error
