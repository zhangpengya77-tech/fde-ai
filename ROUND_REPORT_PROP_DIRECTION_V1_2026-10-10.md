# FDE-AI-UAS 2.0｜PROP_DIRECTION_V1 本輪收口報告

**日期**：2026-10-10
**授權**：教師「有條件開發授權」（八項條件）
**範圍**：僅修改 `D:\FDE-AI-UAS-v2.0`

---

## 一、總結判定

| 項目 | 判定 |
|---|---|
| 一、學員手機端靜態圖片辨識頁 | **PASS**（AUTOMATED PASS） |
| 二、教師圖片測試頁 | **PASS**（AUTOMATED PASS） |
| 三、學員 `.pt` 隔離執行 | **BLOCKED**（本機無可靠隔離環境，維持不批准） |
| 四、四類模型狀態 | **WAITING_FOR_MODEL**（磁碟無合格模型） |
| 五、AI 解釋（無 RAG） | **PASS**（規則式繁中，未呼叫 LLM 編造） |
| 六、環境限制遵守 | **PASS**（正式環境全部未受影響） |
| 七、DEMO 8110／8111 重啟 | **PASS**（僅重啟 DEMO，正式未動） |
| 八、9 項驗收 | **PASS 11／11**（DEMO 實測） |

**人工 iPhone 實機驗收：PENDING**

---

## 二、條件一：學員手機端靜態圖片辨識頁

### 新增檔案
| 檔案 | 用途 |
|---|---|
| `student_portal\learning\prop_scan.py` | 純規則／狀態模組（不載入 `.pt`、不推論） |
| `student_portal\learning\templates\learning\student_prop_scan.html` | 手機端頁面 |
| `student_portal\tests\test_student_prop_scan.py` | 13 項單元測試（純模組） |
| `student_portal\learning\tests\test_student_prop_scan_page.py` | 11 項 HTTP 測試 |

### 修改檔案
| 檔案 | 變更 |
|---|---|
| `student_portal\learning\views.py` | 新增 `_prop_scan_gate()`、`student_prop_scan()`、`_run_prop_inference()`；`import base64`；`import prop_scan`、`runner_state` |
| `student_portal\learning\urls.py` | 新增路由 `student/courses/<id>/prop-scan/` → `student_prop_scan` |
| `student_portal\learning\templates\learning\growth_record_detail.html` | R07 區塊新增「槳葉方向辨識（手機拍照檢測）」入口 |

### 功能對照（逐條回應授權要求）
| 要求 | 實作 | 驗證 |
|---|---|---|
| 支援手機上傳一張照片 | `<input type="file" name="photo" accept="image/*" capture="environment">` | DEMO `has_upload: true` |
| 支援選擇 M1／M2／M3／M4 | 四個 fieldset，`name="motor_M1".."motor_M4"` | DEMO `has_motor_options: true` |
| 保留圖片預覽 | `#preview-wrap` + `#preview`（`URL.createObjectURL`） | DEMO `has_preview: true` |
| 保留檢測框顯示區 | 「辨識框（BBOX / Class / Confidence）」區塊常駐 | DEMO `has_bbox_area: true` |
| 保留類別、可信度 | 同上表格欄位 | 同上 |
| 保留 PASS／NG／無法判定顯示區 | 「判定結果（PASS / NG / 無法判定）」區塊常駐 | DEMO `has_verdict_area: true` |
| 保留繁中 AI 解釋 | 「AI 解釋（繁體中文）」區塊；`build_explanation()` 規則組裝 | 單元測試 13／13 |
| 保留瀏覽器 TTS | `#tts-play`／`#tts-stop`／`#tts-note`（`speechSynthesis`） | DEMO `has_tts: true` |
| **不顯示假檢測框／假可信度／假 PASS** | 頁面明示「本頁不會顯示模擬的檢測框、可信度或 PASS 結果」；JS 只在 `state === 'READY'` 且為真實偵測時繪框 | DEMO `5b`：`no_fake_pass: true`、`no_fake_ng: true` |
| 不修改 F450 Live Coach／攝像頭／語音辨識 | 未觸碰 `live_backend` Live Coach、camera、voice 相關程式 | 全套測試通過 |

