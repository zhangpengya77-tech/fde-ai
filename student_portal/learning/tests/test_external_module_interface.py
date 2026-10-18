"""外部模組接口層與工作台整合驗收（I1 建立；I2-B 擴充為四狀態）。

驗收重點（2026-10-13 教師 I2 指令第三、四、五、六節）：
  1. 四狀態皆有真實依據，且互不冒充：
     已可使用（AVAILABLE）／尚未接入（NOT_INTEGRATED）／
     服務暫時不可用（SERVICE_UNAVAILABLE）／權限不足（ROLE_RESTRICTED）。
  2. 未設定時一律「尚未接入」，不得產生任何連結或假完成狀態。
  3. 只有 AVAILABLE 才輸出連結；其餘三態一律無連結。
  4. 服務不可用為降級顯示，**不得顯示成學員未完成**（不觸碰任何成長紀錄狀態）。
  5. 權限不足時不進行健康探測（不洩漏服務可用性）。
  6. 預設配置（全部 DISABLED）下不發出任何網路探測。
  7. 工作台「做」階段：F450 3D 數位孿生為預留模組；F450 十二任務為獨立入口 /platform/f450。
  8. 工作台「練」有 AI 助教、「證」有成長日誌總覽等既有入口。
  9. R01–R08 狀態在重複瀏覽後保持一致（I2-C：既有資料與審核狀態不被改寫）。
"""
import re
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse

import learning.external_modules as em
from learning.external_modules import (
    DIAG_DNS_FAILED,
    DIAG_SECURITY_REJECTED,
    STATUS_AVAILABLE,
    STATUS_LABELS,
    STATUS_NOT_INTEGRATED,
    STATUS_ROLE_RESTRICTED,
    STATUS_SERVICE_UNAVAILABLE,
    all_external_modules,
    clear_probe_cache,
    external_module_contract,
    external_modules_for_stage,
    get_external_module,
)
from learning.models import Cohort
from learning.tests.helpers import create_student_account, enroll_student


def _always_up(_url):
    return True


def _always_down(_url):
    return False


class _RecordingProber:
    def __init__(self, result=True):
        self.result = result
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        return self.result


