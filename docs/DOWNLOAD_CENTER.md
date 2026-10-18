# Download Center（本機 P0）

## 檔案來源

Download Center 不把安裝包納入 Git。預設優先讀取 `D:\FDE-Downloads`；若該目錄不存在，會使用老師現有的 `D:\下載中心文件`。

可使用 `FDE_DOWNLOAD_ROOT` 指向其他本機資料夾。瀏覽器只會看到 `/api/downloads/{id}/file`，不會看到 Windows 實體路徑。

## 更新下載清單

老師將檔案放入下載來源資料夾後，在 `live_backend` 目錄執行：

```text
python tools/refresh_download_manifest.py
```

這會建立／更新來源資料夾內的 `download_manifest.json`，掃描支援的 `.exe`、`.msi`、`.zip`、`.7z`、`.rar`、`.pdf`，並記錄檔案大小、修改時間及 SHA-256。深層第三方原始碼與測試素材不會列入第一版清單。

## 本機 API

- `GET /api/downloads`
- `GET /api/downloads/{id}/file`
- `GET /downloads/`

下載端點只接受 Manifest 白名單 ID，並在輸出前再次檢查相對路徑仍位於下載根目錄。大型檔案用串流輸出，支援單一 HTTP Range 請求。

## 對外公開的下一步

本機 P0 不開 Windows Port、不開 SMB、不建立 Router Port Forwarding。若要公開給校外學員，應將安裝包放入經教師確認授權的 Object Storage／CDN，保留本 API 作為 Manifest 與授權層，將每一個下載 ID 映射到受控的外部物件 URL 或短時效簽名 URL。
