"""本機一鍵啟動的一次性登入：未設定代碼時不存在、只接受本機、只能用一次。"""
from django.contrib.auth import get_user_model
from django.test import override_settings

from . import local_launch
from .tests import OPEN_COHORT, GcsTestBase

TOKEN = "local-launch-token-0123456789abcdef"
URL = f"/gcs/local-login/{TOKEN}/"


@override_settings(FDE_GCS_ENABLED=True, FDE_GCS_COHORTS=frozenset({OPEN_COHORT}), FDE_GCS_LOCAL_LAUNCH_TOKEN=TOKEN)
class LocalLaunchTests(GcsTestBase):
    def setUp(self):
        local_launch._state["used"] = False

    def test_valid_token_logs_in_local_pilot_once(self):
        res = self.client.get(URL)
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res["Location"], "/gcs/")
        user = get_user_model().objects.get(username="local-pilot@fde-gcs.local")
        self.assertTrue(user.is_staff)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(self.client.get("/gcs/").status_code, 200)
        self.client.logout()
        self.assertEqual(self.client.get(URL).status_code, 404)  # 用過即失效

    def test_wrong_token_and_remote_address_are_rejected(self):
        self.assertEqual(self.client.get("/gcs/local-login/wrong-token-0123456789abcdef/").status_code, 404)
        self.assertEqual(self.client.get(URL, REMOTE_ADDR="192.168.1.20").status_code, 404)
        self.assertEqual(self.client.get(URL).status_code, 302)  # 錯誤嘗試不會消耗代碼

    @override_settings(FDE_GCS_LOCAL_LAUNCH_TOKEN="")
    def test_not_configured_means_not_found(self):
        self.assertEqual(self.client.get(URL).status_code, 404)

    def test_post_not_allowed(self):
        self.assertEqual(self.client.post(URL).status_code, 405)
