# FDE-AI-UAS 2.0｜提交前檢查與 Staging 計畫報告（待教師核准後才 commit）

日期：2026-10-14 13:10
執行者：WorkBuddy
依據：教師《Git 版本保護與 R4/R5/R8 安全收尾》第一節
性質：**提交前檢查與 staging 計畫；本輪未執行 git add／commit／push／merge／deploy**

---

## 一、Migration 0016–0019 依賴順序與資料庫狀態

### 1.1 依賴鏈（逐檔讀取 `dependencies`，線性無分叉）

```
0015_studentsurvey_survey_version_and_more
  └─ 0016_visionmodelrecord
       └─ 0017_visionmodelrecord_snapshot_and_integrity
            └─ 0018_golden_set_center（+ swappable AUTH_USER_MODEL）
                 └─ 0019_golden_set_manifest_contract
```

### 1.2 正式資料庫（`student_portal/db.sqlite3`，唯讀副本檢查）

| 檢查 | 指令（對**隔離副本** `.test-temp/precommit-check/prod-copy.sqlite3`） | 結果 |
|---|---|---|
| 副本忠實度 | sha256 比對 | 副本＝原始（`1fa462fe…c133`）；檢查前後原始檔 sha256 **不變**（未動正式庫） |
| 已套用狀態 | `showmigrations learning` | 已套用至 **0015**；0016–0019 為 `[ ]` 未套用 |
| 一致性檢查 | `migrate --check` | **exit 1**＝偵測到未套用遷移（預期行為；正式庫較磁碟碼落後 4 版） |
| 套用計畫 | `migrate --plan`（唯讀） | exit 0，計畫依序 0016→0017→0018→0019，無衝突、無多葉節點 |
| 模型↔遷移同步 | `makemigrations --check --dry-run` | **No changes detected**（模型與遷移一致，無缺漏遷移） |

### 1.3 DEMO 資料庫（`demo/runtime/db/demo.sqlite3`，唯讀副本檢查）

| 檢查 | 結果 |
|---|---|
| `showmigrations learning` | 已套用至 **0019**（DEMO 服務運行中自然套用） |
| `migrate --check` | **exit 0**（完全一致） |

**結論**：4 個遷移檔語法正確、依賴線性、與模型同步；正式庫落後 4 版屬**已知狀態**（正式庫自 0015 後未遷移，本輪與歷史皆未對其 migrate）。**部署 SOP 的 D2 階段（migrate）屆時須先備份再執行——本輪不做。**

---

## 二、逐批 Staging 計畫（`git add --dry-run` 驗證，未實際 add）

完整精確路徑（356 檔，逐檔列出）：**`docs/reports/STAGING_FILE_LIST_2026-10-14.txt`**（`M `＝修改、`??`＝未追蹤、`XX`＝排除）。

