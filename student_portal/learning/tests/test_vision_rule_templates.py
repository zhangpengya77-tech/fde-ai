from django.test import SimpleTestCase


class VisionRuleTemplateTests(SimpleTestCase):
    def test_prop_direction_template_has_fixed_classes_and_motor_positions(self):
        from learning.vision_rule_templates import template_for_task

        template = template_for_task("PROP_DIRECTION")

        self.assertEqual(template["template_id"], "PROP_DIRECTION_V1")
        self.assertEqual(template["model_classes"], ("CW_F", "CCW_F", "CW_B", "CCW_B"))
        # F450 機體位置（教師 2026-10-08 確認），需與 evaluate_prop 位置定義一致。
        self.assertEqual(template["motor_positions"], {
            "M1": "右前",
            "M2": "左後",
            "M3": "左前",
            "M4": "右後",
        })

    def test_hover_template_has_only_four_fixed_directions(self):
        from learning.vision_rule_templates import template_for_task

        template = template_for_task("FOUR_SIDE_HOVER")

        self.assertEqual(template["template_id"], "FOUR_SIDE_HOVER_V1")
        self.assertEqual(template["model_classes"], ("FRONT", "RIGHT", "BACK", "LEFT"))

    def test_unknown_task_has_no_template(self):
        from learning.vision_rule_templates import template_for_task

        self.assertIsNone(template_for_task("UNKNOWN"))
