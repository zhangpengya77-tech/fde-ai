# P3-H 第十五階段：提交前最終驗收報告

- 日期：2026-10-27
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- HEAD：`dfef115dc911e25ad0604ff3534bffbe968adc21`（未變動）
- 性質：**只驗收與修正 P3-H 隔離測試；未 Commit、未 Push、未 Deploy、未觸碰正式 8022。**
- 結論：**技術上具備 Commit 條件；依指令停止，等待教師批准後再執行。**

---

## ① Git 基線與 SHA-256

| 項目 | 值 |
|---|---|
| HEAD | `dfef115dc911e25ad0604ff3534bffbe968adc21` |
| 分支 | `codex/p3h-local-backend` |
| 最後遷移 | `0019_golden_set_manifest_contract.py`（無新增） |

未提交修改（與第十四階段結束一致，未被覆蓋）：

| 檔案 | SHA-256 | 狀態 |
|---|---|---|
| `student_portal/learning/models.py` | `16787518…e6b97` | M（第十三／十四階段） |
| `student_portal/learning/views.py` | `206b3b33…79a66` | M（第十四階段） |
| `student_portal/learning/tests/test_p3d_course_upload_closure.py` | `b719789f…9834e1` | M（第十三階段） |
| `student_portal/learning/tests/test_p3h_phase14_evidence_validation.py` | `5345ed96…5e6ecc` | ??（第十四階段新建；**本階段追加 1 條三層邊界測試**，原 `fd6adf1d…`） |

備份完整：`backups/20261027-phase14/`（models.py.before / views.py.before / test_p3d…before）、`backups/20261027-pdf-header/`（6 檔）。
未追蹤交付：`docs/reports/P3H_PHASE11…PHASE14*.md`、`docs/superpowers/plans/…`、`ops/p3h/verify_p3h_evidence_atomicity.py`。

> 未覆蓋第十三、十四階段任何已完成修改；三支被改檔案的 SHA-256 與上一階段記錄逐位相同。

---

## ② 五類 Evidence 寫入流程（驗證 → 暫存 → 媒體寫入 → DB 建立）

| # | 路徑 | 驗證時機 | 事務內順序 | 失敗殘留 |
|---|---|---|---|---|
| 1 | `EvidenceForm` / `evidence_add`（views.py 1714–1727） | `form.is_valid()` → `full_clean()`（欄位驗證器＋`clean()` 內 PDF 檔頭） | 驗證 → `evidence.save()`（媒體＋DB） | 標準 Django；驗證在前，無效檔不到磁盤 |
| 2 | 成長記錄圖片（1081→1134–1145） | `process_growth_image` → 記憶體 `.jpg` 位元組（不落盤） | 事務內 `validate_evidence_upload`(1136) → `upload.save`(1144) | 驗證先於寫入；失敗僅記憶體位元組，**無磁盤孤兒** |
| 3 | 成長記錄影片（1086→1146–1178） | `process_growth_video` → 系統臨時 MP4（`tempfile.mkstemp`，非 MEDIA_ROOT） | 事務內刪舊 → `validate`(1174) → `upload.save`(1175) | `finally`(1208) 清臨時檔；事後失敗走 `except`(1201) 清媒體＋DB，**無 MEDIA_ROOT 孤兒** |
| 4 | 成長記錄文件（1113–1119→1179–1200） | **事務前** `validate_evidence_upload`(1113)（FINDING-1 已修） | 事務內 `Evidence()` → `upload.save`(1199) | 事務前已驗證；事後失敗走 `except` 清理 |
| 5 | R05 模型 `.pt`（1297–1361） | 表單限 `.pt` → `validate_evidence_upload`(1307) 事務前 | 事務內 `upload.save`(1329) → 外部 Vision 呼叫 | `except`(1353) 刪孤兒媒體（外部呼叫失敗時） |

**結論：** 五條路徑均滿足「驗證 → 暫存 → 媒體寫入 → DB 建立」，且每條都有失敗清理安全網；無效／失敗上傳不會在 MEDIA_ROOT 留下未登記檔案。

---

## ③ 真實 HTTP 回歸（Entry 8142 → Gateway/Live 8141 → Django 8140）

隔離 CandidateRoot：`C:\Users\admin\AppData\Local\Temp\p3h-phase15-candidate`（獨立 `p3h.sqlite3` ＋ `media/`，未共用正式資料）。
三服務以 `ops/p3h/start-p3h-isolated.ps1` 啟動，`Wait-Process` 保活；`/api/live/health` 經 Entry 回 **200**，證實 Entry→Gateway→Live 鏈路連通。

