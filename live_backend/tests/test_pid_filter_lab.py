"""AI PID & Filter Lab 測試。

- 真實樣本測試讀取 FDE_PID_LAB_SAMPLES（預設 D:/FDE-AI-Runtime/pidlab-samples）；找不到樣本時 skip，不會冒充通過。
- 規則邏輯測試使用「明確標示的合成資料」，只驗證判斷邏輯，不代表真實日誌分析結果。
"""

from __future__ import annotations

import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from pid_filter_lab import adapters, pipeline  # noqa: E402
from pid_filter_lab.analysis import compare, health  # noqa: E402
from pid_filter_lab.api import PidLabService  # noqa: E402
from pid_filter_lab.model import FlightData  # noqa: E402
from pid_filter_lab.parsers import blackbox, dataflash, params, ulog  # noqa: E402
from pid_filter_lab.rules import advisor, catalog  # noqa: E402
from pid_filter_lab.rules import export as export_mod  # noqa: E402

SAMPLES = Path(os.environ.get("FDE_PID_LAB_SAMPLES", "D:/FDE-AI-Runtime/pidlab-samples"))
BF_GOOD = SAMPLES / "betaflight" / "plasmatree_good_tune.BBL"
BF_STOCK = SAMPLES / "betaflight" / "plasmatree_stock_tune.BFL"
AP_FLIGHT = SAMPLES / "ardupilot" / "f450_flight_4.5.7.bin"
AP_BENCH = SAMPLES / "ardupilot" / "log_452_2026-9-29-20-38-08.bin"
AP_TAROT = SAMPLES / "ardupilot" / "tarot_x4_methodic.bin"
AP_484 = SAMPLES / "ardupilot" / "f450_log484_20261015.bin"
AP_496 = SAMPLES / "ardupilot" / "f450_log496_20261018.bin"
AP_498_CRASH = SAMPLES / "ardupilot" / "f450_log498_20261101_crash.bin"
PX4_OLD = SAMPLES / "px4" / "sample.ulg"
PX4_NEW = SAMPLES / "px4" / "sample_log_small.ulg"
PX4_115 = SAMPLES / "px4" / "sample_px4_events.ulg"


def need(path: Path):
    return unittest.skipUnless(path.exists(), f"缺少真實樣本 {path}（未驗收）")


# ---------------------------------------------------------------- 真實樣本
class RealSampleParsing(unittest.TestCase):
    @need(BF_GOOD)
    def test_betaflight_bbl_decodes(self):
        logs = blackbox.decode(BF_GOOD.read_bytes())
        main = max(logs, key=lambda l: l.stats["frames"])
        self.assertGreater(main.stats["frames"], 100000)
        self.assertLess(main.stats["corrupt_frames"] / main.stats["frames"], 0.02)
        t = main.column("time")
        self.assertTrue(np.all(np.diff(t) > 0), "時間必須單調遞增")

    @need(BF_STOCK)
    def test_betaflight_bfl_multi_segment_clean(self):
        logs = blackbox.decode(BF_STOCK.read_bytes())
        self.assertEqual(len(logs), 14)
        main = max(logs, key=lambda l: l.stats["frames"])
        self.assertEqual(main.stats["corrupt_frames"], 0)
        self.assertTrue(main.stats["ended_cleanly"])

    @need(BF_STOCK)
    def test_betaflight_setpoint_tracks_gyro(self):
        fd = adapters.adapt(BF_STOCK.read_bytes())
        self.assertEqual(fd.ecosystem, "betaflight")
        self.assertEqual(fd.firmware["version"], "3.1.5")
        for axis in ("roll", "pitch", "yaw"):
            sp, g = fd.sig(f"rate.{axis}.setpoint"), fd.sig(f"rate.{axis}.actual")
            self.assertTrue(sp.derived)
            self.assertGreater(np.corrcoef(sp.v, g.v)[0, 1], 0.9, axis)

    @need(AP_FLIGHT)
    def test_ardupilot_bin(self):
        fd = adapters.adapt(AP_FLIGHT.read_bytes())
        self.assertEqual(fd.ecosystem, "ardupilot")
        self.assertEqual(fd.firmware["name"], "ArduCopter")
        self.assertEqual(fd.firmware["version"], "4.5.7")
        self.assertFalse(fd.firmware["legacy"])
        self.assertIn("ATC_RAT_RLL_P", fd.params)
        self.assertIsNotNone(fd.sig("vibe.z"))

    @need(PX4_NEW)
    def test_px4_ulog_version(self):
        fd = adapters.adapt(PX4_NEW.read_bytes())
        self.assertEqual(fd.ecosystem, "px4")
        self.assertEqual(fd.firmware["version"], "1.11.2")
        self.assertEqual(fd.hardware["board"], "CUBEPILOT_CUBEORANGE")
        self.assertIn("MC_ROLLRATE_P", fd.params)

    @need(PX4_OLD)
    def test_px4_without_release_is_not_invented(self):
        fd = adapters.adapt(PX4_OLD.read_bytes())
        self.assertEqual(fd.firmware["version"], "unknown")
        self.assertIsNotNone(fd.sig("rate.roll.actual"))  # 舊版 vehicle_attitude.rollspeed

    @need(PX4_115)
    def test_px4_115_sitl(self):
        fd = adapters.adapt(PX4_115.read_bytes())
        self.assertEqual(fd.firmware["version"], "1.15.0")


