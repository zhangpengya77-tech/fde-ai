# FDE-AI-UAS 2.0｜P0 iPhone 登入失敗核對報告

**日期**：2026-10-10 10:16（本地時間）
**範圍**：唯讀核對，**未修改任何資料庫、未修改任何程式邏輯、未重啟任何服務**
**判定**：**PASS（伺服器端 22/22）** ｜ 手機端根因已定位 → **輸入字串污染**

> 本報告不含任何明文密碼。

---

## 一、核心結論

1. **DEMO 資料庫中的密碼與本機交付檔完全一致** —— `check_password()` = `True`。
2. **iPhone 顯示「電子郵箱或密碼錯誤」不是密碼錯，是「送到伺服器的字串多了東西」。**
3. 已定位真因：**舊交付檔為 `password: xxxx` 格式，密碼與標籤黏在同一行**，使用者在手機上複製／手抄時極易連同 `password:`、`密碼：`、分隔線、尾隨空白或換行一起送出。
4. 已完成**格式層修訂**（密碼獨立成行，可直接整行選取），**密碼本身一字未改**（指紋前後一致）。
5. **未重設密碼** —— 依指示，一致性成立即不再重設。

---

## 二、逐項核對結果

### 要求 1｜DEMO 8110／8111 正在使用的資料庫路徑

| 服務 | PID | 監聽位址 | 使用 DB |
|---|---|---|---|
| Django（學生入口） | 7620 | `192.168.1.114:8110` | `D:\FDE-AI-UAS-v2.0\demo\runtime\db\demo.sqlite3` |
| Live Backend（proxy） | 18548 | `192.168.1.114:8111` | 同上（僅反向代理，不持有 DB） |

- 來源：`demo_common.ps1` 的 `Set-DemoEnvironment` 設定 `DJANGO_DB_NAME = demo\runtime\db\demo.sqlite3`
- **Django 實際連線 DB 經 `settings.DATABASES['default']['NAME'].resolve()` 驗證 = DEMO DB** ✅
- 正式庫 `student_portal\db.sqlite3`：**size 450560、mtime 2026-10-07T19:08:32，全程未變** ✅

### 要求 2｜帳號存在且啟用

```
id=1  demo.student01@fde-demo.local  is_active=1  is_staff=0  is_superuser=0  hash_len=89
id=2  demo.teacher@fde-demo.local    is_active=1  is_staff=1  is_superuser=0  hash_len=89
```

三重確認：直接讀 sqlite ✅ ｜ Django ORM 查詢 ✅ ｜ `last_login` 有值 ✅

### 要求 3｜交付檔 vs DEMO DB 一致性（核心）

```
交付檔：C:\Users\admin\.fde-demo-credentials\demo.student01.password.txt
長度 = 16        字元類別 = 大寫/小寫/數字皆具，無符號
遮罩預覽 = Ol************Av
指紋 sha256[:16] = 7828a67559bcc9fa

check_password()           = True   ← 一致
authenticate()             = demo.student01@fde-demo.local
舊密碼 [已移除：舊 DEMO 種子密碼明文]     = 已失效（False）
```

**結論：一致 → 不重設密碼。** ✅

### 要求 4｜手機登入請求確實進入同一個 DEMO DB

以 iPhone UA 實測三條路徑：

| 路徑 | 結果 | 意義 |
|---|---|---|
| `192.168.1.114:8110`（直連 Django） | 200 → `/student/` ✅ | DEMO 後端正常 |
| `192.168.1.114:8111`（Live proxy，**手機實際路徑**） | 200 → `/student/` ✅ | proxy 正確轉發到 8110 |
| `127.0.0.1:8022`（正式，用 DEMO 專屬帳號探測） | 顯示「電子郵箱或密碼錯誤」 | **證明 8111 不指向正式 8022** |

8110 與 8111 行為完全一致 → **同一後端、同一 DB**。 ✅

### 要求 5–7｜不重設、不修改、不輸出明文

- **未** 執行任何 `set_password` / `.save()`
- 帳號表關鍵欄位（密碼／啟用／權限）狀態指紋前後相同：`6c2e55f02829b18a` ✅
- 教師帳號雜湊自改密碼前後完全相同：`2e59da313b21` ✅
- 學生帳號雜湊 `b2a1d358c583` → `462471c5fdf1` → **本輪未再變動** ✅
- 全腳本 stdout／報告／日誌：**只輸出遮罩與指紋，無明文密碼** ✅

---

## 三、逐項核對總表

| # | 檢查項 | 結果 |
|---|---|---|
| 1a | DEMO 與正式為不同檔案 | PASS |
| 1c–1f | 帳號存在／啟用／非特權／有雜湊 | PASS |
| 2a–2b | Django 連線為 DEMO DB／ORM 可查到帳號 | PASS |
| 3a–3b | 交付檔解析成功／純英數且 ≥12 字元 | PASS |
| **3c** | **`check_password(交付檔密碼)` = True** | **PASS** |
| 3d | 舊密碼已失效 | PASS |
| 3e | 教師帳號雜湊未變動 | PASS |
| 3e2 | 學生帳號雜湊已變更（重設生效） | PASS |
| 3f | 目標帳號 `is_active` 仍為 True | PASS |
| 4a | 8111 proxy 與 8110 後端行為一致 | PASS |
| 4b | 手機路徑 8111 可登入 `/student/` | PASS |
| 4c | 正式 8022 拒絕 DEMO 帳號（兩者不同庫） | PASS |
| 5a | 帳號表關鍵欄位未被本輪改動 | PASS |
| 5a2 | 交付密碼仍與 DB 一致 | PASS |
| 5b | 正式 DB 完全未被觸碰 | PASS |
| 6a | 僅「純密碼」有效，含標籤／空白／全形皆失敗 | PASS |