class ExternalModuleRegistryTests(TestCase):
    def setUp(self):
        clear_probe_cache()

    def test_defaults_are_not_integrated_and_unavailable(self):
        for module_id in ("F450_DIGITAL_TWIN", "MP_GROUND_STATION", "HQGC_ASSESSMENT"):
            module = get_external_module(module_id)
            self.assertIsNotNone(module)
            self.assertFalse(module["enabled"])
            self.assertEqual(module["availability_status"], STATUS_NOT_INTEGRATED)
            self.assertEqual(module["state"], "尚未接入")
            self.assertEqual(module["entry_url"], "")
            self.assertEqual(module["url"], "")

    def test_contract_fields_and_four_statuses(self):
        contract = external_module_contract()
        for field in (
            "module_id",
            "display_name",
            "enabled",
            "entry_url",
            "availability_status",
            "allowed_roles",
            "integration_version",
        ):
            self.assertIn(field, contract["fields"])
        keys = [item["key"] for item in contract["statuses"]]
        self.assertEqual(
            keys,
            [
                STATUS_AVAILABLE,
                STATUS_NOT_INTEGRATED,
                STATUS_SERVICE_UNAVAILABLE,
                STATUS_ROLE_RESTRICTED,
            ],
        )
        labels = {item["key"]: item["label"] for item in contract["statuses"]}
        self.assertEqual(labels[STATUS_AVAILABLE], "已可使用")
        self.assertEqual(labels[STATUS_NOT_INTEGRATED], "尚未接入")
        self.assertEqual(labels[STATUS_SERVICE_UNAVAILABLE], "服務暫時不可用")
        self.assertEqual(labels[STATUS_ROLE_RESTRICTED], "權限不足")
        # 只有「已可使用」可連結。
        linkable = {item["key"]: item["linkable"] for item in contract["statuses"]}
        self.assertTrue(linkable[STATUS_AVAILABLE])
        self.assertFalse(linkable[STATUS_NOT_INTEGRATED])
        self.assertFalse(linkable[STATUS_SERVICE_UNAVAILABLE])
        self.assertFalse(linkable[STATUS_ROLE_RESTRICTED])
        self.assertEqual(contract["defaults"]["availability_status"], STATUS_NOT_INTEGRATED)
        self.assertTrue(contract["no_database_table"])
        self.assertEqual(
            contract["first_batch"],
            ["F450_DIGITAL_TWIN", "MP_GROUND_STATION", "HQGC_ASSESSMENT"],
        )

    def test_stage_filtering(self):
        build_ids = [m["module_id"] for m in external_modules_for_stage("build")]
        assess_ids = [m["module_id"] for m in external_modules_for_stage("assess")]
        self.assertEqual(build_ids, ["F450_DIGITAL_TWIN"])
        self.assertEqual(assess_ids, ["MP_GROUND_STATION", "HQGC_ASSESSMENT"])
        self.assertEqual(len(all_external_modules()), 3)

    def test_unknown_module_returns_none(self):
        self.assertIsNone(get_external_module("NOT_A_MODULE"))

    def test_disabled_module_never_probes(self):
        """預設配置下不得發出任何網路探測（對既有行為零影響）。"""
        prober = _RecordingProber(True)
        with override_settings(FDE_EXTERNAL_MODULE_PROBER=prober):
            for module_id in ("F450_DIGITAL_TWIN", "MP_GROUND_STATION", "HQGC_ASSESSMENT"):
                module = get_external_module(module_id)
                self.assertEqual(module["availability_status"], STATUS_NOT_INTEGRATED)
        self.assertEqual(prober.calls, [])

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {"enabled": True, "entry_url": "https://twin.example.test/f450"}
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_up,
    )
    def test_enabled_with_url_and_service_up_is_available(self):
        module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertTrue(module["enabled"])
        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(module["state"], "已可使用")
        self.assertEqual(module["url"], "https://twin.example.test/f450")

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {"enabled": True, "entry_url": "https://twin.example.test/f450"}
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_down,
    )
    def test_enabled_but_service_down_is_service_unavailable(self):
        module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["state"], "服務暫時不可用")
        self.assertEqual(module["url"], "")

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "MP_GROUND_STATION": {"enabled": True, "entry_url": "https://mp.example.test/"}
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_down,
    )
    def test_service_down_does_not_touch_growth_status(self):
        """降級顯示不得改寫任何成長紀錄狀態（不得顯示成學員未完成）。"""
        from learning.growth_records import ensure_growth_submissions

        cohort = Cohort.objects.create(cohort_id="EXT-DOWN", name="降級測試班")
        student = create_student_account("ext-down@example.test", "降級學員")
        enrollment = enroll_student(student, cohort)
        submissions = ensure_growth_submissions(enrollment)
        before = {item.definition.slot_id: item.status for item in submissions}
        self.client.force_login(student.user)
        response = self.client.get(
            reverse("learning:student_learning_path", args=[enrollment.pk])
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "服務暫時不可用")
        after = {
            item.definition.slot_id: item.status
            for item in enrollment.growth_submissions.all()
        }
        self.assertEqual(before, after)

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {
                "enabled": True,
                "entry_url": "https://twin.example.test/f450",
                "allowed_roles": ["teacher"],
            }
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_up,
    )
    def test_role_not_allowed_is_role_restricted(self):
        module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_ROLE_RESTRICTED)
        self.assertEqual(module["state"], "權限不足")
        self.assertEqual(module["url"], "")

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {
                "enabled": True,
                "entry_url": "https://twin.example.test/f450",
                "allowed_roles": ["teacher"],
            }
        }
    )
    def test_role_restricted_skips_probe(self):
        """權限不足時不得進行探測（不洩漏服務可用性、不產生無謂連線）。"""
        prober = _RecordingProber(True)
        with override_settings(FDE_EXTERNAL_MODULE_PROBER=prober):
            module = get_external_module("F450_DIGITAL_TWIN", role="student")
            self.assertEqual(module["availability_status"], STATUS_ROLE_RESTRICTED)
        self.assertEqual(prober.calls, [])

    @override_settings(
        FDE_EXTERNAL_MODULES={"HQGC_ASSESSMENT": {"enabled": True, "entry_url": ""}},
        FDE_EXTERNAL_MODULE_PROBER=_always_up,
    )
    def test_enabled_without_url_stays_not_integrated(self):
        module = get_external_module("HQGC_ASSESSMENT", role="student")
        self.assertTrue(module["enabled"])
        self.assertEqual(module["availability_status"], STATUS_NOT_INTEGRATED)
        self.assertEqual(module["url"], "")

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "MP_GROUND_STATION": {"enabled": True, "entry_url": "https://mp.example.test/"}
        },
        FDE_EXTERNAL_MODULE_PROBER=lambda _u: (_ for _ in ()).throw(RuntimeError("probe boom")),
    )
    def test_probe_exception_degrades_without_raising(self):
        """探測例外必須降級為「服務暫時不可用」，不得讓工作台頁面出錯。"""
        module = get_external_module("MP_GROUND_STATION", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)

    def test_status_labels_cover_all_four(self):
        self.assertEqual(len(STATUS_LABELS), 4)

    def test_probe_cache_clearable(self):
        clear_probe_cache()  # 不應拋出例外

    def test_contract_urls_carry_no_sensitive_params(self):
        for module in all_external_modules():
            url = module["entry_url"]
            self.assertNotIn("?", url)
            self.assertNotIn("token", url.lower())
            self.assertNotIn("@", url)


