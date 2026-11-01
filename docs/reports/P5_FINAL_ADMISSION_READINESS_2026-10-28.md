# FDE-AI 2.0｜第五階段正式上線前最終准入驗收

日期：2026-10-28  
範圍：唯讀核查、隔離候選與 Runbook；**未部署、未推送、未合併、未修改正式服務。**

## 1. 現況快照

| 工作區 | Branch | HEAD | 未提交狀態 |
| --- | --- | --- | --- |
| v2.0 主工作區 | `feat/m02-simulator-entry` | `0648115` | 69 項，禁止直接發布 |
| P3-H 隔離候選 | `codex/p3h-local-backend` | `2fd4f24` | 既有候選/證據檔，未作產品修改 |
| P2 身分候選 | `codex/v20-live-auth-session` | `0648115` | 16 項未提交 |
| Gateway P1 候選 | `codex/gateway-live-auth-p1` | `0a4756a` | 3 項未提交 |
| v1.5C 正式受保護工作區 | `fde-flight-health-ui` | `c83e296` | 8 項既有修改，未碰觸 |
| GitHub Pages 發布分支 | `gh-pages` | `24b53ec` | 乾淨 |
| 靜態網站候選 | `codex/github-pages-public` | `a8113c8` | 乾淨 |

正式監聽快照：8022 與 8770 有本機 listener；本輪未停止、重啟或修改。8022 的排程工作存在、目前為 Ready，並以約五分鐘週期執行；因此其 PID 不可視為穩定部署證據。

## 2. 69 項主工作區變更分類

### A1｜第四階段核心程式（發布必需，但不可單獨取用）

| 檔案 | SHA-256 前 16 碼 | 用途 |
| --- | --- | --- |
| `live_backend/app/main.py` | `5DA44CBD810D99A4` | Live 健康狀態與代理整合 |
| `live_backend/app/vision_api.py` | `67C91DD6715B83DF` | Vision 教師端授權入口 |
| `student_portal/learning/views.py` | `AD1DBED6FAE9AF80` | Django 教師班級隔離與上傳流程 |
| `student_portal/learning/vision_submission.py` | `4B6556C5536AC7F2` | Django 到 Live 的伺服器端呼叫 |

**必要相依（不可遺漏）**：`live_backend/app/internal_auth.py`、`student_portal/learning/internal_auth.py`、`student_portal/learning/vision_preflight.py`。只發布上列四檔會造成匯入或安全功能不完整。

### A2｜靜態公開網站候選

| 項目 | 樹指紋/狀態 | 准入 |
| --- | --- | --- |
| `public-site/`（10 檔） | `4de57afa8475cadc` | 可作 GitHub Pages 唯一發布來源 |
| `.github/workflows/deploy-public-site.yml` | `.github/` 樹指紋 `daca9d8b611b9cef` | 僅發布 `public-site/`，避免把後端公開 |
| `site-public-entry/`（1 檔） | `6c5994508dde99bc` | 備用入口，未列入本次唯一發布來源 |

靜態頁已包含公開課程與離線文案：後台不可用時顯示「FDE-AI 教學系統目前離線」，不宣稱登入或上傳成功。GitHub Pages 工作樹 `gh-pages` 已含 `v2/` 靜態資源，惟本輪未確認外網實際網址或重新發布。

### A3｜Gateway／Worker／內部代理候選

| 來源 | 狀態 | 准入 |
| --- | --- | --- |
| Gateway P1：`.env.example`、`src/index.js`、`test/gateway.test.js` | 3 項未提交，另有 30 個路由測試名稱 | 必須先整合至乾淨候選包 |
| Django/Live `internal_auth.py` | 各一份，含簽章協定 | **安全阻斷，見第 3 節** |
| `ops/launch-20261028/`（1,394 檔） | 樹指紋 `fd27a88157ba48ae` | 多為隔離資料、證據與啟動素材；不可整包發布 |
| `demo/tools/static_entry_server.py` | `447D1A610A06AA77` | 僅開發/展示代理候選，不可直接當正式 Worker |