class RealSampleAnalysis(unittest.TestCase):
    @need(BF_STOCK)
    def test_stock_tune_flags_overshoot_for_review(self):
        r = pipeline.run(BF_STOCK.read_bytes())
        reviews = [s for s in r["advice"]["suggestions"] if s["level"] == "REVIEW"]
        self.assertTrue(any(s["rule_id"].startswith("OVERSHOOT") for s in reviews))
        for s in reviews:
            for p in s["params"]:
                self.assertIn(p["name"], {"d_roll", "d_pitch", "p_roll", "p_pitch"})

    @need(BF_GOOD)
    def test_good_tune_has_no_review(self):
        r = pipeline.run(BF_GOOD.read_bytes())
        self.assertNotIn("REVIEW", r["advice"]["counts"])
        ind = {i["key"]: i["status"] for i in r["health"]["indicators"]}
        self.assertEqual(ind["gps"], "N/A")
        self.assertEqual(ind["navigation"], "N/A")

    @need(AP_FLIGHT)
    def test_ardupilot_low_rate_is_insufficient_not_guessed(self):
        r = pipeline.run(AP_FLIGHT.read_bytes())
        for axis in ("roll", "pitch", "yaw"):
            self.assertEqual(r["control"]["rate_loop"][axis]["status"], "INSUFFICIENT")
        self.assertNotIn("REVIEW", r["advice"]["counts"])
        self.assertEqual(len(r["health"]["indicators"]), 8)

    @need(AP_TAROT)
    def test_ardupilot_batch_sampler_filter_analysis(self):
        fd = adapters.adapt(AP_TAROT.read_bytes())
        self.assertEqual(fd.firmware["version"], "4.5.5")
        self.assertEqual(fd.hardware["board"], "Pixhawk6X")
        stages = {(b["sensor"], b["stage"]) for b in fd.batches}
        self.assertIn(("gyro", "pre"), stages)
        self.assertIn(("gyro", "post"), stages)
        full = sum(len(b["x"]) == 1024 for b in fd.batches)
        self.assertGreater(full / len(fd.batches), 0.9, "大多數批次應為完整 1024 點（日誌結尾可能截斷）")
        r = pipeline.run(AP_TAROT.read_bytes())
        effect = r["control"]["filter_effect"]
        for axis in ("roll", "pitch"):
            self.assertLess(effect[axis]["attenuation_db"]["80_200hz"], -10, "濾波後雜訊必須明顯低於濾波前")
        notch = [s for s in r["advice"]["suggestions"] if s["rule_id"] == "NOTCH-CHECK"]
        self.assertEqual(len(notch), 1)
        self.assertEqual(notch[0]["level"], "INFO")

    @need(AP_498_CRASH)
    def test_f450_crash_and_thrust_loss_block_tuning(self):
        r = pipeline.run(AP_498_CRASH.read_bytes())
        ind = {i["key"]: i for i in r["health"]["indicators"]}
        self.assertEqual(ind["flight_mode"]["status"], "FAIL")
        self.assertIn("墜機偵測", ind["flight_mode"]["summary"])
        self.assertIn("推力不足偵測", ind["flight_mode"]["summary"])
        self.assertEqual(ind["attitude"]["status"], "FAIL")
        upsets = r["control"]["attitude_loop"]["upsets"]
        self.assertEqual(len(upsets), 1)
        self.assertLess(upsets[0]["end_s"] - upsets[0]["start_s"], 10, "翻覆段只涵蓋墜機時段")
        self.assertLess(r["control"]["attitude_loop"]["roll"]["tracking_rms_deg"], 6, "排除翻覆後的正常飛行誤差")
        self.assertTrue(r["advice"]["blocked"])

    @need(AP_496)
    def test_f450_ground_handling_is_not_upset(self):
        r = pipeline.run(AP_496.read_bytes())
        self.assertNotIn("upsets", r["control"]["attitude_loop"])
        self.assertEqual({i["key"]: i["status"] for i in r["health"]["indicators"]}["attitude"], "PASS")

    @need(AP_484)
    def test_f450_long_flight_battery_warning(self):
        r = pipeline.run(AP_484.read_bytes())
        ind = {i["key"]: i for i in r["health"]["indicators"]}
        self.assertEqual(r["flight"]["firmware_version"]["version"], "4.5.7")
        self.assertGreater(r["flight"]["log_metadata"]["duration_s"], 1300)
        self.assertEqual(ind["battery"]["status"], "WARN")
        self.assertFalse(r["advice"]["blocked"])

    @need(AP_BENCH)
    def test_ardupilot_bench_detected(self):
        r = pipeline.run(AP_BENCH.read_bytes())
        self.assertIn(r["control"]["rate_loop"]["roll"]["status"], ("INSUFFICIENT",))


