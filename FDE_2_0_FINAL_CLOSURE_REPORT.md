# FDE_2_0_FINAL_CLOSURE_REPORT.md

> 專案：`D:\FDE-AI-UAS-v2.0` ｜ 產出時間：2026-10-10
> 範圍：F450 `PROP_DIRECTION_V1` 槳葉視覺辨識教學閉環 ＋ 學員手機端／教師電腦端／下載中心驗收
> 環境：**DEMO 隔離環境**（Django `:8110`、Live Backend `:8111`、DB `demo\runtime\db\demo.sqlite3`）

---

## 〇、本輪修改清單（最小修改）

| 檔案 | 修改內容 |
|------|---------|
| `demo\tools\demo_common.ps1` | `Set-DemoEnvironment`：`FDE_DOWNLOAD_ROOT` 改指向正式下載來源 `D:\下載中心文件`（含 fallback）；`DJANGO_VISION_SUBMISSION_API_BASE_URL` 改指向 DEMO Live `:8111` |
| `demo\tools\demo_env.cmd` | 同上兩項（cmd 版本同步） |
| `demo\tools\verify_r07_flow.py` | 新增：R07 學員提交完整流程驗收腳本 |
| `demo\tools\acceptance_auth.py` | 前輪新增：五項功能驗收腳本 |

**未修改任何正式程式碼、未新增分支、未跑 migration、未 commit/push/deploy。**

---

## 一、逐項驗收結果

### 1. 學員登入 — **PASS**
- 證據：`demo/tools/acceptance_auth.py` → `STUDENT_LOGIN PASS`，POST 200 → 落地 `/student/`，取得 `sessionid`；`verify_browser_flow.py` 含 CSRF＋登出再登入亦 PASS。
- 環境：DEMO Django `:8110`（經 Live `:8111` 反代），DEMO DB。
- 備註：本輪先修復前一輪發現的帳號 username 損壞問題（`fix_demo_accounts.py`），並以 Django 正規雜湊重設密碼。

### 2. 教師登入 — **PASS**
- 證據：`TEACHER_LOGIN PASS`，`/teacher/login/` POST 200 → 落地 `/teacher/`，`sessionid` 已發。
- 環境：同上。

### 3. 手機端 R07 — **PENDING**
- 現況：R07 頁面（`/student/courses/1/growth/R07/`）HTTP 200、含上傳表單；`base.html` 有 `viewport`、主要 CSS 含 `@media` 響應式規則。
- **未執行真實 iPhone Safari / Android Chrome 實機測試** → 依規則標示 **PENDING**，不以桌面模擬冒充。
- 環境：DEMO。

### 4. best.pt 上傳與持久化 — **PASS**
- 證據：`demo/tools/verify_r07_flow.py` → `R07_UPLOAD PASS`（提交後顯示「已提交／等待教師審核」）、`R07_PERSISTENCE PASS`（重新載入仍在）、`R07_RELOGIN_PERSISTENCE PASS`（登出再登入仍可見）。
- 儲存驗證：`demo\runtime\vision-center\submissions\prop_direction\<sub-id>\submission.pt` 實際落地，**SHA256 與紀錄完全一致**（`file_hash` = 檔案實算值）。
- 安全：上傳檔為 **DEMO_TEST_ONLY 佔位檔**（內容明確標示非真實權重）；`create_submission` 僅 `write_bytes` 存檔，**不載入、不推論**（原始碼註解：*Student model submission (inert attachment, never executed)*）。
- 環境：DEMO DB ＋ DEMO Vision Center（`demo\runtime\vision-center`）。

### 5. 教師 R07 審核 — **PASS**
- 證據：教師可開啟 `/teacher/vision-models/`（200）、`/teacher/enrollments/1/`（200），並可看到該學員的 `best.pt` 提交（`found=True`）。
- 環境：DEMO。

### 6. 模型倉庫 — **PASS**
- 證據：`/teacher/vision-flywheel/` HTTP 200；模型清單／詳情／完整性檢查路由存在（`teacher_vision_model_list` / `_detail` / `_integrity_check`）。
- 環境：DEMO。

### 7. 教師圖片測試 — **BLOCKED**
- 原因：真實推論服務 `:8765` 未啟動（本輪禁止啟動正式 Vision），DEMO 無安全推論沙箱可用；不得以假結果冒充。
- 環境：DEMO。**保持封鎖，待真實推論環境就緒。**

### 8. 學員圖片辨識 — **BLOCKED**
- 原因：學員端**目前僅有 R07 模型上傳**，尚無「靜態圖片辨識」前端頁面；且真實 YOLO 推論環境（`:8765`）未就緒。
- 依指示「若真實推論環境尚未具備，明確標示 BLOCKED」，本輪**不新增前端**（避免擴大 Scope 與假 PASS／NG）。
- 環境：DEMO。

### 9. PASS／NG 規則 — **PASS（規則引擎已存在且與規格一致）**
- 標籤：`CW_F / CCW_F / CW_B / CCW_B`（`PROP_CLASSES`，與指示完全一致，未改名）。
- 馬達位置：**M1 右前、M2 左後、M3 左前、M4 右後**（`vision_rule_templates.py` 與 `evaluate_prop` 一致）。
- 對照表（`evaluate_prop`）：M1→`CCW_F`、M2→`CCW_F`、M3→`CW_F`、M4→`CW_F`。
- 結果狀態：`PASS / NG / INSUFFICIENT_DATA`，NG 具細分原因碼（`ROTATION_WRONG`、`FACE_WRONG`、`ROTATION_AND_FACE_WRONG`、`LOW_CONFIDENCE`、`MISSING_TARGET`、`DUPLICATE_DETECTION`）。
- 判定：規則**已定義且已有已確認對照表**，非自行猜測；惟因推論不可用，**端到端實測 BLOCKED**。