### 3.1 `verify_p3h_evidence_atomicity.py`（15/15 PASS）
| 案例 | 結果 |
|---|---|
| E1 合法 PDF 接受、1:1 落盤、SHA 一致 | PASS（`sha_match=True`） |
| E1b 具物件結構 PDF 接受、SHA 一致 | PASS |
| E2 錯誤副檔名 `.exe` 拒絕、零殘留 | PASS |
| E3 超大檔（>100 MB）拒絕、零殘留 | PASS |
| E4 二進位改名 `.pdf` 拒絕（PE／ZIP／純文字／PNG 四種） | PASS（錯誤＝缺少 `%PDF-` 檔頭） |
| E5 零位元組 `.pdf` 拒絕、零殘留 | PASS |
| E6 路徑穿越檔名收斂於媒體根內 | PASS |
| E7 跨班級越權上傳拒絕（404） | PASS |
| E7b 沿用他人 CSRF token 拒絕（403） | PASS |
| E8 每筆 Evidence 有檔、無孤兒媒體 | PASS（rows=3 media=3 missing=0 orphans=0） |
| E9 拒絕類案例未污染進度狀態 | PASS（in_progress） |

### 3.2 `verify_p3h_business_http.py`（PASS）
`teacher=200`（擁有者教師可下載）、`cross_teacher=404`、`cross_student=404`、`forged=403`、`anonymous=302`；上傳 PDF `sha256=6658c888…4242e` 一致。

### 3.3 成長記錄文件真實 HTTP（本階段新增，3/3 PASS）
| 案例 | 結果 |
|---|---|
| G1 合法 PDF 經 R07 上傳接受、Evidence 建立、SHA 一致 | PASS（302, 1 evidence, 1 file, sha_match=True） |
| G2 改名二進位 `.pdf` 拒絕、零殘留 | PASS（200, 0 evidence, 0 file） |
| G3 非白名單 `.exe` 拒絕、零殘留 | PASS（200, 0 evidence, 0 file；回應為 R07 表單重繪＝驗證器攔截） |

**Task C 判定：** Evidence 上傳、成長記錄、教師下載、跨班拒絕、CSRF 拒絕、媒體 SHA-256 **全部以真實 HTTP 通過**，未使用 Django Test Client 代替。

---

## ④ 全量回歸統計

命令：`manage.py test learning --no-input`（隔離測試 DB `p3h_fullreg.db`）

```
Ran 1061 tests in 2371.568s
FAILED (failures=2, errors=1, skipped=26)
```

| 類別 | 數量 |
|---|---|
| 總計 | 1061 |
| 通過 | 1032 |
| 失敗（FAIL） | 2 |
| 錯誤（ERROR） | 1 |
| 跳過（skip） | 26 |
| **本階段／P3-H 新增回歸** | **0** |

三筆非通過項（全部為既有已知失敗，詳見 ⑦）：
1. ERROR `test_public_platform…test_anonymous_home_serves_existing_fde_ai_platform`（首頁導航 substring 找不到）
2. FAIL `test_auth…test_platform_hero_action_opens_student_growth_portal`（hero `label: '我的學習日誌'` 缺失）
3. FAIL `test_vision_flywheel_framework…test_teacher_sees_only_authorized_models_with_four_status_dimensions`（「訓練用途」欄位）

> **未宣稱全部通過**：存在 2 FAIL＋1 ERROR，均為既有且與 Evidence 改動無關。

---

## ⑤ Migration 檢查

```
$ manage.py makemigrations --check --dry-run
No changes detected
```

最後遷移仍為 `0019_golden_set_manifest_contract.py`；`test_p8_showcase_security` 與 `test_teacher_class_showcase` 的「禁止新增遷移」守門未被觸發（全量回歸中通過）。

---

## ⑥ DB／媒體殘留檢查（隔離 CandidateRoot）

| 指標 | 值 |
|---|---|
| Evidence 表欄位數 | 10（schema 未變） |
| Evidence 列數 | 6（皆有 upload） |
| 媒體檔案數 | 6 |
| 缺檔的 Evidence 列 | 0 |
| SHA-256 一致 | 6 / 6 |
| 孤兒媒體檔 | 0 |
| 既有紀錄快照 | Enrollments 5／Profiles 5／GrowthSubmissions 24／TaskProgress 6 |