### 安全設計
- `_prop_scan_gate()`：`runner_state().available == False` → `BLOCKED`；`prop_scan.model_status().status != "READY"` → `WAITING_FOR_MODEL`。任一情況 `can_infer = False`。
- `_run_prop_inference()`：讀 `settings.PROP_SCAN_INFERENCE_URL`；未設定 → `PropScanBlocked("INFERENCE_NOT_CONFIGURED")`；有設定但未接入 → `PropScanBlocked("INFERENCE_NOT_INTEGRATED")`。**永不偽造結果**。
- 上傳限制：8 MB、`content-type` 需為 `image/`。

---

## 三、條件二：教師圖片測試頁

流程位置：**教師後台 → 學員 R07 → best.pt → 模型詳情 → 圖片測試**（頁面已明示此流程）。

### 修改檔案
| 檔案 | 變更 |
|---|---|
| `student_portal\learning\views.py` | `teacher_vision_model_verify` 改為計算 `gate_state`（`BLOCKED`／`WAITING_FOR_MODEL`／`READY`）、`gate_reason`、`gate_detail` |
| `student_portal\learning\templates\learning\teacher_vision_verify.html` | 重寫為圖片測試頁（執行環境狀態、模型資訊、圖片上傳區、BBOX 結果、PASS/NG/REVIEW 判定、測試歷史、尚未啟用功能） |
| `student_portal\learning\templates\learning\teacher_vision_model_detail.html` | 「圖片驗證」入口更名為「圖片測試」（對齊授權用語，說明圖片測試已於本輪實作） |
| `student_portal\learning\tests\test_teacher_vision_acceptance.py` | 新增 D2b／D2c 兩項防偽造測試；A2 斷言同步用語 |

### 狀態顯示
| 狀態 | 觸發條件 | 顯示 |
|---|---|---|
| `BLOCKED` | 無安全隔離 Runner | 「BLOCKED｜目前無法執行推論」＋原因＋啟用條件 |
| `WAITING_FOR_MODEL` | 有 Runner 但無合格模型 | 「WAITING_FOR_MODEL｜等待合格模型」＋原因＋下一步 |
| `READY` | Runner＋模型皆就緒 | 「可執行測試」（本輪不觸發） |

- 非 `READY` 時，檔案輸入與送出按鈕皆 `disabled aria-disabled="true"`。
- 頁面明示「**本頁不會載入學員 .pt，也不會產生任何模擬辨識結果**」。
- 後端 `teacher_vision_model_verify_run` 在無 Runner 時直接拒絕，不執行任何推論。

---

## 四、條件三：學員 `.pt` 隔離執行研究結論

### 已查核的本機能力
| 隔離機制 | 狀態 | 查核方式 |
|---|---|---|
| Hyper-V | **NOT PRESENT** | `Get-WindowsOptionalFeature` |
| Containers | **NOT PRESENT** | `Get-WindowsOptionalFeature` |
| Windows Sandbox（Container-DisposableClientVM） | **NOT PRESENT** | `Get-WindowsOptionalFeature` |
| VirtualMachinePlatform | **NOT PRESENT** | `Get-WindowsOptionalFeature` |
| WSL | **NOT PRESENT**（且 `wsl.exe` 在沙箱程式黑名單） | `Get-WindowsOptionalFeature` |
| AppContainer（`CreateAppContainerProfile`） | **NOT available** | pywin32 探測失敗 |
| Docker Desktop | 目錄存在，但 `com.docker.service = Stopped`，daemon pipe 不存在 | 服務查詢 |
| Windows 版本 | 11 家用版（Home），build 26200；`HypervisorPresent=True` | `Get-CimInstance Win32_OperatingSystem` |
| pywin32（`win32job`／`win32security`／`win32process`） | 可用（但不足以構成安全隔離） | 匯入測試 |

### 結論
Windows 11 **家用版**缺少 Hyper-V、Containers、Windows Sandbox、VirtualMachinePlatform 與 WSL；
Docker daemon 未執行且不可用；AppContainer profile 不支援。

因此 **本機不存在真正可靠的作業系統級／VM／容器隔離環境**。
依授權條件三，**不得**將 Python `socket`／`open` monkey patch、loopback 綁定、路徑白名單或普通子進程宣稱為安全隔離。

