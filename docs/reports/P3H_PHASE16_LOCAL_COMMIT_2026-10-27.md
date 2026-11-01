# P3-H 第十六階段：Evidence 安全修復本機 Commit

- 日期：2026-10-27
- 工作樹：`D:\FDE-AI-UAS-v2.0-p3h-local-backend`
- 分支：`codex/p3h-local-backend`
- 授權範圍：**僅本機 Commit；未 Push／未 Merge／未 Rebase／未 Deploy。**
- 基線 HEAD（提交前）：`dfef115dc911e25ad0604ff3534bffbe968adc21`（符合預期）

---

## 1. Commit SHA

```
2fd4f2421dc18df761db80e74e6c4f134448feaf
```

提交訊息：`fix(p3h): unify evidence upload validation and reject disguised PDFs`
父提交：`dfef115 feat(p3h): validate isolated business and gateway HTTP closure`（單一提交，直接疊加）

---

## 2. 實際提交檔案清單（4 檔，逐檔 Stage）

| 狀態 | 檔案 |
|---|---|
| M | `student_portal/learning/models.py` |
| M | `student_portal/learning/views.py` |
| M | `student_portal/learning/tests/test_p3d_course_upload_closure.py`（第十三階段 Evidence 測試） |
| A | `student_portal/learning/tests/test_p3h_phase14_evidence_validation.py`（第十四／十五階段驗收測試） |

**未提交（維持未追蹤）：** `backups/`、`docs/reports/P3H_PHASE11–15*.md`、`docs/superpowers/plans/…`、`ops/p3h/verify_p3h_evidence_atomicity.py`。
未使用 `git add .` 或 `git add -A`，全部逐檔 Stage。

---

## 3. Git Diff 統計

```
4 files changed, 384 insertions(+), 16 deletions(-)
 create mode 100644 student_portal/learning/tests/test_p3h_phase14_evidence_validation.py
```

| 檔案 | 變更 |
|---|---|
| models.py | +98 −2（常數、`validate_pdf_header`、`validate_evidence_upload`、`clean()` 掛鉤、欄位驗證器改用常數） |
| views.py | +33 −6（四條直建路徑接入統一驗證） |
| test_p3d_course_upload_closure.py | +46 −6（PDF 檔頭夾具＋`EvidencePdfHeaderValidatorTests`） |
| test_p3h_phase14_evidence_validation.py | +223（新增，13 項測試） |

---

## 4. 安全掃描結果

| 檢查 | 結果 |
|---|---|
| Secret／Token 掃描（4 檔） | 無真實憑證；命中皆為既有 `import secrets`、`PasswordReset*` 類名、測試 dummy `password="not-used"`，均非本次引入 |
| 二進位檢查 | 4 檔皆純文字、`null_bytes=0`、UTF-8 可解碼 |
| 測試資料檢查 | 無 `.db`／`.pt`／媒體檔；無 CandidateRoot SQLite／MEDIA_ROOT 內容 |
| `git diff --check` | 通過（無空白錯誤／衝突標記） |
| 衝突標記 | 無 |
| 檔案大小 | models 53,376 / views 253,109 / test_p3d 6,032 / test_p3h_phase14 11,555 bytes |

---

## 5. Migration 結果

```
$ manage.py makemigrations --check --dry-run
No changes detected
```

- 提交不含任何 `migrations/` 檔案（`NO_MIGRATION_FILES_IN_COMMIT`）。
- 最後遷移仍為 `0019_golden_set_manifest_contract.py`。

---

## 6. 測試證據（與提交內容一致）

提交前以**即將提交的同一份內容**重跑：

```
Ran 16 tests in 10.937s
OK
```
＝ `test_p3h_phase14_evidence_validation`（13）＋ `test_p3d_course_upload_closure.EvidencePdfHeaderValidatorTests`（3）。

第十五階段全量回歸（同一內容）：**1061 項，2 FAIL＋1 ERROR＋26 skip**，三筆非通過皆為既有已知失敗（test_auth hero、test_public_platform 導航、test_vision_flywheel「訓練用途」），與 Evidence 改動無關；本階段新增回歸 0。

---

## 7. 提交後 Git 狀態

```
## codex/p3h-local-backend
（僅剩未追蹤）?? backups/
?? docs/reports/P3H_PHASE11…PHASE15*.md
?? docs/superpowers/plans/2026-10-25-p3h-independent-local-backend.md
?? ops/p3h/verify_p3h_evidence_atomicity.py
```

- 無意外提交：commit 恰為 4 檔。
- 無新增 Migration。
- **未 Push**：分支無 upstream（`NO_UPSTREAM`），`origin` 仍為 fetch/push 位址但無任何推送。

---

## 8. 正式服務與候選埠位狀態（唯讀）

| 端口 | 狀態 | 說明 |
|---|---|---|
| 8022（v1.5C 正式） | LISTENING | PID 觀察期多次變動（11376→25860→27416），為既有每 5 分鐘自重啟循環，非本階段造成 |
| 8770（RAG） | LISTENING | PID 14124 |
| 8030 | 未監聽 | — |
| 8140／8141／8142（隔離候選） | 未監聽 | 第十五階段已停止並釋放 |

未修改：8022 啟動器 `start_fde_v15c_classroom.ps1`（lastwrite 2026-10-11）、Windows 排程、Cloudflare Tunnel、DNS、GitHub Pages；未啟用 H3 ACTIVE；未刪除其他工作樹資料。

---

## 結論

第十三／十四／十五階段已驗收的 Evidence 安全修復，已以**單一本機 Commit** `2fd4f24` 落地；提交範圍精確（4 檔）、無遷移、無 Secret、無二進位、測試證據一致、未 Push。**已停止，等待下一階段批准；不自動進入正式部署。**