# ---------------------------------------------------------------- 錯誤與損毀
class BadInputs(unittest.TestCase):
    def test_empty_and_unknown(self):
        self.assertIsNone(adapters.detect(b""))
        with self.assertRaises(adapters.UnsupportedLog):
            adapters.adapt(b"hello world")

    def test_extension_does_not_decide(self):
        self.assertIsNone(adapters.detect(b"H Product:not a blackbox"))

    def test_truncated_blackbox_header_only(self):
        data = b"H Product:Blackbox flight data recorder by Nicholas Sherlock\nH Data version:2\n"
        with self.assertRaises(blackbox.BlackboxError):
            adapters.adapt(data)

    @need(BF_GOOD)
    def test_truncated_blackbox_file(self):
        data = BF_GOOD.read_bytes()[:400000]
        fd = adapters.adapt(data)
        self.assertFalse(fd.log_metadata["ended_cleanly"])
        self.assertTrue(any("正常結束" in w for w in fd.warnings))

    def test_dataflash_garbage(self):
        with self.assertRaises(dataflash.DataFlashError):
            dataflash.parse(b"\xa3\x95\x80" + b"\x00" * 10)

    def test_ulog_header_only(self):
        with self.assertRaises(ulog.ULogError):
            ulog.parse(ulog.MAGIC + b"\x01" + struct.pack("<Q", 0))

    def test_mismatch_selected_ecosystem(self):
        if not PX4_NEW.exists():
            self.skipTest("缺少 PX4 樣本")
        with self.assertRaises(adapters.UnsupportedLog):
            adapters.adapt(PX4_NEW.read_bytes(), "betaflight")


