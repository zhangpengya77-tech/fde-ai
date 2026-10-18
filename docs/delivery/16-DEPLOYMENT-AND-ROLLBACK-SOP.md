# FDE-AI-UAS 2.0 交付文件｜16 正式部署與回滾 SOP

**文件版本**：v1.0（2026-10-14 Phase 6 產出）
**依據**：教師 Phase 6 指令第七節第 7 項；整併 `docs/delivery/01`、`03`、`05` 並與本輪磁碟現實核對
**性質**：**SOP 文件；本輪未執行任何部署、未重啟任何正式服務**

---

## 零、部署前現狀核對（2026-10-14 實測，教師部署前請重跑）

| 項目 | 實測值 | 注意 |
|---|---|---|
| 正式 Django `:8022` | LISTENING（PID 8640） | **既有服務，本輪未接管、未重啟** |
| DEMO Django `:8110`／Live `:8111` | LISTENING | 僅供人工驗收 |
| RAG `:8770` | LISTENING（PID 3880，只綁 127.0.0.1） | 手機須走 8111 同源代理 |
| YOLO `:8765` | 未啟動 | 未接真實推論前**不得**對外宣稱可用 |
| Git 工作區 | `191` 項變更（44 修改 + 147 未追蹤） | **43+ 項成果無版本保護** → 部署前第一件事是取得版本基線 |
| 最新 migration | `0019_golden_set_manifest_contract.py`（0016–0019 皆未追蹤） | 部署前必須先提交納管 |
| 代碼基準 HEAD | `e5c0442`（2026-10-03） | 只代表歷史基準，**不代表已封版** |

> ⚠️ **最高風險**：目前大量成果只在工作區，沒有 commit。部署前若發生誤刪或誤還原將無法復原。**Git 提交須教師單獨批准。**

---

## 一、正式部署 SOP（Linux／HTTPS；Windows 正式模式見 4.3）

### 階段 D0｜版本基線（**阻塞後續**）

1. 教師批准 Git 提交範圍 → 提交 147 項未追蹤成果與 44 項修改（分批、可審查）。
2. 建立標籤（例 `v2.0.0-rc1`）。
3. 匯出完整備份目錄 `D:\FDE-AI-UAS-v2.0-backups\` 至異地（遵循 3-2-1）。

### 階段 D1｜環境準備

| # | 動作 | 判準 |
|---|---|---|
| 1 | Python 3.12+；依 `docs/delivery/02-DEPENDENCIES.md` 安裝 | `pip check` 無衝突 |
| 2 | 設定正式環境變數（見 `03-ENVIRONMENT-VARIABLES.md` §4.2） | `DJANGO_DEBUG=false` 四項必要變數齊備（否則 fail-fast，屬正確行為） |
| 3 | 準備持久化 DB（PostgreSQL 正式建議） | 連線通 |
| 4 | 準備 `DJANGO_MEDIA_ROOT` 與 `FDE_VISION_CENTER_ROOT` | 寫入權限就緒 |

### 階段 D2｜資料遷移

1. **遷移前手動完整備份 + 還原實測**（見第三部分）。
2. `python manage.py migrate --check` → 無待套用遷移才可上線。
3. `python manage.py check --deploy` 通過。
4. `python manage.py collectstatic`（nginx 服務靜態檔）。

### 階段 D3｜啟動（順序固定）

```
1. Live Backend（產線例 :8030）
   cd <repo-root> && uvicorn live_backend.app.main:app --host 127.0.0.1 --port 8030
   curl -s http://127.0.0.1:8030/api/v1/vision/submissions   # 期望 JSON
2. Django gunicorn
   gunicorn config.wsgi:application --bind 127.0.0.1:8022 --workers 3
   curl -I http://127.0.0.1:8022/                            # 期望 200/302