**合計 22/22 PASS**

---

## 四、根因定位：為什麼 iPhone 會顯示「電子郵箱或密碼錯誤」

伺服器端一切正常，問題在**送到伺服器的密碼字串**。實測各種輸入情境：

| 輸入情境 | 是否有效 | 長度 |
|---|---|---|
| **只貼密碼本體（正確）** | **YES** | 16 |
| 連同 `password:` 標籤 | no | 25 |
| 連同中文標籤「密碼：」 | no | 19 |
| 全形冒號開頭 `：` | no | 17 |
| 尾端多一個空格 | no | 17 |
| 密碼＋換行 | no | 17 |
| 長按整段含分隔線 | no | 37 |

**設計缺陷在我這邊**：上一輪交付檔寫成

```
account: demo.student01@fde-demo.local
password: OlxxxxxxxxxxxxAv      ← 密碼與標籤同一行
```

在電腦上複製相對安全，但在 iPhone 上長按選取時，**很容易把 `password: ` 一起選進去**；手抄時也容易把「密碼: 」寫進去或把半角 `:` 打成全形 `：`。而 Django 的 `StudentLoginForm` **刻意不正規化密碼**（正確的安全設計），所以差一個字元就必然失敗。

### 已完成的修正（僅格式，不動密碼）

交付檔改為**密碼獨立成行 + 明確分隔線**：

```
# 【手機登入操作】
#   帳號：demo.student01@fde-demo.local
#   密碼：請複製下方分隔線之間的整行內容，不要多選、不要含空白
#
---- 以下為密碼，複製這一行 ----
OlxxxxxxxxxxxxAv
---- 密碼結束 ----
```

**密碼指紋修訂前後皆為 `7828a67559bcc9fa` → 密碼一字未改。**

---

## 五、下一步手機測試方式

**iPhone 操作（請務必只複製密碼那一行）**

1. 在電腦開啟 `C:\Users\admin\.fde-demo-credentials\demo.student01.password.txt`
2. 只選取 `---- 以下為密碼，複製這一行 ----` 與 `---- 密碼結束 ----` **之間的那一行**
3. 複製該行（**不要**多選到分隔線或任何說明文字）
4. iPhone Safari 開啟：`http://192.168.1.114:8111/login/`
5. 帳號輸入：`demo.student01@fde-demo.local`
6. 密碼欄位**長按 → 貼上**
7. 貼上後**目視檢查**：欄位內容應與那行完全相同，開頭是 `Ol`、結尾是 `Av`，長度 16
8. 點「登入」→ 應進入 `/student/`

**若仍失敗，請提供以下任一資訊，我可立即定位：**

- 密碼欄位貼上後的**可見字元數**（可長按全選觀察）
- 是否看到欄位開頭變成 `password:` 或「密碼：」
- 錯誤訊息出現的位置（紅框在欄位上方 = 伺服器端拒絕）

> 替代方案（若複製貼上仍不便）：可改用電腦端 Chrome 的「裝置模擬」先驗證流程；但**真機驗收仍以 iPhone 為準**。

---

## 六、禁止清單複核

| 項目 | 狀態 |
|---|---|
| 正式 1.5C 程式與分支 | 未觸碰 ✅ |
| 8022 | 僅唯讀探測（用 DEMO 帳號，無寫入）✅ 未重啟 |
| 8030 / 8765 / 8770 | 未觸碰 ✅ 8770 仍 LISTENING |
| Cloudflare | 未觸碰 ✅ |
| 正式資料庫 | 未連線、未寫入，mtime 仍 `2026-10-07T19:08:32` ✅ |
| DEMO 資料庫 | **本輪未寫入**（帳號表指紋不變）✅ |
| 程式邏輯 | 未修改（僅交付檔格式與核對腳本）✅ |

---

## 七、交付物

| 檔案 | 說明 |
|---|---|
| `demo/tools/verify_demo_login_consistency.py` | 本輪核對腳本（唯讀，22 項檢查） |
| `demo/runtime/logs/login_consistency_check.json` | 核對結果 JSON（不含明文密碼） |
| `C:\Users\admin\.fde-demo-credentials\demo.student01.password.txt` | 臨時密碼交付檔（**格式已修訂**，`0600`） |

---

## 八、待使用者確認

**人工 iPhone 驗收：PENDING**

伺服器端 22/22 PASS，端到端程式化登入 8111 → `/student/` 成功，但依專案鐵律，**須以 iPhone 真機進入 `/student/` 才可宣告完成**。

---

## 九、已知注意事項（沿用上一輪）

`demo/tools/seed_demo.py` 第 70 行仍寫死舊密碼 `[已移除：舊 DEMO 種子密碼明文]`。若日後執行 `seed_demo.py` 重建 DEMO 資料，**此臨時密碼將被覆蓋**。本輪未授權修改該檔，故保持原樣。