class WorkbenchExternalModuleRenderingTests(TestCase):
    def setUp(self):
        clear_probe_cache()
        self.cohort = Cohort.objects.create(cohort_id="EXT-2026", name="外部模組測試班")
        self.student = create_student_account("ext-student@example.test", "外部模組學員")
        self.enrollment = enroll_student(self.student, self.cohort)
        self.user = self.student.user
        self.url = reverse("learning:student_learning_path", args=[self.enrollment.pk])

    def _body(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        return response.content.decode("utf-8")

    def test_reserved_modules_visible_but_not_linked(self):
        body = self._body()
        self.assertIn("F450 數位孿生", body)
        self.assertIn("MP 地面站（預留）", body)
        self.assertIn("HQGC 考核（預留）", body)
        self.assertIn("尚未接入", body)
        for name in ("F450 數位孿生", "MP 地面站（預留）", "HQGC 考核（預留）"):
            self.assertIsNone(
                re.search(r"<a[^>]*>\s*{}".format(re.escape(name)), body),
                msg="{} 不應為可點擊連結".format(name),
            )
        for token in ("孿生", "twin", "ground-station", "hqgc"):
            self.assertIsNone(re.search(r'href="[^"]*{}[^"]*"'.format(token), body, re.I))

    def test_badges_use_unified_status_labels(self):
        body = self._body()
        # 預設三模組皆「尚未接入」，且不得出現其他三態的誤標。
        self.assertEqual(body.count("尚未接入"), 3)
        self.assertNotIn("已可使用", body)
        self.assertNotIn("服務暫時不可用", body)
        self.assertNotIn("權限不足", body)

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {"enabled": True, "entry_url": "https://twin.example.test/f450"}
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_up,
    )
    def test_available_module_renders_link(self):
        body = self._body()
        self.assertIn('href="https://twin.example.test/f450"', body)
        self.assertIn("已可使用", body)

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {"enabled": True, "entry_url": "https://twin.example.test/f450"}
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_down,
    )
    def test_service_unavailable_module_renders_no_link(self):
        body = self._body()
        self.assertIn("服務暫時不可用", body)
        self.assertNotIn('href="https://twin.example.test/f450"', body)

    @override_settings(
        FDE_EXTERNAL_MODULES={
            "F450_DIGITAL_TWIN": {
                "enabled": True,
                "entry_url": "https://twin.example.test/f450",
                "allowed_roles": ["teacher"],
            }
        },
        FDE_EXTERNAL_MODULE_PROBER=_always_up,
    )
    def test_role_restricted_module_renders_no_link(self):
        body = self._body()
        self.assertIn("權限不足", body)
        self.assertNotIn('href="https://twin.example.test/f450"', body)

    def test_f450_twelve_task_entry_links_to_existing_platform(self):
        body = self._body()
        self.assertIn("F450 十二任務實訓", body)
        self.assertIn('href="/platform/f450"', body)
        self.assertIsNone(re.search(r"<a[^>]*>\s*F450 數位孿生", body))

    def test_five_stage_existing_entries_present(self):
        """I2-A：五階段皆能連到既有入口（不新增第二套功能）。"""
        body = self._body()
        # 學
        self.assertIn("AI 助教（RAG 知識庫問答）", body)
        # 練
        self.assertIn("模擬器練習（學習平台）", body)
        self.assertIn("AI 助教（練習即時問答）", body)
        # 做
        self.assertIn("F450 十二任務實訓", body)
        self.assertIn("Mission Planner 調參實訓（MP01–MP12）", body)
        # 測
        self.assertIn("手機槳葉方向辨識（M1–M4）", body)
        self.assertIn("飛行健康 AI", body)
        # 證
        self.assertIn("我的學習成長日誌（R01–R08 總覽）", body)
        self.assertIn(
            reverse("learning:student_growth_dashboard", args=[self.enrollment.pk]), body
        )

    def test_r01_r08_status_stable_across_repeated_views(self):
        """I2-C：既有資料與審核狀態不被改寫（重複瀏覽結果一致）。

        註：頁面含 CSRF token（每次請求不同），比較前先正規化，避免誤判。
        """

        def normalize(html):
            return re.sub(
                r'name="csrfmiddlewaretoken" value="[^"]*"',
                'name="csrfmiddlewaretoken" value="X"',
                html,
            )

        self.client.force_login(self.user)
        first = normalize(self.client.get(self.url).content.decode("utf-8"))
        second = normalize(self.client.get(self.url).content.decode("utf-8"))
        slots_first = sorted(set(re.findall(r'growth-slot">(R0[1-8])<', first)))
        slots_second = sorted(set(re.findall(r'growth-slot">(R0[1-8])<', second)))
        self.assertEqual(slots_first, ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"])
        self.assertEqual(slots_first, slots_second)
        # 八項紀錄的狀態標籤在兩次瀏覽間完全一致（未被改寫）。
        statuses_first = re.findall(r'growth-slot">(R0[1-8])</span><span class="status[^"]*">([^<]*)<', first)
        statuses_second = re.findall(r'growth-slot">(R0[1-8])</span><span class="status[^"]*">([^<]*)<', second)
        self.assertTrue(statuses_first)
        self.assertEqual(statuses_first, statuses_second)
        self.assertEqual(first, second)

    def test_mobile_viewport_meta_present(self):
        body = self._body()
        self.assertIn("width=device-width", body)


class ExternalModuleUrlSafetyTests(TestCase):
    """I3-B 外部模組接口安全（2026-10-13 教師指令第三節）。

    驗收：不受信任的入口 URL 一律不得被探測、不得產生連結，
    且不得因為外部服務故障或設定錯誤而影響工作台與學習紀錄。
    """

    def _module(self, url, **extra):
        config = {"enabled": True, "entry_url": url}
        config.update(extra)
        with override_settings(
            FDE_EXTERNAL_MODULES={"F450_DIGITAL_TWIN": config},
            FDE_EXTERNAL_MODULE_PROBER=_always_up,
        ):
            return get_external_module("F450_DIGITAL_TWIN", role="student")

    def test_trusted_https_url_is_accepted(self):
        module = self._module("https://twin.example.test/f450")
        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(module["url"], "https://twin.example.test/f450")
        self.assertFalse(module["url_rejected"])

    def test_trusted_http_url_is_accepted(self):
        module = self._module("http://twin.example.test:9000/f450")
        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(module["url"], "http://twin.example.test:9000/f450")

    def test_untrusted_schemes_are_rejected(self):
        for url in (
            "javascript:alert(1)",
            "file:///C:/Windows/win.ini",
            "data:text/html;base64,PHNjcmlwdD4=",
            "ftp://example.test/f450",
            "//example.test/f450",
        ):
            module = self._module(url)
            self.assertEqual(
                module["availability_status"],
                STATUS_SERVICE_UNAVAILABLE,
                msg="{} 應暫時停用".format(url),
            )
            self.assertEqual(module["url"], "")
            self.assertTrue(module["url_rejected"], msg=url)

    def test_url_with_credentials_is_rejected(self):
        for url in (
            "https://user:pass@twin.example.test/f450",
            "https://admin@twin.example.test/f450",
        ):
            module = self._module(url)
            self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
            self.assertEqual(module["url"], "")
            self.assertNotIn("@", module["url"])

    def test_url_with_sensitive_query_is_rejected(self):
        for url in (
            "https://twin.example.test/f450?token=abc123",
            "https://twin.example.test/f450?access_token=abc123",
            "https://twin.example.test/f450?password=p@ss",
            "https://twin.example.test/f450?api_key=xyz",
            "https://twin.example.test/f450?student_id=S001",
            "https://twin.example.test/f450?email=a@b.test",
            "https://twin.example.test/f450?sessionid=deadbeef",
            "https://twin.example.test/f450#token=abc123",
        ):
            module = self._module(url)
            self.assertEqual(
                module["availability_status"],
                STATUS_SERVICE_UNAVAILABLE,
                msg="{} 應暫時停用".format(url),
            )
            self.assertEqual(module["url"], "", msg=url)

    def test_cloud_metadata_host_is_rejected(self):
        module = self._module("http://169.254.169.254/latest/meta-data/")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")
        self.assertTrue(module["url_rejected"])

    def test_rejected_url_is_never_probed(self):
        """不受信任的 URL 不得被探測（不發出任何連線）。"""
        prober = _RecordingProber(True)
        for url in (
            "javascript:alert(1)",
            "https://user:pass@twin.example.test/f450",
            "https://twin.example.test/f450?token=abc",
            "http://169.254.169.254/",
        ):
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {"enabled": True, "entry_url": url}
                },
                FDE_EXTERNAL_MODULE_PROBER=prober,
            ):
                module = get_external_module("F450_DIGITAL_TWIN", role="student")
                self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(prober.calls, [])

    def test_rejected_url_renders_no_link(self):
        cohort = Cohort.objects.create(cohort_id="EXT-SEC", name="URL 安全測試班")
        student = create_student_account("ext-sec@example.test", "URL 安全學員")
        enrollment = enroll_student(student, cohort)
        self.client.force_login(student.user)
        with override_settings(
            FDE_EXTERNAL_MODULES={
                "F450_DIGITAL_TWIN": {
                    "enabled": True,
                    "entry_url": "https://twin.example.test/f450?token=abc123",
                }
            },
            FDE_EXTERNAL_MODULE_PROBER=_always_up,
        ):
            body = self.client.get(
                reverse("learning:student_learning_path", args=[enrollment.pk])
            ).content.decode("utf-8")
        self.assertNotIn("token=abc123", body)
        self.assertIn("服務暫時不可用", body)
        self.assertNotIn("已可使用", body)

    def test_probe_timeout_is_short_and_explicit(self):
        from learning.external_modules import _probe_timeout

        self.assertLessEqual(_probe_timeout(), 5.0)
        with override_settings(FDE_EXTERNAL_MODULE_PROBE_TIMEOUT_SECONDS="garbage"):
            self.assertEqual(_probe_timeout(), 1.5)

    def test_interface_layer_does_not_start_external_services(self):
        """本層不得自動啟動外部服務（只做設定／角色檢查與被動探測）。"""
        import inspect

        import learning.external_modules as mod

        source = inspect.getsource(mod)
        for forbidden in ("subprocess", "os.system", "Popen", "Start-Process", "os.startfile"):
            self.assertNotIn(forbidden, source, msg="不得出現 {}".format(forbidden))

    def test_contract_declares_url_safety(self):
        safety = external_module_contract()["url_safety"]
        self.assertEqual(safety["schemes_allowed"], ["http", "https"])
        self.assertFalse(safety["userinfo_allowed"])
        self.assertTrue(safety["sensitive_query_keys_rejected"])
        self.assertFalse(safety["rejected_is_probed"])
        # I5-B：安全拒絕後狀態為「服務暫時不可用」，fail-closed。
        self.assertEqual(safety["rejected_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertFalse(safety["auto_start_external_service"])
        # I4-C：SSRF 縱深防護契約
        self.assertTrue(safety["dns_resolution_checked"])
        self.assertFalse(safety["redirects_followed_by_probe"])
        self.assertFalse(safety["credentials_sent_by_probe"])
        self.assertFalse(safety["probe_writes_data"])
        self.assertEqual(safety["probe_method"], "HEAD")
        self.assertIn("private", safety["restricted_address_classes"])
        self.assertIn("link_local", safety["restricted_address_classes"])
        # I5-B：白名單不再繞過位址判定；內網需精確私網清單。
        self.assertFalse(safety["allowlist_precedence"])
        self.assertFalse(safety["allowlist_grants_private_access"])
        self.assertEqual(safety["allowlist_enforcement"], "mandatory_when_non_empty")
        self.assertEqual(
            safety["private_allowlist_setting"], "FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS"
        )
        self.assertFalse(safety["private_allowlist_wildcards"])
        self.assertTrue(safety["metadata_and_localhost_always_denied"])
        # I5-B：主機名正規化與數值表示法。
        self.assertEqual(
            safety["hostname_normalization"], ["lowercase", "trailing_dot", "ipv6_zone", "idna"]
        )
        self.assertTrue(safety["numeric_host_forms_rejected"])
        # I5-B R1：IP 釘選與 fail-closed DNS。
        self.assertTrue(safety["pinned_ip_used_for_connection"])
        self.assertEqual(safety["dns_lookups_per_probe"], 1)
        self.assertTrue(safety["dns_rebinding_blocked"])
        self.assertFalse(safety["hostname_fallback_after_rejection"])
        self.assertTrue(safety["dns_failure_is_fail_closed"])
        self.assertEqual(safety["dns_failure_status"], STATUS_SERVICE_UNAVAILABLE)
        # I5-B：TLS 驗證保留。
        self.assertFalse(safety["tls_verification_disabled"])
        self.assertTrue(safety["sni_uses_original_hostname"])

    def test_contract_declares_diagnosis_for_teachers_only(self):
        contract = external_module_contract()
        diagnosis = contract["diagnosis"]
        self.assertFalse(diagnosis["student_visible"])
        self.assertFalse(diagnosis["contains_host_or_ip"])
        self.assertIn(DIAG_DNS_FAILED, diagnosis["codes"])
        self.assertIn(DIAG_SECURITY_REJECTED, diagnosis["codes"])
        # 四態判定語意與教師指定一致。
        rules = contract["state_rules"]
        self.assertEqual(rules["not_configured_or_disabled"], STATUS_NOT_INTEGRATED)
        self.assertEqual(rules["dns_failure"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(rules["security_rejected"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(rules["service_unreachable"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(rules["unauthorized"], STATUS_ROLE_RESTRICTED)
        self.assertTrue(rules["probe_skipped_for_unauthorized"])
        self.assertEqual(rules["safe_and_reachable"], STATUS_AVAILABLE)

    def test_diagnosis_is_not_rendered_for_students(self):
        """學員頁面不得出現診斷碼（教師端專用，且不含主機名／IP）。"""
        clear_probe_cache()
        cohort = Cohort.objects.create(cohort_id="EXT-DIAG", name="診斷碼測試班")
        student = create_student_account("ext-diag@example.test", "診斷碼學員")
        enrollment = enroll_student(student, cohort)
        self.client.force_login(student.user)
        with override_settings(
            FDE_EXTERNAL_MODULES={
                "F450_DIGITAL_TWIN": {
                    "enabled": True,
                    "entry_url": "http://192.168.1.50:9000/twin",
                }
            },
            FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=[],
        ):
            body = self.client.get(
                reverse("learning:student_learning_path", args=[enrollment.pk])
            ).content.decode("utf-8")
        for code in (DIAG_DNS_FAILED, DIAG_SECURITY_REJECTED, "SERVICE_ONLINE"):
            self.assertNotIn(code, body)
        self.assertNotIn("192.168.1.50", body)

    def test_security_rejection_does_not_write_learning_data(self):
        """I5-B 驗收 13：安全拒絕時不得寫入任何學習資料。"""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        clear_probe_cache()
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("10.0.0.5", 0))],
        ):
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {
                        "enabled": True,
                        "entry_url": "https://evil.example.test/f450",
                    }
                },
                FDE_EXTERNAL_MODULE_PROBER=None,
            ):
                with CaptureQueriesContext(connection) as captured:
                    module = em.get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["diagnosis"], DIAG_SECURITY_REJECTED)
        self.assertEqual(module["url"], "")
        writes = [
            query["sql"]
            for query in captured.captured_queries
            if query["sql"].strip().lower().startswith(("insert", "update", "delete", "create", "drop"))
        ]
        self.assertEqual(writes, [], msg="安全拒絕不得寫入任何資料：%s" % writes)

    def test_role_restricted_does_not_resolve_dns(self):
        """I5-B：角色不符時連 DNS 都不解析（完全零探測）。"""
        clear_probe_cache()
        with mock.patch("learning.external_modules.socket.getaddrinfo") as resolver:
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {
                        "enabled": True,
                        "entry_url": "https://twin.example.test/f450",
                        "allowed_roles": ["teacher"],
                    }
                },
                FDE_EXTERNAL_MODULE_PROBER=None,
            ):
                module = em.get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_ROLE_RESTRICTED)
        self.assertEqual(module["diagnosis"], em.DIAG_ROLE_RESTRICTED)
        resolver.assert_not_called()

    def test_three_modules_are_independent(self):
        """三個外部模組各自獨立：設定其一不影響其餘兩者。"""
        with override_settings(
            FDE_EXTERNAL_MODULES={
                "MP_GROUND_STATION": {"enabled": True, "entry_url": "https://mp.example.test/"}
            },
            FDE_EXTERNAL_MODULE_PROBER=_always_up,
        ):
            mp = get_external_module("MP_GROUND_STATION", role="student")
            twin = get_external_module("F450_DIGITAL_TWIN", role="student")
            hqgc = get_external_module("HQGC_ASSESSMENT", role="student")
        self.assertEqual(mp["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(twin["availability_status"], STATUS_NOT_INTEGRATED)
        self.assertEqual(hqgc["availability_status"], STATUS_NOT_INTEGRATED)
        self.assertEqual(twin["url"], "")
        self.assertEqual(hqgc["url"], "")


class ExternalModuleNetworkSafetyTests(TestCase):
    """I4-C 接口安全複查（2026-10-13 教師指令第五節）。

    驗收：URL 僅來自伺服器端設定；預設拒絕內網／迴環／link-local／保留位址與
    雲端 metadata 目標；DNS 解析與重新導向皆不得繞過限制；探測不帶憑證、
    不寫入資料、未授權者完全不探測；內網服務須以可信白名單明確允許。
    """

    def setUp(self):
        clear_probe_cache()

    def _module(self, url, *, allowlist=None, private=None, prober=None):
        """prober=False 表示不使用測試捷徑（走真實 DNS＋IP 釘選路徑）。"""
        config = {"enabled": True, "entry_url": url}
        settings_kwargs = {
            "FDE_EXTERNAL_MODULES": {"F450_DIGITAL_TWIN": config},
            "FDE_EXTERNAL_MODULE_PROBER": _always_up if prober is None else prober,
        }
        if allowlist is not None:
            settings_kwargs["FDE_EXTERNAL_MODULE_ALLOWED_HOSTS"] = allowlist
        if private is not None:
            settings_kwargs["FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS"] = private
        with override_settings(**settings_kwargs):
            clear_probe_cache()
            return get_external_module("F450_DIGITAL_TWIN", role="student")

    def test_internal_and_reserved_addresses_are_rejected_by_default(self):
        for url in (
            "http://127.0.0.1:9000/twin",
            "http://localhost:9000/twin",
            "http://10.0.0.7/twin",
            "http://172.16.5.5/twin",
            "http://192.168.1.50:9000/twin",
            "http://169.254.169.254/latest/meta-data/",
            "http://0.0.0.0/twin",
            "http://[::1]:9000/twin",
            "http://metadata.google.internal/computeMetadata/v1/",
            "http://metadata/",
        ):
            module = self._module(url)
            self.assertEqual(
                module["availability_status"],
                STATUS_SERVICE_UNAVAILABLE,
                msg="{} 應暫時停用（不得指向內網／metadata）".format(url),
            )
            self.assertEqual(module["url"], "", msg=url)
            self.assertTrue(module["url_rejected"], msg=url)

    def test_internal_url_is_never_probed(self):
        prober = _RecordingProber(True)
        for url in ("http://192.168.1.50:9000/twin", "http://127.0.0.1:9000/twin"):
            self._module(url, prober=prober)
        self.assertEqual(prober.calls, [])

    def test_allowlisted_internal_host_is_accepted(self):
        """教師以 FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS **精確**允許內網服務才可用。

        I5-B R2：白名單通配符**不會**自動放行內網位址。
        """
        with override_settings(
            FDE_EXTERNAL_MODULES={
                "F450_DIGITAL_TWIN": {"enabled": True, "entry_url": "http://192.168.1.50:9000/twin"}
            },
            FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["192.168.1.50"],
            FDE_EXTERNAL_MODULE_PROBER=_always_up,
        ):
            module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(module["url"], "http://192.168.1.50:9000/twin")

    def test_private_allowlist_is_exact_only(self):
        """內網清單不支援通配符：列出 *.school.edu.tw 不會放行解析到內網的主機。"""
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("10.0.0.5", 0))],
        ):
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {
                        "enabled": True,
                        "entry_url": "https://mp.school.edu.tw/twin",
                    }
                },
                FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["*.school.edu.tw"],
            ):
                module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")
        self.assertEqual(module["diagnosis"], DIAG_SECURITY_REJECTED)

    def test_allowlist_suffix_pattern_covers_subdomains(self):
        module = self._module("https://mp.school.edu.tw/twin", allowlist=["*.school.edu.tw"])
        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)

    def test_allowlist_is_mandatory_when_non_empty(self):
        """白名單非空時具有強制性：未列出的主機不得作為模組目標。"""
        module = self._module("https://twin.example.test/f450", allowlist=["mp.school.edu.tw"])
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")
        self.assertEqual(module["diagnosis"], DIAG_SECURITY_REJECTED)

    def test_allowlist_does_not_bypass_ip_safety_check(self):
        """I5-B R2：白名單命中後仍須通過位址安全判定。"""
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("127.0.0.1", 0))],
        ):
            module = self._module(
                "https://mp.school.edu.tw/twin", allowlist=["*.school.edu.tw"], prober=False
            )
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")
        self.assertEqual(module["diagnosis"], DIAG_SECURITY_REJECTED)

    def test_allowlist_does_not_bypass_sensitive_param_check(self):
        module = self._module(
            "http://192.168.1.50:9000/twin?token=abc123", allowlist=["192.168.1.50"]
        )
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")

    def test_metadata_host_is_denied_even_when_allowlisted(self):
        """雲端 metadata／localhost 主機無條件拒絕，任何白名單皆不得放行。"""
        for url, host in (
            ("http://169.254.169.254/latest/meta-data/", "169.254.169.254"),
            ("http://metadata.google.internal/", "metadata.google.internal"),
            ("http://localhost:9000/twin", "localhost"),
        ):
            module = self._module(url, allowlist=[host])
            self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE, msg=url)
            self.assertEqual(module["url"], "", msg=url)
            self.assertTrue(module["url_rejected"], msg=url)

    def test_metadata_host_is_denied_even_in_private_allowlist(self):
        """metadata／localhost 即使在私網清單中也一律拒絕。"""
        with override_settings(
            FDE_EXTERNAL_MODULES={
                "F450_DIGITAL_TWIN": {
                    "enabled": True,
                    "entry_url": "http://169.254.169.254/latest/meta-data/",
                }
            },
            FDE_EXTERNAL_MODULE_ALLOW_PRIVATE_HOSTS=["169.254.169.254", "metadata.google.internal"],
            FDE_EXTERNAL_MODULE_PROBER=_always_up,
        ):
            module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")

    def test_hostname_resolving_to_private_address_is_rejected(self):
        """DNS 解析後為內網位址者一律拒絕（防 DNS 指向內網）。"""
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("10.1.2.3", 0))],
        ):
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {
                        "enabled": True,
                        "entry_url": "https://twin.example.test/f450",
                    }
                }
            ):
                module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")
        self.assertEqual(module["diagnosis"], DIAG_SECURITY_REJECTED)

    def test_dns_failure_is_fail_closed(self):
        """I5-B R3：DNS 解析失敗一律禁止探測，狀態為「服務暫時不可用」。"""
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo", side_effect=OSError("nxdomain")
        ), mock.patch.object(em, "_probe_pinned") as probe:
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {
                        "enabled": True,
                        "entry_url": "https://twin.example.test/f450",
                    }
                }
            ):
                module = get_external_module("F450_DIGITAL_TWIN", role="student")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["diagnosis"], DIAG_DNS_FAILED)
        self.assertEqual(module["url"], "")
        probe.assert_not_called()

    def test_metadata_trailing_dot_variant_is_denied(self):
        """I5-B R9：尾點變體經正規化後一律拒絕（不依賴字串精確比對）。"""
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("169.254.169.254", 0))],
        ):
            module = self._module("http://metadata.google.internal./x")
        self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE)
        self.assertEqual(module["url"], "")

    def test_hostname_normalization_is_consistent(self):
        """I5-B R9：大小寫、尾點、IDNA 正規化後結果一致。"""
        from learning.external_modules import _normalize_hostname

        self.assertEqual(_normalize_hostname("Example.TEST"), "example.test")
        self.assertEqual(_normalize_hostname("example.test."), "example.test")
        self.assertEqual(_normalize_hostname("example.test..."), "example.test")
        self.assertEqual(_normalize_hostname("fe80::1%eth0"), "fe80::1")
        self.assertEqual(_normalize_hostname("metadata.google.internal."), "metadata.google.internal")
        self.assertEqual(_normalize_hostname(""), None)
        self.assertEqual(_normalize_hostname("..."), None)

    def test_numeric_host_forms_are_rejected(self):
        """I5-B R7：十進位／十六進位／八進位表示法一律拒絕。"""
        from learning.external_modules import _normalize_hostname

        for host, normalized in (
            ("2852039166", "2852039166"),
            ("0xA9FEA9FE", "0xa9fea9fe"),
            ("0177.0.0.1", "0177.0.0.1"),
            ("2130706433", "2130706433"),
        ):
            self.assertEqual(_normalize_hostname(host), normalized, msg=host)
            module = self._module("http://{}/twin".format(host))
            self.assertEqual(module["availability_status"], STATUS_SERVICE_UNAVAILABLE, msg=host)
            self.assertEqual(module["url"], "", msg=host)
            self.assertTrue(module["url_rejected"], msg=host)

    def test_valid_public_ip_literal_is_accepted(self):
        """一般公網 IP 字面值仍是合法主機（未被 R7 誤傷）。"""
        module = self._module("http://93.184.216.34/twin")
        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(module["url"], "http://93.184.216.34/twin")

    def test_probe_does_not_follow_redirects(self):
        """探測只取一次回應，絕不跟隨 3xx（即使指向 metadata 也不跟）。"""

        class _FakeResponse:
            status = 302

        class _FakeConnection:
            def __init__(self, *args, **kwargs):
                self.requests = []
                self.responses = 0

            def request(self, *args, **kwargs):
                self.requests.append((args, kwargs))

            def getresponse(self):
                self.responses += 1
                return _FakeResponse()

            def close(self):
                pass

        fake = _FakeConnection()
        with mock.patch.object(em, "_PinnedHTTPConnection", return_value=fake):
            result = em._probe_pinned("http://twin.example.test/f450", "93.184.216.34")
        self.assertTrue(result)  # 3xx 仍視為服務在線
        self.assertEqual(len(fake.requests), 1)  # 未發出第二個請求（未跟隨）
        self.assertEqual(fake.responses, 1)

    def test_probe_sends_no_credentials(self):
        """探測只送 User-Agent，不帶 Cookie／Authorization／登入憑證。"""

        class _FakeResponse:
            status = 204

        class _FakeConnection:
            def __init__(self, *args, **kwargs):
                self.headers = None

            def request(self, method, selector, headers=None, **kwargs):
                self.headers = dict(headers or {})

            def getresponse(self):
                return _FakeResponse()

            def close(self):
                pass

        fake = _FakeConnection()
        with mock.patch.object(em, "_PinnedHTTPConnection", return_value=fake):
            em._probe_pinned("http://twin.example.test/f450", "93.184.216.34")
        self.assertEqual(fake.headers, {"User-Agent": em.PROBE_USER_AGENT})
        for forbidden in ("Cookie", "Authorization", "X-FDE-Role", "X-FDE-Teacher-ID"):
            self.assertNotIn(forbidden, fake.headers)

    def test_probe_without_pinned_ip_refuses_to_connect(self):
        """I5-B：未取得經驗證的 IP 時一律拋錯，不得退回使用原始 hostname。"""
        with mock.patch("learning.external_modules.socket.getaddrinfo") as resolver:
            with mock.patch("learning.external_modules.socket.create_connection") as connect:
                self.assertFalse(em._probe_pinned("http://twin.example.test/f450", ""))
                connect.assert_not_called()
            resolver.assert_not_called()

    def test_probe_connects_to_pinned_ip_not_hostname(self):
        """I5-B R1：連線目標是釘選 IP；連線過程完全不解析 DNS。"""
        created = {}

        class _FakeResponse:
            status = 204

        class _FakeConnection:
            def __init__(self, host, port=None, *, pinned_ip="", **kwargs):
                created["host"] = host
                created["port"] = port
                created["pinned_ip"] = pinned_ip

            def request(self, *args, **kwargs):
                pass

            def getresponse(self):
                return _FakeResponse()

            def close(self):
                pass

        with mock.patch.object(
            em, "_PinnedHTTPConnection", _FakeConnection
        ), mock.patch("learning.external_modules.socket.getaddrinfo") as resolver:
            result = em._probe_pinned("http://twin.example.test:8080/f450", "93.184.216.34")
        self.assertTrue(result)
        self.assertEqual(created["host"], "twin.example.test")  # Host 標頭仍用主機名
        self.assertEqual(created["pinned_ip"], "93.184.216.34")  # 連線目標是經驗證 IP
        resolver.assert_not_called()  # 連線過程沒有第二次 DNS 解析

    def test_https_probe_uses_default_tls_context(self):
        """I5-B：HTTPS 探測使用系統預設 TLS 驗證，SNI 用原始主機名。"""
        captured = {}

        class _FakeResponse:
            status = 204

        class _FakeConnection:
            def __init__(self, host, port=None, *, pinned_ip="", **kwargs):
                captured.update(kwargs)
                captured["host"] = host
                captured["pinned_ip"] = pinned_ip

            def request(self, *args, **kwargs):
                pass

            def getresponse(self):
                return _FakeResponse()

            def close(self):
                pass

        with mock.patch.object(em, "_PinnedHTTPSConnection", _FakeConnection):
            result = em._probe_pinned("https://twin.example.test/f450", "93.184.216.34")
        self.assertTrue(result)
        self.assertIs(captured["context"], em._PROBE_TLS_CONTEXT)
        self.assertEqual(captured["host"], "twin.example.test")
        self.assertEqual(captured["pinned_ip"], "93.184.216.34")

    def test_dns_rebinding_cannot_reach_internal_address(self):
        """I5-B R1 端到端：判定時為公網、之後改回內網也無法得逞。

        完整走一遍 `get_external_module()`：第一次 DNS 回公網（驗證通過並釘選），
        第二次 DNS 回 127.0.0.1。斷言探測被呼叫時帶的是**公網 IP**，
        代表重綁後的回應完全未被採用。
        """
        answers = [
            [(2, 1, 6, "", ("93.184.216.34", 0))],  # 第一次（判定）：公網
            [(2, 1, 6, "", ("127.0.0.1", 0))],       # 第二次（重綁）：內網
        ]
        calls = []

        def _rebinding_getaddrinfo(host, port, *args, **kwargs):
            calls.append(host)
            return answers[min(len(calls) - 1, len(answers) - 1)]

        clear_probe_cache()
        with mock.patch(
            "learning.external_modules.socket.getaddrinfo", side_effect=_rebinding_getaddrinfo
        ), mock.patch.object(em, "_probe_pinned", return_value=True) as probe:
            with override_settings(
                FDE_EXTERNAL_MODULES={
                    "F450_DIGITAL_TWIN": {
                        "enabled": True,
                        "entry_url": "http://rebind.example.test:8198/mp",
                    }
                }
            ):
                module = em.get_external_module("F450_DIGITAL_TWIN", role="student")

        self.assertEqual(module["availability_status"], STATUS_AVAILABLE)
        self.assertEqual(module["url"], "http://rebind.example.test:8198/mp")
        self.assertEqual(len(calls), 1)  # 整個流程只解析一次 DNS
        probe.assert_called_once_with("http://rebind.example.test:8198/mp", "93.184.216.34")
        # 第二次（內網）回應從未被使用 → DNS 重綁無效。

    def test_url_comes_only_from_server_side_settings(self):
        """入口 URL 只來自伺服器端設定，不接受任何請求輸入。"""
        import inspect

        import learning.external_modules as mod

        for func in (mod.get_external_module, mod.validate_entry_url):
            source = inspect.getsource(func)
            for forbidden in ("request.", "GET.get", "POST.get", "query_params", "request["):
                self.assertNotIn(forbidden, source, msg="不得由請求取得 URL：{}".format(forbidden))


