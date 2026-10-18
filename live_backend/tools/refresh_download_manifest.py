from __future__ import annotations

import sys
from pathlib import Path

# 讓教師可從 tools 目錄直接執行既有下載 Manifest 掃描。
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.download_center import configured_download_root, configured_manifest_path, refresh_manifest


if __name__ == "__main__":
    root = configured_download_root()
    manifest = refresh_manifest(root, configured_manifest_path(root))
    print(f"manifest_refreshed={len(manifest['downloads'])}")
