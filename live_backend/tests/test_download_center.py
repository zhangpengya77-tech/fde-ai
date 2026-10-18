import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from starlette.testclient import TestClient

from app.download_center import refresh_manifest
from app.main import create_app


class DownloadCenterTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name) / "downloads"
        self.root.mkdir()
        self.manifest_path = Path(self.tempdir.name) / "download_manifest.json"
        self.package = self.root / "ground-station" / "MissionPlanner-1.3.83.msi"
        self.package.parent.mkdir()
        self.package.write_bytes(b"FDE-DOWNLOAD" * 4096)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_refresh_manifest_scans_whitelisted_package_without_absolute_path(self):
        manifest = refresh_manifest(self.root, self.manifest_path, max_depth=4)

        self.assertEqual(len(manifest["downloads"]), 1)
        item = manifest["downloads"][0]
        self.assertEqual(item["filename"], "MissionPlanner-1.3.83.msi")
        self.assertEqual(item["category"], "ground-station")
        self.assertEqual(item["sha256"], hashlib.sha256(self.package.read_bytes()).hexdigest())
        self.assertEqual(item["download_path"], f"/api/downloads/{item['id']}/file")
        self.assertNotIn(str(self.root), json.dumps(manifest, ensure_ascii=False))

    def test_manifest_and_download_are_whitelist_only_with_byte_range(self):
        manifest = refresh_manifest(self.root, self.manifest_path, max_depth=4)
        item_id = manifest["downloads"][0]["id"]
        client = TestClient(create_app(download_root=self.root, download_manifest_path=self.manifest_path))

        listing = client.get("/api/downloads")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["downloads"][0]["id"], item_id)
        self.assertNotIn(str(self.root), listing.text)

        response = client.get(f"/api/downloads/{item_id}/file", headers={"Range": "bytes=0-15"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], f"bytes 0-15/{self.package.stat().st_size}")
        self.assertEqual(response.content, self.package.read_bytes()[:16])

        self.assertEqual(client.get("/api/downloads/../../windows/file").status_code, 404)

    def test_webodm_folder_keeps_git_as_development_installation_tool(self):
        git_package = self.root / "Webodm建模" / "Student_Release" / "installers" / "Git_Installer.exe"
        git_package.parent.mkdir(parents=True)
        git_package.write_bytes(b"GIT-INSTALLER")

        manifest = refresh_manifest(self.root, self.manifest_path, max_depth=4)
        git_item = next(item for item in manifest["downloads"] if item["filename"] == "Git_Installer.exe")

        self.assertEqual(git_item["category"], "development-installation-tool")
        self.assertEqual(git_item["display_name"], "Git 安裝工具")
        self.assertEqual(git_item["description_zh"], "Git 安裝工具；部分開源教學軟體部署時使用。")
    def test_webodm_package_in_webodm_folder_is_3d_mapping_card(self):
        webodm_package = self.root / "Webodm建模" / "Student_Release" / "WebODM-Student.zip"
        webodm_package.parent.mkdir(parents=True)
        webodm_package.write_bytes(b"WEBODM-PACKAGE")

        manifest = refresh_manifest(self.root, self.manifest_path, max_depth=4)
        webodm_item = next(item for item in manifest["downloads"] if item["filename"] == "WebODM-Student.zip")

        self.assertEqual(webodm_item["category"], "3d-mapping")
        self.assertEqual(webodm_item["display_name"], "WebODM")
        self.assertEqual(webodm_item["description_zh"], "航拍影像測繪、正射影像與 3D 建模教學工具。")
    def test_version_detection_supports_underscore_delimited_versions(self):
        from app.download_center import _version

        self.assertEqual(_version("NAZAM_2.20_Installer.exe"), "2.20")
    def test_root_homepage_and_src_assets_are_served(self):
        client = TestClient(create_app(download_root=self.root, download_manifest_path=self.manifest_path))

        homepage = client.get("/")
        stylesheet = client.get("/src/styles.css")
        script = client.get("/src/app.js")

        self.assertEqual(homepage.status_code, 200)
        self.assertIn("FDE-AI", homepage.text)
        self.assertEqual(stylesheet.status_code, 200)
        self.assertEqual(script.status_code, 200)
    def test_download_center_static_page_is_served(self):
        response = TestClient(create_app(download_root=self.root, download_manifest_path=self.manifest_path)).get("/downloads/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("學員下載中心", response.text)


if __name__ == "__main__":
    unittest.main()