3. nginx 反向代理 + HTTPS（含 HSTS：31536000/includeSubdomains/preload）
4. 教師手機開正式網域，跑 `docs/delivery/13` 七站 32 項
```

> 啟動順序原因：Django → Live Backend 為同步請求（30s timeout），先起後端可避免首位使用者冷啟動失敗。

### 階段 D4｜上線後健康檢查（每項都要看到預期）

| # | 檢查 | 期望 |
|---|---|---|
| 1 | 首頁／登入 | 200，無「Load failed」 |
| 2 | 學員登入 → 工作台 | 登入一次貫穿七站 |
| 3 | RAG 經由正式網域 | `source_type=rag` 正常；離線則明確降級 |
| 4 | 教師後台匯出 CSV | `text/csv`，中文不亂碼 |
| 5 | Live Coach 閉環（隔離環境腳本重跑） | 25/25 語意保持 |
| 6 | 外部模組徽章 | 呈現「尚未接入」（預期） |

---

## 二、回滾 SOP（四種情境）

### R1｜服務異常（程式無變更）

```bash
# 1. 停服务  2. 以原環境變數重啟  3. 複檢 D4
systemctl restart fde-django fde-live      # 或既有服務管理方式
```

### R2｜版本回滾（新版本有缺陷）

1. 停止 Django + Live Backend。
2. `git checkout <上一個已知良好 tag>`。
3. **若新版本含 migration**：先 `python manage.py migrate <app> <上一版編號>` 反向遷移（反向遷移前**必須**在隔離副本演練）。
4. 還原 D2 手動備份中的 DB／MEDIA／JSON Store（三個位置一起，見第三部分）。
5. 重啟並複檢 D4。

### R3｜DB 回滾（資料層）

```bash
# SQLite
sqlite3 db.sqlite3 "PRAGMA integrity_check;"   # 先確認現況
sqlite3 <備份>.sqlite3 ".backup 'db.sqlite3'"  # 或直接替換（停機後）

# PostgreSQL
pg_restore -h <host> -U <user> -d <db> --clean --if-exists <備份>.dump
```

還原後必驗 8 項（與 `05-BACKUP-RESTORE.md` §5.2 一致）：
integrity_check＝ok、migration 狀態一致、Evidence 筆數一致、MEDIA 檔數一致、JSON Store 可讀、**雙向引用無孤兒**、教師可登入、完整性檢查 `INTACT`。

### R4｜配置回滾（環境變數誤設）

1. 以受版本控制的 env 範本比對（`03-ENVIRONMENT-VARIABLES.md` §4.2）。
2. 還原上一版設定 → 重啟 → 複檢 D4。
3. `DJANGO_DEBUG` 意外為 `true` 屬**安全事件**：立即改回 `false` 並檢查日誌是否有錯誤頁外洩。

---

## 三、備份與還原要點（三個位置，缺一不可）

| # | 位置 | 正式建議 |
|---|---|---|
| 1 | 關聯式 DB | 每日 `pg_dump -Fc`／SQLite `.backup`；保留 30 天 |
| 2 | `DJANGO_MEDIA_ROOT` | 每週完整；保留 90 天 |
| 3 | `FDE_VISION_CENTER_ROOT` | 每日；保留 30 天 |
| 4 | Migration 前手動完整備份＋還原演練 | 永久保留 |

- **未經演練的備份等於沒有備份**：部署前必須在隔離環境實跑一次完整還原並記錄耗時。
- 備份後必跑 `sha256sum` + `integrity_check`。

---

## 四、正式與 DEMO 隔離規則（硬性）

| 規則 | 說明 |
|---|---|
| 服務隔離 | 正式 `:8022`／`:8030`；DEMO `:8110`／`:8111`；端口不得混用 |
| DB 隔離 | DEMO 用 `demo/runtime/db/demo.sqlite3`；正式庫**只讀**巡視，禁止寫入 |
| 啟動方式 | DEMO 一律 `demo/tools/start_demo.ps1`（先跑 `Set-DemoEnvironment`），**勿手動拼環境變數** |
| 缺 `FDE_DEMO_SIMULATED_INFERENCE=1` 會退化連真實 YOLO**導致 iPhone「Load failed」** | 已實測踩坑，見 `docs/reports/FDE_2_0_TAKEOVER_WORKBUDDY_2026-10-14.md` §五 |
| 部署權限 | 正式部署、回滾、migration、重啟正式服務**均須教師另行批准** |

---

## 五、本輪遵循聲明

| 動作 | 執行 |
|---|---|
| 正式部署 | ❌ 未執行 |
| 重啟正式服務（:8022／:8770） | ❌ 未執行 |
| 修改 migration／正式 DB | ❌ 未執行 |
| 產出部署／回滾 SOP | ✅ 本文件 |

**人工 iPhone 驗收：PENDING_MANUAL**
