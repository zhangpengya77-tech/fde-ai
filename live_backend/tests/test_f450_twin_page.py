"""F450 數位孿生獨立入口：靜態頁、模型與首頁連結卡。"""
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]


class OfflineVisionAdapter:
    async def health(self) -> bool:
        return False


class F450TwinPageTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(vision_adapter=OfflineVisionAdapter()))

    def test_twin_page_and_models_are_served(self):
        page = self.client.get("/f450-twin/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("數位孿生", page.text)
        self.assertIn("資料狀態", page.text)
        self.assertIn("不是</b>實機 1:1", page.text)
        for mode in ("整機視圖", "爆炸結構", "組裝流程", "接線圖", "尺寸規格"):
            self.assertIn(mode, page.text)
        for path in ("/f450-twin/models/f450-l2-r8-twin.glb", "/f450-twin/models/f450-l2-r4-preview-assembly.glb"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.content[:4], b"glTF", path)
        for path in ("/f450-twin/vendor/three/three.module.min.js", "/f450-twin/app.js", "/f450-twin/parts-data.js", "/f450-twin/twin.css", "/f450-twin/img/part-pixhawk.png", "/f450-twin/vendor/three/draco/draco_decoder.wasm", "/f450-twin/vendor/three/addons/loaders/DRACOLoader.js"):
            self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_teaching_data_never_claims_verified_parts(self):
        data = (ROOT / "f450-twin" / "parts-data.js").read_text(encoding="utf-8")
        self.assertNotIn("status: 'VERIFIED'", data, "本版沒有零件達到實機核對，不得標示 VERIFIED")
        self.assertIn("待實機核對", data)
        self.assertIn("拆槳", data)

    def test_home_page_has_single_twin_entry_and_keeps_main12(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('id="buildF450TwinEntry"'), 1)
        self.assertIn('href="/f450-twin/"', html)
        self.assertIn('id="buildMain12Entry"', html)
        # 2026-11-06：入口改為教學區上方的數位孿生入口卡；依使用者要求恢復顯示 F450 RAG AI 助教（含照片／影片上傳與語音）
        self.assertIn('f450-twin-feature', html)
        self.assertIn('id="assistantButton"', html)
        self.assertNotIn('<div class="panel" hidden>', html, "AI 助教面板依使用者要求恢復顯示，不可再隱藏")
        self.assertEqual(self.client.get("/f450-twin/preview.jpg").status_code, 200)

    def test_twin_page_does_not_embed_teacher_photos(self):
        html = (ROOT / "f450-twin" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("IMG_8", html)
        self.assertNotIn(".jpg", html.lower())


if __name__ == "__main__":
    unittest.main()