> **判定：BLOCKED。** 學員 `.pt` 的載入與執行維持 **不批准**。

### 未執行的事項（依授權）
- 未安裝 Docker／WSL2。
- 未變更 BIOS／虛擬化設定。
- 未載入或執行任何學員提交的 `.pt`。
- 未修改正式 Vision 8765。
- 未以官方通用 YOLO 模型冒充 F450 四類辨識結果。

---

## 五、條件四：四類模型狀態

**判定：WAITING_FOR_MODEL。**

磁碟上不存在符合 `CW_F／CCW_F／CW_B／CCW_B` 契約的真實模型：

| 檔案 | 實際類別 | 是否可用 |
|---|---|---|
| `F450-demo-3ep-best.pt` | 舊三類（`jiangyer`／`ccw`／`cw`） | 否 |
| `FDE-AI-YOLO.pre-v1.1*.pt` | 單類（`無人機`） | 否 |
| `yolov8n.pt`／`yolo11n.pt`／`yolo26n.pt` | COCO 80 類 | 否 |
| `D:\AI_Cache\temp\gs-full-media\evidence\*.pt` | 8–21 bytes 測試佔位檔 | 否 |

補充事實：
- `E:` 槽不存在（僅 C:、D:），`yolo_server.py::DEFAULT_MODEL` 指向的 `E:\...\best.pt` 遺失。
- Golden Set `validation_sets\prop\manifest.json`：`image_count: 0`、`frozen: false`、`review_status: BLOCKED_NO_REAL_SAMPLES`。

**未執行任何改名冒充行為。** `prop_scan.model_status()` 固定回傳 `WAITING_FOR_MODEL`，並附原因與下一步。

---

## 六、條件五：AI 解釋（本輪不用 RAG）

`prop_scan.build_explanation(motor_checks, status)`：

```python
{
    "source": "RULE_BASED_ZH_TW",
    "rag_used": False,
    "headline": ...,
    "details": [...],
    "safety_note": ...,
    "tts_text": ...,
}
```

- 文字只由 **已確認安裝規則**（M1 右前 CCW／F、M2 左後 CCW／F、M3 左前 CW／F、M4 右後 CW／F）與 **實際偵測值** 組合而成。
- `rag_used: False`；未接入 RAG（:8770）。
- **未取得真實辨識結果時不呼叫大模型**：`INSUFFICIENT_DATA` 一律走固定文案，不產生結論。LLM 解釋介面保留。
- TTS 使用瀏覽器原生 `speechSynthesis`，未修改 Live Coach 語音系統。

---

## 七、條件六／七：環境限制與 DEMO 重啟

### 環境限制
| 保護項 | 狀態 |
|---|---|
| 正式 v1.5C | 未觸碰 |
| 8022（Django 正式） | LISTENING，PID 未變 |
| 8030 | 未觸碰 |
| 8765（Vision 正式） | 未觸碰 |
| 8770（RAG 正式） | LISTENING，PID 4348 未變 |
| Cloudflare Worker／Tunnel | 未觸碰 |
| 正式資料庫 `student_portal\db.sqlite3` | mtime 維持 **2026-10-07T19:08:32**、大小 450,560 bytes、SHA256 `1fa462fe…`（未寫入） |
| 正式模型 | 未觸碰 |
| 既有 R07／下載中心／教師後台 | 全數保留並通過回歸測試 |
| 新分支／正式 migration／部署／正式設定 | 均未執行 |

### DEMO 重啟（8110／8111）
1. **重啟前備份**：`demo\backup\demo-baseline-20261010-074237.zip`（DEMO DB SHA256 `e82c1ec2…`）。
2. **歸屬確認**：8110 監聽者為 `python` / `manage.py runserver 127.0.0.1:8110 --noreload`；8111 為 `python -m uvicorn app.main:app`。
3. **安全停止**：逐一驗證 process name 為 `python`，僅停 DEMO PID；正式 PID 5440／4348 明確排除，全程未使用埠掃描式強制終止。
4. **重啟後**：8110／8111 由本次 DEMO 服務持有；正式 8022／8770 維持 LISTENING。

> 備註：環境 `ExecutionPolicy` 停用 `.ps1` 執行，`start_demo.ps1` 無法直接呼叫；已改用等同邏輯啟動（相同環境變數、相同指令、相同埠），未修改任何正式設定。

