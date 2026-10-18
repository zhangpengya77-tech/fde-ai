# R01 影片上傳狀態異常——根因診斷與隔離驗證報告

- 日期：2026-10-14（WorkBuddy 接手診斷，教師實際驗收回報後）
- 範圍：`http://192.168.1.114:8111/student/courses/1/growth/R01/`（DEMO，Live Backend 8111 → Django 8110）
- 結論先行：**根因是「後端狀態問題」——由伺服器缺少 FFmpeg／ffprobe 觸發的連鎖失敗**，不是前端顯示錯誤、不是資料關聯錯誤、也不是「未開始」為原本設計。影片從未真正送達伺服器；畫面所見影片是瀏覽器端的「待提交預覽」。

---

## A. 根因（分類：後端狀態問題，環境缺失觸發）

失敗鏈（每一環均已實證）：

1. **環境**：系統無 ffmpeg／ffprobe（PATH 無、全盤無二進位、服務環境未設定 `DJANGO_FFMPEG_BINARY`／`DJANGO_FFPROBE_BINARY`）。
2. **後端**：`learning/growth_video.py::process_growth_video()` 第一道檢查（第 308–314 行）即拋 `VideoProcessingError(reason="video_tools_missing")`，訊息「目前無法處理影片，伺服器尚未安裝影片處理工具。」。
3. **視圖**：`learning/views.py::growth_record_detail()`（第 1010–1034 行）對該錯誤執行 `form.add_error("video", …)` → **整張表單驗證失敗**。
4. **保存被整體中止**：第 1036 行 `if form.is_valid() and not form.errors:` 守衛著「狀態更新＋Evidence 建立」整段——含影片草稿的 POST 到達伺服器後**零資料庫寫入**。
5. **畫面**：重新渲染時 `submission.status` 仍為 `not_started` → 第 19 行顯示「○ 未開始」。

日誌實證（`demo/runtime/logs/django.err.log`，教師驗收時段）：6 次 `VIDEO_UPLOAD_REQUEST`（18:32–18:37）＋2 次（18:49，R05），全部 `VIDEO_UPLOAD_FAILED … reason=video_tools_missing`，`VIDEO_UPLOAD_COMPLETE` 為 0 次。

「未開始」**並非**原本設計：原本設計為保存草稿 `not_started → in_progress`（🟡 進行中）、提交教師 `→ submitted`（待教師複核）。

## B. R01 實際狀態與畫面「未開始」的差異

| 時點 | R01 實際狀態（DB） | 畫面 | 說明 |
|---|---|---|---|
| 教師回報時（約 18:32–18:40） | `not_started`，`updated_at` 仍為 2026-10-08 播種時間，零 Evidence | 「○ 未開始」＋工具缺失錯誤 | 畫面如實反映：草稿保存被影片失敗連帶中止 |
| 教師所見「影片仍存在」 | **伺服器端零 video Evidence、MEDIA_ROOT 零 mp4** | 待提交區可播放 | 前端 `growth-upload.js` 以 `URL.createObjectURL` 本地預覽，錯誤時明示「影片仍保留在待提交清單」；整理頁面後若重取頁面即消失（iOS Safari 頁面快取可造成「仍在」的錯覺） |
| 18:47（診斷期間） | `submitted`，2 張照片 Evidence 入庫（磁碟檔已在） | 待教師複核 | 教師改用**不含影片**的表單即成功——證明非影片路徑完全正常 |
| 現在 | `submitted` + 2 照片，全 DB 零影片 Evidence | — | 教師可於教師後台審核此筆 |

已逐項排除：前端讀錯欄位／舊快取（頁面與成長日誌皆直接渲染 `submission.status`，無快取層）、Evidence 未關聯學員/課程/R01（從未建立）、任務狀態未同步（狀態根本未被更新）。

## C. FFmpeg／ffprobe 檢查結果

- `Get-Command ffmpeg/ffprobe`：皆 NOT FOUND；常見安裝目錄與 venv（含 imageio-ffmpeg）均無二進位。
- `settings.py`：`GROWTH_VIDEO_FFMPEG_BINARY = os.environ.get('DJANGO_FFMPEG_BINARY', 'ffmpeg')`（ffprobe 同理）；DEMO 啟動腳本未設定兩變數 → 服務行程內 `shutil.which('ffmpeg')` 回傳 None，不可呼叫。

影片處理四項能力：

| 能力 | 狀態 | 依據 |
|---|---|---|
| 原始影片上傳／播放 | ✅ 正常 | Django 收到完整 multipart（日誌 content_length=34,055,103）並寫入暫存檔；預覽播放為瀏覽器本地 |
| 轉碼（≤720p／30fps／h264／aac／faststart，逾 30 秒截前 30 秒） | ❌ 不可用 | ffmpeg 缺失（`_transcode` 第 222–227 行） |
| 縮圖 | ➖ 本功能未設計縮圖 | 以 `<video controls>` 預覽；但「已處理 N 秒」取自 `processed_metadata`（ffprobe 產出），同不可用 |
| 格式／時長／尺寸／幀率驗證 | ❌ 不可用 | 需 ffprobe；現僅副檔名＋MIME 預檢生效 |

連帶影響：`test_growth_video.py` 兩個測試類別標註 `@unittest.skipUnless(FFMPEG and FFPROBE)` → **本機從未執行過影片 happy path**（先前 learning 843 pass／26 skip 即含此跳過），不得因「照片流程通過」推斷影片流程正常。