| 批次 | 檔數 | dry-run 預定 staged 行數 | 修改檔 diff 摘要 | >2MB／敏感／缺漏 |
|---|---|---|---|---|
| 1 Migrations | 4 | 4 ✓ | — | 無 |
| 2 後端（live_backend/app、live_backend/tools、student_portal/learning 非測試、settings.py、.env.example、.gitignore） | 69 | 69 ✓ | 23 files, +5051/−90 | 無 |
| 3 前端（src、live/live.*、live/index.html、downloads 非測試、index.html、404.html、bat） | 15 | 15 ✓ | 10 files, +1382/−154 | 無 |
| 4 測試（*.test.cjs、learning/tests、live_backend/tests、student_portal/tests、validation_sets、p9 baselines） | 77 | 77 ✓ | 10 files, +434/−43 | 無 |
| 5 DEMO 工具與文件（demo/tools、demo/*.cmd/md、seed 腳本） | 94 | 94 ✓ | 1 file, +17/−3（.gitignore 之外：docs/verification 歸類見批次 6） | 無 |
| 6 專案文件（docs/**、根目錄 *.md、add_firewall_rules.ps1） | 93 | 93 ✓ | — | 無 |
| 7 Flight Health 保護模組前端（4 檔） | 4 | 4 ✓ | — | 無 |
| **合計** | **356** | 356 ✓ | 44 修改檔全數覆蓋 | **全批次 0 筆超限** |

> dry-run staged 行數與檔數逐批相符 → 以**精確檔案清單**（非 `add -A`／`add .`）執行時，staging 範圍完全受控，不會誤入排除項。

### 排除清單（5 項，dry-run 亦不含）

| 檔案 | 理由 |
|---|---|
| `student_portal/learning/external_modules.py.i5-prebak` | 手動備份殘留 |
| `demo/runtime/media_i4/evidence/…/253448c5….jpg` | DEMO 執行期證據媒體 |
| `demo/runtime/media_i4/evidence/…/5b4bdb6a….jpg` | 同上 |
| `.workbuddy-ai/memory/2026-10-08.md` | 代理工作區記憶（非專案交付物） |
| `.workbuddy-ai/memory/2026-10-10.md` | 同上 |

---

## 三、敏感資料／測試媒體／憑證／大型模型逐檔確認

| 掃描項 | 方法 | 結果 |
|---|---|---|
| 憑證／金鑰 | 副檔名 `.env`/`.key`/`.pem`/`*password*`/`*帳密*` + 內容掃描 | 0 筆進版（`.gitignore` 規則＋本輪白名單雙重把關）；`demo/DEMO_SHARED_PASSWORD_REPORT_2026-10-10.md` 逐行確認無明文密碼 |
| 測試媒體 | 掃描 `.jpg/.png/.mp4` 等 | 僅 `validation_sets/prop`（PROP 視覺基準圖 1 張＋標註，屬測試資產，**有意願提交**）與 2 張 DEMO 執行期媒體（**已排除**） |
| 大型模型 | 副檔名 `.pt/.pth/.onnx`，檔案 >2MB | 0 筆 |
| 資料庫 | `*.sqlite3` | 0 筆（正式庫與 DEMO 庫皆在忽略規則內） |
| 大型檔 | 全部 356 檔逐一取 size | 0 筆 >2MB |

---

## 四、備份可恢復性確認

| 備份 | 驗證 | 結果 |
|---|---|---|
| `20261014-1025-workbuddy-takeover`（6,856 檔） | ①44 個修改檔逐一 SHA256＝磁碟 ②還原演練：抽 6 檔（external_modules.py、settings.py、main.py、app.js、I5_Report.md、.gitignore）實際複製回讀並比對 | ①**44/44 一致** ②**6/6 一致** |
| `20261014-1245-workbuddy-final-deliverables` | `sha256sum -c SHA256SUMS.txt` | 6 個載荷檔全 OK（manifest 自我參照行不符為產生方式偽影，非資料問題） |
| `20261014-1300-workbuddy-closeout-docs` | 同上 | 3 個載荷檔全 OK（同上偽影說明） |

**臨時產物清理**：`.test-temp/precommit-check`（DB 副本）、`.test-temp/restore-drill`（演練檔）已刪除；正式庫與 DEMO 庫 sha256 複核不變。

---

## 五、iPhone 驗收入口實測（供教師直接使用）

`192.168.1.114` 經 netstat（8110／8111 綁定於此 IP）與實際 HTTP 探測雙重確認**仍為目前可連線區網 IP**；DEMO 8110／8111 **維持運行、未重啟、未更動**；正式服務 8022／8770 未觸碰。九個預備網址探測：

| 網址 | 狀態 | 說明 |
|---|---|---|
| `http://192.168.1.114:8111/` | 200 | 首頁（統一入口） |
| `http://192.168.1.114:8111/login/` | 200 | 登入 |
| `http://192.168.1.114:8111/student/learning-path/` | 302→登入 | 未登入正確引導（登入後 200） |
| `http://192.168.1.114:8111/platform/f450` | 200 | F450 十二任務 |
| `http://192.168.1.114:8111/live/` | 200 | AI Live Coach |
| `http://192.168.1.114:8111/student/growth/` | 302→登入 | 同上 |
| `http://192.168.1.114:8111/teacher/login/` | 200 | 教師登入 |
| `http://192.168.1.114:8111/flight-health/` | 200 | 飛行健康前端（後端 :8040 **未啟動**→ 顯示離線橫幅，屬預期） |
| `http://192.168.1.114:8111/downloads/` | 200 | 下載中心 |

完整七站網址清單（含未啟動服務標示）另見 **`docs/delivery/18-IPHONE-7-STATION-URLS.md`**。

---

## 六、待教師核准事項

1. **staging 範圍**：356 檔全收，或選擇性批次（建議至少先收批次 1＋2，解除部署阻塞項）。
2. **批次 7（Flight Health 4 檔）**：是否將保護模組前端首次納入版本控制（提交≠修改，但涉及保護清單，需明示）。
3. **提交訊息策略**：建議每批一則 commit（批次號＋範圍＋基準測試結果），由教師核定後才執行 `git add <精確清單>` 與 commit。
4. 核准後才進入第二至四節的 R4／R5／R8 實作（見 `docs/reports/R4_R5_R8_FINAL_IMPLEMENTATION_PLAN_2026-10-14.md`）。

**狀態維持**：`FDE_2_0_DEV_COMPLETE`（開發面）／`MANUAL_ACCEPTANCE_PENDING`／`PRODUCTION_RELEASE_PENDING`。
**本輪未執行**：git add／commit／push／merge／deploy、migrate（正式庫）、重啟或變更任何服務。