# ---------------------------------------------------------------- 規則邏輯（合成資料，僅驗證邏輯）
def synthetic_fd(ecosystem="betaflight", **kw) -> FlightData:
    fd = FlightData(ecosystem=ecosystem, vehicle_type="multirotor", firmware={"name": "X", "version": "4.4.0", "version_tuple": [4, 4, 0]}, hardware={"board": "SYNTH"}, params=kw.get("params", {}), param_source="合成測試")
    fd.log_metadata = {"duration_s": 10.0, "corrupt_ratio": 0.0}
    fd.flags = kw.get("flags", {})
    return fd


class HealthRules(unittest.TestCase):
    def test_missing_battery_is_insufficient_not_pass(self):
        r = health.battery(synthetic_fd())
        self.assertEqual(r["status"], "INSUFFICIENT")
        self.assertIsNone(r["score"])

    def test_fpv_without_gps_is_na(self):
        self.assertEqual(health.gps(synthetic_fd(flags={"gps_configured": False}))["status"], "N/A")

    def test_gps_configured_but_missing_is_insufficient(self):
        self.assertEqual(health.gps(synthetic_fd("ardupilot", flags={"gps_configured": True}))["status"], "INSUFFICIENT")

    def test_overall_excludes_na_and_insufficient(self):
        fd = synthetic_fd(flags={"gps_configured": False})
        result = health.evaluate(fd, {"rate_loop": {}, "attitude_loop": {}})
        o = result["overall"]
        self.assertEqual(o["not_applicable"], 2)
        self.assertLess(o["coverage"], 0.75)
        self.assertFalse(o["comparable"])

    def test_vibration_fail_blocks_tuning(self):
        fd = synthetic_fd("ardupilot")
        t = np.linspace(0, 10, 200)
        for a in "xyz":
            fd.add(f"vibe.{a}", t, np.full(200, 80.0), "m/s²", "合成")
        ctl = {"rate_loop": {}, "attitude_loop": {}, "spectra": {}}
        adv = advisor.advise(fd, ctl, health.evaluate(fd, ctl))
        self.assertTrue(adv["blocked"])
        self.assertTrue(all(s["level"] == "BLOCKED" for s in adv["suggestions"]))


class ParamIsolation(unittest.TestCase):
    def test_catalogs_do_not_share_names(self):
        names = {k: {s.name for specs in c.values() for s in specs} for k, c in catalog.CATALOGS.items()}
        self.assertFalse(names["betaflight"] & names["ardupilot"])
        self.assertFalse(names["betaflight"] & names["px4"])
        self.assertFalse(names["ardupilot"] & names["px4"])
        self.assertFalse(names["ardupilot"] & names["ardupilot_legacy"])

    def test_param_must_exist_in_snapshot(self):
        r = catalog.resolve("ardupilot", {"version_tuple": [4, 5, 7]}, {}, "p.roll")
        self.assertEqual(r["status"], "NOT_IN_SNAPSHOT")

    def test_legacy_apm_uses_rate_params(self):
        fw = {"version_tuple": [3, 2, 1], "legacy": True}
        r = catalog.resolve("ardupilot", fw, {"RATE_RLL_P": 0.15, "ATC_RAT_RLL_P": 0.1}, "p.roll")
        self.assertEqual(r["spec"].name, "RATE_RLL_P")

    def test_bf_filter_name_by_version(self):
        self.assertEqual(catalog.resolve("betaflight", {"version_tuple": [4, 4, 0]}, {"gyro_lpf1_static_hz": 250}, "gyro_lpf")["spec"].name, "gyro_lpf1_static_hz")
        self.assertEqual(catalog.resolve("betaflight", {"version_tuple": [4, 2, 0]}, {"gyro_lowpass_hz": 200}, "gyro_lpf")["spec"].name, "gyro_lowpass_hz")

    def test_export_refuses_foreign_params_and_unapproved(self):
        plan = {"plan_id": "P1", "changes": [{"name": "ATC_RAT_RLL_P", "value": 0.1}]}
        meta = {"ecosystem": "betaflight", "firmware": {"version_tuple": [4, 4, 0], "version": "4.4.0"}}
        with self.assertRaises(export_mod.ExportError):
            export_mod.render(plan, meta, {"status": "APPROVED"})
        ok_plan = {"plan_id": "P2", "changes": [{"name": "p_roll", "value": 50, "current": 45}]}
        with self.assertRaises(export_mod.ExportError):
            export_mod.render(ok_plan, meta, {"status": "PENDING_REVIEW"})
        out = export_mod.render(ok_plan, meta, {"status": "APPROVED", "reviewer": "teacher:1"})
        self.assertIn("set p_roll = 50", out["content"])
        bad = {"plan_id": "P3", "changes": [{"name": "p_roll", "value": 999}]}
        with self.assertRaises(export_mod.ExportError):
            export_mod.render(bad, meta, {"status": "APPROVED"})

    def test_param_import_formats(self):
        bf = params.parse("betaflight", "# Betaflight / STM32F405 (S405) 4.3.1 Jul 13 2022 / 03:32:52\nboard_name SPEEDYBEEF405V3\nset p_roll = 45\n")
        self.assertEqual(bf["firmware"]["version"], "4.3.1")
        self.assertEqual(bf["params"]["p_roll"], 45)
        self.assertEqual(params.parse("ardupilot", "ATC_RAT_RLL_P,0.135\n")["params"]["ATC_RAT_RLL_P"], 0.135)
        self.assertEqual(params.parse("px4", "1\t1\tMC_ROLLRATE_P\t0.15\t9\n")["params"]["MC_ROLLRATE_P"], 0.15)