`CONSISTENCY_PASS`。既有學習紀錄結構與數量正常，未被 Evidence 改動破壞。

---

## ⑦ 本階段新增回歸 vs 既有已知失敗

**本階段新增回歸（1 條，全綠）：**
- `test_p3h_phase14_evidence_validation.ValidateEvidenceUploadTests.test_validation_is_not_a_full_security_scan`
  明確區分「副檔名驗證」「PDF 檔頭驗證」與「完整安全掃描」：只驗 `%PDF-` 前 5 位元組，不解析 PDF 結構、不做防毒／深度掃描；`.txt` 內嵌 `%PDF-` 字串或 `.csv` 內含 MZ 標記均不被誤擋。模組現為 **13/13 PASS**。

**P3-H 既有測試（全綠）：** `test_p3h_phase14_evidence_validation` 13/13、`test_p3d_course_upload_closure.EvidencePdfHeaderValidatorTests` 3/3，於全量回歸中一併通過。

**既有已知失敗（3 筆，與本階段無關）：**
- 三支測試檔（`test_auth.py`、`test_public_platform.py`、`test_vision_flywheel_framework.py`）**均未被本階段修改**；
- 失敗原因皆為前端資產斷言（JS hero 標籤、HTML 導航順序、模板「訓練用途」欄），與 Evidence 驗證／models／views 無關；
- 與第十三、十四階段記錄的「3 既有已知失敗」逐項相同，非本階段引入。

**環境限制（26 skip）：** 依賴外部服務／環境條件的測試被跳過，非失敗。

**未執行：** 無（`learning` 全量已跑完）。

---

## ⑧ Commit 是否具備條件

**技術上具備。** 依據：
- 無新增遷移（`0019` 不變）；
- 全量回歸 0 新增回歸，3 筆非通過均為既有且無關；
- 真實 HTTP（Entry→Gateway→Django）Evidence／成長記錄／教師下載／跨班／CSRF／媒體 SHA 全綠；
- DB／媒體零殘留、零孤兒、SHA 全一致；
- 第十三／十四階段修改未被覆蓋。

**但依指令未執行 Commit／Push／Deploy**，等待教師批准。批准後建議一次提交：
`models.py`、`views.py`、`test_p3d_course_upload_closure.py`、`test_p3h_phase14_evidence_validation.py`（含本階段追加的三層邊界測試），以及 `docs/reports/P3H_PHASE1[1-5]*.md`、`ops/p3h/verify_p3h_evidence_atomicity.py`、`backups/`。

> 備註：8022 啟動器補丁僅完成設計（見第十四階段報告），**未寫回正式腳本**，仍待批准。

---

## ⑨ 8022 正式服務狀態（唯讀）

| 端口 | 狀態 | PID |
|---|---|---|
| 8022（v1.5C 正式 Django） | LISTENING | 觀察期內由 11376 → 25860（既有每 5 分鐘自重啟循環，非本階段造成） |
| 8770（RAG） | LISTENING | 14124 |
| 8030 | 未監聽 | — |
| 8140／8141／8142（隔離） | 已釋放 | — |

- `start_fde_v15c_classroom.ps1` 最後修改時間 `2026-10-11`，SHA-256 `a64330ef…7a7b59`，**未被本階段修改**。
- 未觸碰排程工作、Cloudflare Tunnel、DNS、GitHub Pages。
- 8022 的 PID 波動為既有「映像路徑比對所有權 → 誤殺自身子程序」自傷循環之表現；修復方案仍為待批准設計，本階段不執行。

---

## 隔離資源清理

- 隔離棧（8140/8141/8142）已以 `stop-p3h-isolated.ps1`（PID＋命令列＋建立時間三重比對）驗證後停止，端口全部釋放。
- 臨時測試腳本：`%TEMP%\p3h-phase15-growthcheck.py`、`%TEMP%\p3h-phase15-consistency.py`、`%TEMP%\p3h-phase15-start.ps1`（均在系統臨時目錄，未進 repo）。
- 清理本階段臨時 DB 檔 `student_portal/p3h_migcheck.db`（0 位元組）。

---

## 結論

P3-H 第十三、十四階段的 Evidence 修復在第十五階段最終驗收中**通過**：五類寫入路徑順序正確且無殘留、三層格式驗證界線清晰、真實 HTTP 全鏈路全綠、全量回歸零新增、無遷移變更、DB／媒體一致、8022 未受影響。**已具備 Commit 條件，依指令停止等待批准。**
