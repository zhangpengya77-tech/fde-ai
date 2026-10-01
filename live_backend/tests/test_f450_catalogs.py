import unittest

from app.identifiers import (
    COMPONENT_IDS,
    CONNECTOR_IDS,
    ERROR_CODES,
    POWER_IDS,
    validate_identifier,
)
from app.safety import SAFETY_REMINDERS
from app.hardware_profiles import get_hardware_profile


class F450CatalogTests(unittest.TestCase):
    def test_required_component_ids_are_defined(self):
        self.assertEqual(
            COMPONENT_IDS,
            frozenset({
                "F450_FRAME", "MOTOR_2212", "ESC_30A", "PIXHAWK_248",
                "GPS_COMPASS", "RC_RECEIVER", "TELEMETRY_RADIO",
                "POWER_MODULE", "PROPELLER_CW", "PROPELLER_CCW",
            }),
        )

    def test_required_connector_and_power_ids_are_defined(self):
        self.assertEqual(
            CONNECTOR_IDS,
            frozenset({
                "FC_MAIN_OUT_1", "FC_MAIN_OUT_2", "FC_MAIN_OUT_3",
                "FC_MAIN_OUT_4", "FC_GPS", "FC_I2C", "FC_TELEM1",
                "FC_TELEM2", "FC_RCIN",
            }),
        )
        self.assertEqual(
            POWER_IDS,
            frozenset({"ESC_POWER_POS", "ESC_POWER_NEG", "XT60_POS", "XT60_NEG"}),
        )

    def test_required_error_codes_are_defined(self):
        self.assertEqual(
            ERROR_CODES,
            frozenset({
                "ERR_COMPONENT_MISSING", "ERR_MOTOR_SCREW_RISK",
                "ERR_POWER_POLARITY", "ERR_RECEIVER_PINOUT", "ERR_FC_DIRECTION",
                "ERR_GPS_DIRECTION", "ERR_WRONG_MOTOR_PORT", "ERR_PROP_DIRECTION",
                "ERR_TEACHER_CHECK_REQUIRED", "ERR_CONTINUITY_CHECK_REQUIRED",
            }),
        )

    def test_required_safety_reminders_are_defined(self):
        self.assertEqual(
            set(SAFETY_REMINDERS),
            {
                "REM_MOTOR_TEST_NO_PROP", "REM_MOTOR_SCREW_TOO_LONG",
                "REM_CHECK_POWER_POLARITY", "REM_VERIFY_CONNECTOR_POLARITY",
                "REM_HEATSHRINK_BEFORE_SOLDER", "REM_SOLDER_TEACHER_CHECK",
                "REM_CONTINUITY_TEST_REQUIRED", "REM_RECEIVER_PINOUT",
                "REM_ESC_POWER_POLARITY", "REM_FC_FORWARD", "REM_GPS_FORWARD",
                "REM_FIRST_POWER_TEACHER_REQUIRED", "REM_FLIGHT_TEACHER_REQUIRED",
            },
        )
        self.assertTrue(all(SAFETY_REMINDERS[key].message for key in SAFETY_REMINDERS))

    def test_unknown_identifier_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown_component_id"):
            validate_identifier("component", "NOT_REAL")

    def test_known_identifier_is_accepted(self):
        self.assertIsNone(validate_identifier("connector", "FC_GPS"))

    def test_f450_pixhawk_profile_contains_required_equipment(self):
        profile = get_hardware_profile("F450_PIXHAWK248")
        self.assertEqual(profile.profile_id, "F450_PIXHAWK248")
        self.assertEqual(profile.airframe, "F450")
        self.assertEqual(profile.flight_controller, "Pixhawk 2.4.8")
        self.assertEqual(profile.motor, "2212")
        self.assertEqual(profile.esc, "30A")
        self.assertTrue({"PIXHAWK_248", "MOTOR_2212", "ESC_30A"} <= profile.component_ids)

    def test_hardware_profile_marks_unverified_pinouts_instead_of_guessing(self):
        profile = get_hardware_profile("F450_PIXHAWK248")
        self.assertEqual(set(profile.connector_mapping), CONNECTOR_IDS | POWER_IDS)
        self.assertTrue(all(item.verification_status == "REQUIRES_HARDWARE_VERIFICATION" for item in profile.connector_mapping.values()))
        self.assertEqual(profile.orientation_rules["PIXHAWK_248"], "VEHICLE_FORWARD")
        self.assertEqual(profile.orientation_rules["GPS_COMPASS"], "REQUIRES_HARDWARE_VERIFICATION")

    def test_hardware_profile_exposes_vision_tasks_and_safety_notes(self):
        profile = get_hardware_profile("F450_PIXHAWK248")
        self.assertIn("component_class", profile.supported_vision_tasks)
        self.assertIn("pixhawk_orientation_assist", profile.supported_vision_tasks)
        self.assertIn("REM_FC_FORWARD", profile.safety_notes)

    def test_unknown_hardware_profile_is_rejected(self):
        with self.assertRaisesRegex(KeyError, "UNKNOWN_PROFILE"):
            get_hardware_profile("UNKNOWN_PROFILE")


if __name__ == "__main__":
    unittest.main()