class CompareRules(unittest.TestCase):
    def _an(self, overshoot, rise, norm, delay, score=80):
        axis = {"status": "OK", "tracking_norm": norm, "delay_ms": delay, "stick_activity_ratio": 0.3, "sample_rate_hz": 1000, "step": {"status": "OK", "overshoot_pct": overshoot, "rise_time_ms": rise}}
        return {"control": {"rate_loop": {"roll": axis, "pitch": dict(axis), "yaw": {"status": "INSUFFICIENT"}}, "spectra": {}}, "health": {"overall": {"score": score, "comparable": True}}}

    def test_single_metric_is_not_success(self):
        meta = {"ecosystem": "betaflight", "aircraft_id": "A", "firmware_version": "4.4.0"}
        r = compare.compare(self._an(30, 20, 0.2, 10), self._an(10, 20, 0.2, 10), meta, meta)
        self.assertEqual(r["outcome"], "IMPROVED")  # roll + pitch 兩軸過衝都改善
        r2 = compare.compare(self._an(30, 20, 0.2, 10), self._an(10, 40, 0.2, 10), meta, meta)
        self.assertEqual(r2["outcome"], "WORSE")

    def test_different_ecosystem_insufficient(self):
        r = compare.compare(self._an(1, 1, 1, 1), self._an(1, 1, 1, 1), {"ecosystem": "px4"}, {"ecosystem": "betaflight"})
        self.assertEqual(r["outcome"], "INSUFFICIENT")


