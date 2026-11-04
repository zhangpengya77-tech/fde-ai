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
        self.assertIn("F450 數位孿生（互動拆解）", page.text)
        self.assertIn("照片參考級", page.text)
        for path in ("/f450-twin/models/f450-l2-r4-preview-assembly.glb", "/f450-twin/models/f450-l2-r4-preview-exploded.glb"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.content[:4], b"glTF", path)
        self.assertEqual(self.client.get("/f450-twin/vendor/three/three.module.min.js").status_code, 200)

    def test_home_page_has_single_twin_entry_and_keeps_main12(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('id="buildF450TwinEntry"'), 1)
        self.assertIn('href="/f450-twin/"', html)
        self.assertIn('id="buildMain12Entry"', html)

    def test_twin_page_does_not_embed_teacher_photos(self):
        html = (ROOT / "f450-twin" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("IMG_8", html)
        self.assertNotIn(".jpg", html.lower())


if __name__ == "__main__":
    unittest.main()