## D. DEMO 隔離完整流程驗證（21/21 PASS）

方法：`demo/runtime/db/demo.sqlite3` 副本 + 隔離服務 127.0.0.1:8131 + 隔離 MEDIA_ROOT（`.test-temp/r01-check/`），DEMO 測試帳號（密碼經 `demo_credentials.py` 安全載入，未落腳本）。**原始 DEMO 資料庫 sha256 前後一致（cbc27708…），教師 18:47 資料未被動過。**

| # | 驗證項 | 結果 |
|---|---|---|
| A/B | 學員登入、R01 頁面開啟，初始「未開始」、伺服器端無影片 | PASS |
| C | **含影片保存草稿**：200 重渲染並出現「伺服器尚未安裝影片處理工具」；狀態仍 `not_started`；零影片 Evidence（完整重現教師情境） | PASS |
| D/E | 純文字草稿保存：狀態→`in_progress`（🟡 進行中）；重整後仍無已保存影片（證實所見影片為前端預覽） | PASS |
| F | 照片草稿：1 張 image Evidence 入庫；提交教師複核：狀態→`submitted` | PASS |
| G | 教師後台學員詳情頁可見 R01「待教師複核」 | PASS |
| H | 教師審核合格 88 分：`GrowthRecordReview` 建立、狀態→`approved`、分數入帳 | PASS |
| I | 學員端顯示「✅ 已完成」＋教師評語 | PASS |
| J | 全流程零影片 Evidence（影片功能未受影響） | PASS |

腳本留存：`.test-temp/r01-check/r01_isolated_check.py`（隔離服務已停止）。

## E. 完整資料流程（表／欄位／API／前端來源／更新時機）

1. **上傳**：`growth-upload.js` 暫存 blob → submit 時 `FormData` POST `…/growth/R01/`（`action=save_draft|submit_review`，XHR `X-Requested-With`，影片帶 `X-FDE-Video-Request-ID`）。
2. **保存**：`growth_record_detail` → `GrowthRecordForm` → `process_growth_video()`（ffmpeg/ffprobe → 副檔名/MIME → 大小 → 暫存 → 探測 → 轉碼 → 輸出驗證）。
3. **Evidence 關聯**：`learning_evidence`（`evidence_id` PK、`growth_submission_id`、`evidence_type='video'`、`upload=evidence/<uuid>/<hex>.mp4`、`original_metadata`/`processed_metadata`）；新影片存入前先刪舊影片（每項最多 1 段）。
4. **成長紀錄**：`learning_growthrecordsubmission`（`enrollment+definition` 唯一；`status`/`student_note`/`learning_summary`/`submitted_at`/`teacher_final_score`/`updated_at`）。
5. **草稿**：`save_draft` → `NOT_STARTED→IN_PROGRESS`（第 1042–1043 行）。
6. **提交教師**：`submit_review` → `SUBMITTED`＋`submitted_at=now`（需 ≥1 照片/影片/檔案）。
7. **學員進度顯示**：模板第 19 行 `status_label ← submission.status`（`project_directions.py::student_status_label`）；成長日誌同源；無快取。
8. **教師審核**：`POST /teacher/growth-reviews/<id>/`（限 `SUBMITTED`）→ `learning_growthrecordreview`＋`submission.status=review_status`、`teacher_final_score=score` → 學員端即時反映。

## F. 最小修復方案與差異清單（**待教師核准，尚未動碼**）

**方案一（治本，免改碼）——提供 FFmpeg 二進位：**
- (a) 專案內建（建議）：下載 static build 解壓至 `D:\FDE-AI-UAS-v2.0\tools\ffmpeg\bin\`，僅於 DEMO/正式服務環境設定 `DJANGO_FFMPEG_BINARY`／`DJANGO_FFPROBE_BINARY` 絕對路徑；重啟 DEMO 8110 生效（正式服務 8022 不動）。不動系統 PATH。
- (b) `winget install Gyan.FFmpeg`：動系統環境，影響面較大。
- 安裝後必須：重跑 `test_growth_video.py`（現 100% skip，應轉為全數執行）與隔離腳本影片路徑，才可宣稱影片處理正常。

**方案二（體驗改善，需改受保護 `views.py`，約 5 行）：**
- 現狀：影片處理失敗會連帶阻斷草稿保存（教師遭遇）。
- 提案：`growth_record_detail` 第 1010–1034 行，`action == "save_draft"` 時的 `VideoProcessingError` 改為 `messages.warning(…)`（「影片未保存：…（影片仍在待提交清單）」）且不 `add_error`，使草稿（狀態→進行中、備註）照常保存；`submit_review` 維持阻斷。
- 風險：低（不動資料模型與審核規則）；需回歸 `GrowthVideoViewTests`。

建議：方案一為**必要**（影片功能目前 100% 不可用）；方案二可選。兩案均待教師明確核准。

## G. 安全限制遵循

未 commit／部署／migration；未動正式資料庫（sha256 驗證）；未重啟或變更正式服務（8022／8770 未碰；DEMO 8110／8111 原狀；隔離服務 8131 已停止）；未清除或覆蓋教師驗收資料；未修改受保護程式；報告與測試中不含任何密碼。