### 10. AI 解釋及語音 — **BLOCKED**
- 原因：依賴第 8／9 項的真實辨識結果才成立；推論未就緒，故不產生解釋與語音（不以假結果觸發 TTS）。既有瀏覽器 TTS 能力未被修改。

### 11. ACTIVE 啟用 — **BLOCKED（安全封鎖，符合預期）**
- 證據：`vision_center.activate_model` 要求 `validation_status == "VALIDATED"`，否則拋 `validated_model_required`。
- 現況：無模型通過 Golden Test 真實評估 → **ACTIVE 依設計保持封鎖**，未偽造 VALIDATED／ACTIVE／分數。

### 12. 六個下載軟體 — **PASS**
- **根因**：DEMO 環境變數 `FDE_DOWNLOAD_ROOT` 指向 `demo\runtime\downloads`（僅 2 個佔位檔），未指向正式下載來源。
- **原檔位置**：`D:\下載中心文件\download_manifest.json`（正式清單，6 項全數核對）：

| # | 檔名 | 大小 | SHA256 核對 |
|---|------|------|-------------|
| 1 | `DJI_WIN_Driver_Installer.exe` | 1,026,400 | ✅ |
| 2 | `NAZAM_2.20_Installer.exe` | 11,340,607 | ✅ |
| 3 | `FDE-AI-YOLO-學員安裝包-v1.1.exe` | 66,072,006 | ✅ |
| 4 | `HQGC_Student_Setup.exe` | 178,323,041 | ✅ |
| 5 | `MissionPlanner-1.3.83.msi` | 119,841,133 | ✅ |
| 6 | `Git_Installer.exe` | 66,763,664 | ✅ |

- **修復**：DEMO `FDE_DOWNLOAD_ROOT` → `D:\下載中心文件`（唯讀引用，含 fallback）。
- **驗證**：`/api/downloads` 回傳 **6 筆**（原為 2 筆）；實際下載 HTTP 200、串流、**SHA256 與 manifest 一致**；Range 請求回 **206**（支援續傳）。
- 六個檔案皆為真實原檔（非造假的 6 個空檔、非以 2 個 YOLO 模型替代）。
- 手機端下載提示：頁面含 `install_note`（「僅支援 Windows…」）；實機提示 **PENDING**。

### 13. 正式 1.5C 未受影響 — **PASS**
- 正式 DB `student_portal\db.sqlite3`：mtime **2026-10-07 19:08**（本輪未觸碰）。
- 正式服務 `:8022`（Django）、`:8770`（RAG）：全程 LISTENING、未停止／未重啟／未遷移。
- `:8030`、`:8765`：全程 CLOSED（本輪未啟動）。
- `D:\FDE-AI-UAS\v1.5C`：存在、未修改。
- 未動正式 Cloudflare Gateway／Tunnel、未改正式 F450 AI 助手／Live Coach 攝像頭／語音辨識架構。

---

## 二、總結

| 項目 | 結果 |
|------|------|
| 1 學員登入 | **PASS** |
| 2 教師登入 | **PASS** |
| 3 手機端 R07 | **PENDING**（未實機測試） |
| 4 best.pt 上傳與持久化 | **PASS** |
| 5 教師 R07 審核 | **PASS** |
| 6 模型倉庫 | **PASS** |
| 7 教師圖片測試 | **BLOCKED**（無安全推論環境） |
| 8 學員圖片辨識 | **BLOCKED**（前端未建置＋無推論環境） |
| 9 PASS／NG 規則 | **PASS**（規則與對照表齊備；端到端實測 BLOCKED） |
| 10 AI 解釋及語音 | **BLOCKED**（依賴辨識結果） |
| 11 ACTIVE 啟用 | **BLOCKED**（安全封鎖，符合預期） |
| 12 六個下載軟體 | **PASS** |
| 13 正式 1.5C 未受影響 | **PASS** |

**結論**：教學閉環的「帳號 → R07 提交 → 持久化 → 教師審核 → 倉庫 → 下載」段落全部可驗收；
「真實視覺推論 → 辨識 → PASS/NG → AI 解釋 → 語音 → ACTIVE」段落因**缺少安全推論環境**，
依指示保持 **BLOCKED**，未以任何假結果冒充。

---

## 三、需要批准的下一步（本輪已停止，未執行）

以下動作涉及受保護服務或不可信 `.pt`，**須先取得批准**：

1. 啟動／連接真實 YOLO 推論環境（正式 `:8765` 或獨立安全沙箱），以開通第 7～11 項。
2. 於該環境載入學生模型 `.pt` 進行推論（安全隔離、非 Django/Live 直接載入）。
3. 建置學員端「靜態圖片辨識」前端頁面（新功能，需明確 Scope 授權）。
4. 以 Golden Test 真實評估模型後，才可能切換 ACTIVE。

---

## 四、Git Status

未執行 commit / push / merge / deploy。工作區僅有上述 DEMO 工具與環境設定之最小修改，正式分支與正式服務未變更。