### A4｜測試、報告與證據

包含所有 `demo/runtime/`、`demo/tools/`、`docs/reports/`、`live/*test*`、`live_backend/tests/`、`live_backend/tools/`、`student_portal/learning/tests/`、`student_portal/_phase4_inspect.py`。這些檔案需保留供審核，但不進入公開 Pages 或正式執行期套件。

### A5｜先前階段或無關於本次發布的變更

`index.html`、`src/`、`live/`、`m02-simulator/`（1 檔，樹指紋 `1273a3bd08f51894`）、`site-r07m/`（22 檔，樹指紋 `9d09fd42474a5597`）、模型健康與映射設定、既有 Vision Center/Live Coach UI 變更，以及 `.gitignore`。這些不得因「同在工作區」而自動納入本次發布。

完整逐檔狀態與 SHA 摘要已在本次准入核查輸出中取得；目錄以遞迴 SHA-256 樹指紋列示，避免把 1,394 個隔離檔誤當作發布內容。

## 3. 安全代理最終核驗：BLOCKED

本輪重新執行隔離 Gateway 測試：`node --test test/gateway.test.js`，結果 **30/30 PASS**；公開靜態站 `public-site/assets/app.js` 的語法檢查亦通過。此結果只證明目前 Gateway 候選的既有閘門行為，**不消除以下簽章協定缺口**。

目前 `FDE_INTERNAL_SHARED_SECRET` 的 canonical 輸入只有：

```
METHOD + PATH + ROLE + SUBJECT_ID + TIMESTAMP
```

缺少下列發布必需保護：

1. Enrollment ID 與可信 Cohort scope 綁定。
2. 請求本文或其 SHA-256 綁定。
3. 明確 `iat`/`exp`（現為五分鐘時鐘容差）。
4. 唯一 `jti`/nonce 與重放快取。
5. 正式模式強制簽章；目前未設密鑰仍回到 `unsigned_legacy` 相容放行。

Gateway 候選同樣保留 `LIVE_ASSERTION_URL` 缺失時僅回傳已驗證 role 的相容分支。這個分支不得存在於正式模式。

### 最小隔離修復（需另行批准）

採用版本化短效簽章 envelope：`v, iss, aud, sub, role, enrollment_id, cohort_ids, method, canonical_path, body_sha256, iat, exp<=60, jti`。Django 從資料庫產生 claims；Gateway 不採信瀏覽器 `X-FDE-*`；Live 同時驗簽、驗 audience/期限/請求本文，並對 `jti+sub` 做原子 TTL 防重放。正式模式缺少任一密鑰或端點即 fail closed。

## 4. Django／Tunnel 安全候選：BLOCKED，已有隔離設計

P3-H 候選設定已具備 `DEBUG=False` 時 Secure session/CSRF cookie、SSL redirect 與受控 proxy header 的程式設計方向；但正式 8022 仍使用 v1.5C 程式與環境，尚未驗證實際 `DJANGO_DEBUG=False`、精確 `ALLOWED_HOSTS`、精確 `CSRF_TRUSTED_ORIGINS`、可信 proxy header 與無重導循環。

此外，Tunnel/Worker 實際拓撲及是否存在直達源站旁路，本輪未讀取機密且未取得可驗證設定，故為 **UNVERIFIED**。正式發布必須要求：只有 Gateway 可公開到達；Django/Live/RAG 僅 loopback 或私網；Gateway 清除外部 `X-FDE-*` 與 `X-Forwarded-*`。

## 5. 8022 與 Live 常駐准入：BLOCKED

8022 排程工作仍在運行，且正式啟動器有「stale 8022 listener」終止邏輯。歷史證據顯示，非預期 Python 搶佔 8022 時會被排程替換。故不得把 v2.0 程序放入 8022，亦不得與 v1.5C 搶埠。

正式候選順序（僅 Runbook，不執行）：