# ---------------------------------------------------------------- API：權限、上傳、審核流程
class LabApi(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.svc = PidLabService(Path(self.tmp.name), require_identity=False, inline_jobs=True)
        self.client = TestClient(Starlette(routes=self.svc.routes()))

    def tearDown(self):
        self.svc.executor.shutdown(wait=True)
        self.tmp.cleanup()

    def h(self, ident):
        return {"X-PidLab-Dev-Identity": ident}

    def aircraft(self, ident, eco="betaflight"):
        r = self.client.post("/api/live/pid-lab/aircraft", json={"name": "A01", "ecosystem": eco, "data": {"firmware_version": "3.1.5"}}, headers=self.h(ident))
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()["id"]

    def test_secure_mode_requires_identity(self):
        svc = PidLabService(Path(self.tmp.name) / "secure", require_identity=True)
        c = TestClient(Starlette(routes=svc.routes()))
        r = c.get("/api/live/pid-lab/aircraft", headers=self.h("teacher:x:c1"))
        self.assertEqual(r.status_code, 401, "正式模式不得接受開發身分標頭")
        svc.executor.shutdown()

    def test_upload_validation(self):
        st = "student:s1:c1"
        aid = self.aircraft(st)
        base = f"/api/live/pid-lab/logs?aircraft_id={aid}"
        self.assertEqual(self.client.post(base + "&filename=x.exe", content=b"x", headers=self.h(st)).status_code, 400)
        self.assertEqual(self.client.post(base + "&filename=x.bbl", content=b"", headers=self.h(st)).status_code, 400)
        self.assertEqual(self.client.post(base + "&filename=x.bbl", content=b"not a log", headers=self.h(st)).status_code, 400)
        other = self.aircraft("student:s2:c1")
        r = self.client.post(f"/api/live/pid-lab/logs?aircraft_id={other}&filename=x.bbl", content=b"x", headers=self.h(st))
        self.assertEqual(r.status_code, 400, "不能上傳到別人的飛機")
        r = self.client.post(base + "&filename=x.bbl", content=b"x", headers={**self.h(st), "content-length": str(70 * 1024 * 1024)})
        self.assertIn(r.status_code, (400, 413))

    def test_other_ecosystem_profile_only(self):
        st = "student:s1:c1"
        r = self.client.post("/api/live/pid-lab/aircraft", json={"name": "X", "ecosystem": "other", "data": {}}, headers=self.h(st))
        self.assertEqual(r.status_code, 400, "其他飛控必須填寫韌體名稱")
        r = self.client.post("/api/live/pid-lab/aircraft", json={"name": "X", "ecosystem": "other", "data": {"other_firmware": "iNav 7"}}, headers=self.h(st))
        self.assertEqual(r.status_code, 201)
        up = self.client.post(f"/api/live/pid-lab/logs?aircraft_id={r.json()['id']}&filename=a.bin", content=b"\xa3\x95\x80", headers=self.h(st))
        self.assertEqual(up.status_code, 400)

    @need(BF_STOCK)
    def test_full_teaching_flow_and_isolation(self):
        st, st2, teacher, other_teacher = "student:s1:c1", "student:s2:c1", "teacher:t1:c1", "teacher:t9:c9"
        aid = self.aircraft(st)
        data = BF_STOCK.read_bytes()
        r = self.client.post(f"/api/live/pid-lab/logs?aircraft_id={aid}&filename=stock.BFL&phase=BASELINE", content=data, headers=self.h(st))
        self.assertEqual(r.status_code, 202, r.text)
        lid = r.json()["log"]["id"]
        log = self.client.get(f"/api/live/pid-lab/logs/{lid}", headers=self.h(st)).json()
        self.assertEqual(log["status"], "DONE", log.get("error"))
        dup = self.client.post(f"/api/live/pid-lab/logs?aircraft_id={aid}&filename=stock.BFL", content=data, headers=self.h(st))
        self.assertTrue(dup.json()["duplicate"])
        # 權限隔離
        self.assertEqual(self.client.get(f"/api/live/pid-lab/logs/{lid}", headers=self.h(st2)).status_code, 404)
        self.assertEqual(self.client.get(f"/api/live/pid-lab/logs/{lid}", headers=self.h(other_teacher)).status_code, 404)
        self.assertEqual(self.client.get(f"/api/live/pid-lab/logs/{lid}", headers=self.h(teacher)).status_code, 200)
        analysis = self.client.get(f"/api/live/pid-lab/logs/{lid}/analysis", headers=self.h(st)).json()
        review_ids = [s["id"] for s in analysis["advice"]["suggestions"] if s["level"] == "REVIEW"]
        self.assertTrue(review_ids)
        plan = self.client.post(f"/api/live/pid-lab/logs/{lid}/plans", json={"suggestion_ids": review_ids, "note": "過衝明顯"}, headers=self.h(st)).json()
        self.assertEqual(plan["status"], "PENDING_REVIEW")
        # 未審核不得匯出；學員不得審核；他班教師不得審核
        self.assertEqual(self.client.get(f"/api/live/pid-lab/plans/{plan['id']}/export", headers=self.h(st)).status_code, 409)
        self.assertEqual(self.client.post(f"/api/live/pid-lab/plans/{plan['id']}/review", json={"decision": "APPROVED", "note": "ok"}, headers=self.h(st)).status_code, 403)
        self.assertEqual(self.client.post(f"/api/live/pid-lab/plans/{plan['id']}/review", json={"decision": "APPROVED", "note": "ok"}, headers=self.h(other_teacher)).status_code, 404)
        self.assertEqual(self.client.post(f"/api/live/pid-lab/plans/{plan['id']}/review", json={"decision": "APPROVED"}, headers=self.h(teacher)).status_code, 400)
        bad = self.client.post(f"/api/live/pid-lab/plans/{plan['id']}/review", json={"decision": "APPROVED", "note": "x", "values": {plan["changes"][0]["name"]: 9999}}, headers=self.h(teacher))
        self.assertEqual(bad.status_code, 400, "超出範圍的教師修改值必須拒絕")
        ok = self.client.post(f"/api/live/pid-lab/plans/{plan['id']}/review", json={"decision": "APPROVED", "note": "已檢查槳與馬達，懸停 30 秒後再做翻滾測試"}, headers=self.h(teacher))
        self.assertEqual(ok.json()["status"], "APPROVED")
        out = self.client.get(f"/api/live/pid-lab/plans/{plan['id']}/export", headers=self.h(st)).json()
        self.assertIn("set d_", out["content"])
        self.assertIn("diff all", out["content"])
        # 比較（同一份檔案作為 AFTER，應為 UNCHANGED）
        r2 = self.client.post(f"/api/live/pid-lab/logs?aircraft_id={aid}&filename=after.BFL&phase=AFTER_TUNING&allow_duplicate=1", content=data, headers=self.h(st))
        cmp = self.client.post("/api/live/pid-lab/comparisons", json={"baseline_log_id": lid, "after_log_id": r2.json()["log"]["id"]}, headers=self.h(st)).json()
        self.assertEqual(cmp["result"]["outcome"], "UNCHANGED")
        # 標準參數庫：沒有 IMPROVED 證據不得 APPROVED
        lib = self.client.post("/api/live/pid-lab/library", json={"ecosystem": "betaflight", "teaching_model": "2.5寸", "firmware_version": "3.1.5"}, headers=self.h(teacher)).json()
        rej = self.client.put(f"/api/live/pid-lab/library/{lib['id']}", json={"status": "APPROVED", "baseline_log_id": lid, "after_log_id": r2.json()["log"]["id"], "comparison_id": cmp["id"]}, headers=self.h(teacher))
        self.assertEqual(rej.status_code, 409)
        self.assertEqual(self.client.post("/api/live/pid-lab/library", json={"ecosystem": "betaflight", "teaching_model": "x", "firmware_version": "1"}, headers=self.h(st)).status_code, 403)
        rec = self.client.get("/api/live/pid-lab/records", headers=self.h(st)).json()
        self.assertEqual(len(rec["logs"]), 2)
        self.assertEqual(len(rec["plans"]), 1)


class MainAppIntegration(unittest.TestCase):
    def test_routes_mounted_and_protected(self):
        os.environ.setdefault("FDE_PID_LAB_ROOT", tempfile.mkdtemp())
        from app.main import create_app

        app = create_app(dev_mode=False, live_assertion_key="k", trusted_proxy_key="p")
        client = TestClient(app)
        r = client.get("/api/live/pid-lab/aircraft")
        self.assertIn(r.status_code, (401, 403), "未經 Gateway 的請求必須被拒")
        page = client.get("/pid-lab/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("AI PID 與濾波實驗室", page.text)


if __name__ == "__main__":
    unittest.main()