---

## 八、條件八：9 項驗收結果

DEMO 實測（`demo\tools\verify_prop_scan_acceptance.py`，經 :8111 反代 :8110）：

```
{"passed": 11, "total": 11}
```

| # | 驗收項 | 判定 | 證據 |
|---|---|---|---|
| 1 | 學員登入 | **PASS** | 200，landed `/student/` |
| 2 | 教師登入 | **PASS** | 200，landed `/teacher/` |
| 3 | R07 best.pt 上傳 | **PASS** | 302 → R07 頁顯示 `DEMO_TEST_ONLY_best.pt` 與「等待教師審核」 |
| 4 | 教師 R07 與模型詳情 | **PASS** | 模型清單 1 筆；詳情頁含「圖片測試」入口 |
| 5 | 學員手機圖片上傳及預覽 | **PASS** | `has_upload/has_preview/has_motor_options/has_tts/has_bbox_area/has_verdict_area` 全 true |
| 5b | 未取得模型時上傳 | **PASS** | `no_fake_pass: true`、`no_fake_ng: true`、`shows_blocked: true` |
| 6 | 教師測試頁面 | **PASS** | `state_blocked: true`、`button_disabled: true`、`declares_no_fake: true` |
| 7 | 六個下載檔案 | **PASS** | 6 檔：DJI_WIN_Driver_Installer.exe／NAZAM_2.20_Installer.exe／FDE-AI-YOLO-學員安裝包-v1.1.exe／HQGC_Student_Setup.exe／MissionPlanner-1.3.83.msi／Git_Installer.exe |
| 8 | 未取得模型時正確顯示 BLOCKED | **PASS** | 學員頁與教師頁皆顯示 BLOCKED，按鈕停用，無模擬結果 |
| 9 | 正式 1.5C 未受影響 | **PASS** | 正式 DB mtime 維持 2026-10-07T19:08:32；8022／8770 LISTENING |

### 自動化測試
- 專項：`tests.test_student_prop_scan`（13）＋`learning.tests.test_student_prop_scan_page`（11）＋`test_vision_flywheel_framework`＋`test_teacher_vision_acceptance` → **64／64 OK**
- 完整套件 `manage.py test learning tests` → **Ran 602 tests**，`FAILED (failures=1, skipped=26)`

#### 唯一失敗：既有問題，非本輪引入
```
FAIL: learning.tests.test_auth.StudentRegistrationTests
      .test_platform_hero_action_opens_student_growth_portal
AssertionError: "label: '我的學習日誌'" not found in ...
```
- 斷言期望 `label: '我的學習日誌'`，`src/app.js` 實際為 `label: '我的成長日誌'`。
- **佐證**：`test_auth.py` mtime = **2026-09-28**（遠早於本輪）；本輪未修改 `app.js`，亦未修改 `test_auth.py`。
- 該失敗已記錄於 2026-10-08 工作日誌「已知既有失敗（非本輪引入，勿誤判）」。
- 單獨重跑 `manage.py test learning.tests.test_auth` → 21 tests，同樣僅此 1 failure，可穩定重現。

**判定層級：AUTOMATED PASS。**
**人工 iPhone 實機驗收：PENDING。**

---

## 九、仍待處理（本輪不開發）

| 項目 | 狀態 | 解除條件 |
|---|---|---|
| 學員 `.pt` 隔離推論 | **BLOCKED** | 需具備作業系統級沙箱或容器隔離環境（或獨立 VM） |
| 四類模型 | **WAITING_FOR_MODEL** | 需以 `CW_F／CCW_F／CW_B／CCW_B` 契約訓練的真實 `best.pt` |
| Golden Set | **BLOCKED_NO_REAL_SAMPLES** | 需教師上傳並確認真實樣本 |
| 教師圖片測試實際執行 | 未啟用 | 需同時滿足上列隔離環境與合格模型 |
| ACTIVE 發布 | 未啟用 | 需通過 Golden Test 且由教師明確操作 |

---

## 十、停止聲明

依授權條件八：**已完成本輪驗收，停止開發。**

未擴充 `FOUR_SIDE_HOVER`，未重構 Vision Center。