1. 備份 v1.5C、v2.0 候選、Registry 與設定摘要。
2. 先建立 v2.0 專用 loopback 埠與服務所有權清單；絕不使用 8022。
3. 注入同一組受管密鑰至 Django、Gateway、Live；不寫入 Git 或日誌。
4. 啟動 Django，驗證 HTTPS/proxy cookie 契約。
5. 啟動 Live，驗證 fail-closed 身分中介層。
6. 啟動 Gateway，驗證外部標頭剝除與離線安全降級。
7. 最後才建立受控 Tunnel/固定網域路由，並逐項人工驗收。
8. 停止順序反向；健康失敗只停止本次明確擁有的服務，不依埠號終止未知程序。

教師電腦關機時：GitHub Pages 的公開課程仍可用；登入、上傳、教師後台、YOLO、RAG、Live Coach 均必須顯示離線且不可寫入。

## 6. 最小發布包與回滾

| 發布項目 | 對 v1.5C 影響 | 回滾 |
| --- | --- | --- |
| GitHub Pages `public-site/` | 無 | 回復 Pages 發布 commit |
| Gateway 安全 Worker | 可能影響共用入口，需隔離預發布 | 還原 Worker 前一版本與路由 |
| v2.0 Django Vision proxy/班級隔離 | 不可覆蓋 8022 | 停止 v2.0 專用服務，還原候選檔 |
| Live 簽章驗證 | 必須與 Django 同步 | 同時回復兩端候選與環境設定 |
| Tunnel/DNS | 本輪未做 | 回復至上一個已知良好路由 |

每一步先做檔案 SHA-256 與設定名稱（不含值）備份；任何登入、簽章、來源健康檢查失敗即停止切換並回滾到前一個已知良好版本。

## 7. 教師人工驗收（預發布）

T1 外網開啟公開靜態網站。  
T2 由固定 HTTPS 教學入口登入學員帳號。  
T3 上傳真實槳葉影像/允許的作業，確認資料庫與檔案實際存在。  
T4 教師登入。  
T5 只看到同班提交。  
T6 執行真實 YOLO 推論，記錄信心值與模型版本。  
T7 核對教師審核結果與學員端紀錄。  
T8 驗證低品質模型不能 ACTIVE。  
T9 在隔離 Registry 驗證合格候選的啟用流程。  
T10 在隔離前端以已批准模型辨識，核對版本和審計紀錄。

T9/T10 未經獨立批准不得改動正式 ACTIVE Registry。

## 8. 最終裁決

| 准入項目 | 裁決 | 原因 |
| --- | --- | --- |
| CODE FREEZE | **BLOCKED** | 69 項未提交變更尚未拆成可審核候選包 |
| SECURITY | **BLOCKED** | 簽章契約缺本文/班級/重放綁定，且有 legacy 回退 |
| SERVICE | **BLOCKED** | 8022 排程與服務所有權衝突尚未完成隔離部署方案驗證 |
| STATIC | **READY（候選）** | Pages 工作樹乾淨；公開站與離線文案已存在，仍待人工外網檢查 |
| YOLO USER ACCEPTANCE | **BLOCKED** | T1–T10 未在預發布 HTTPS 完成；H3/正式 ACTIVE 未批准 |
| PRODUCTION DEPLOY | **APPROVAL REQUIRED** | 本輪未取得部署、Tunnel、DNS、Worker 或正式服務變更授權 |

## 9. 下一次需要教師明確批准的動作

1. 建立乾淨 P5 安全協定候選工作樹，實作並測試第 3 節簽章 envelope（不碰 v1.5C）。
2. 將 69 項中 A1/A2/A3 以逐檔 patch 重組至乾淨候選，不整包合併。
3. 建立 v2.0 專用服務埠與預發布 HTTPS Gateway/Tunnel；不得復用 8022。
4. 在預發布完成 T1–T10，再另行申請正式 ACTIVE 與正式流量切換。

