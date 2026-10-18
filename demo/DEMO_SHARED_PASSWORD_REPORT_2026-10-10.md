# FDE-AI-UAS 2.0｜DEMO 學生／教師測試帳號統一 — 完成報告

**日期**：2026-10-10 10:23（本地時間）
**範圍**：僅 DEMO 隔離環境，**未修改正式 1.5C**
**判定**：**PASS（驗收 14/14）**
**桌面帳密檔**：`C:\Users\admin\Desktop\FDE_DEMO_測試帳密.txt`

> 本報告不含任何明文密碼。

---

## 一、總判定

| 項目 | 結果 |
|---|---|
| 兩帳號設為同一組 16 位純英數密碼 | ✅ PASS |
| 學生／教師角色與權限保留 | ✅ PASS |
| 僅修改 DEMO 兩個帳號，其他帳號未動 | ✅ PASS |
| 桌面帳密檔已建立（含指定內容與順序） | ✅ PASS |
| 驗收 8 項 | ✅ **14/14 PASS** |
| 正式環境（1.5C／8022／8030／8765／8770／Cloudflare／正式 DB） | ✅ 全部未觸碰 |

---

## 二、執行摘要

### 目標資料庫（先確認，後操作）

```
D:\FDE-AI-UAS-v2.0\demo\runtime\db\demo.sqlite3     ← 唯一被寫入
D:\FDE-AI-UAS-v2.0\student_portal\db.sqlite3        ← 正式，未連線
```

**三重護欄全部通過**：

1. **路徑護欄**：目標須同時含 `fde-ai-uas-v2.0` 與 `demo`，且**不得等於正式 DB**
2. **連線護欄**：Django `settings.DATABASES['default']['NAME'].resolve()` 必須等於 DEMO DB
   （此為關鍵——只信環境變數不足，必須驗證真實連線物件）
3. **帳號護欄**：學生須存在且 `is_staff=False`／`is_superuser=False`；
   教師須存在且 `is_staff=True`

### 修改前備份

```
demo/backup/demo.sqlite3.bak-20261010-102132-sharedpwd   (557,056 bytes)
```

### 執行方式

`demo/tools/reset_demo_shared_password.py`（新增）——使用 Django `set_password()`，
以 `secrets` + `ascii_letters+digits` 產生 **16 位純英數**密碼（保證含大小寫與數字、**無特殊符號**），
兩帳號寫入**同一組密碼**。

### 執行結果

```
[OK] Guard 1: target DB = D:\FDE-AI-UAS-v2.0\demo\runtime\db\demo.sqlite3
[OK] Guard 2: Django connection DB = D:\FDE-AI-UAS-v2.0\demo\runtime\db\demo.sqlite3
[OK] Guard 3a: student id=1 is_staff=False is_active=True
[OK] Guard 3b: teacher id=2 is_staff=True  is_active=True

[RESULT] password length        = 16
[RESULT] pure alphanumeric      = True
[RESULT] has lower/upper/digit  = True/True/True
[RESULT] student check_password = True
[RESULT] teacher check_password = True
[RESULT] shared password (cross-check both) = True
[RESULT] roles preserved        = True
[RESULT] is_active preserved    = True
[RESULT] other accounts unchanged = True
```

角色與權限**完全保留**：學生維持 `is_staff=False`/`is_superuser=False`，
教師維持 `is_staff=True`，兩者 `is_active=True` 皆未變。

> **技術說明**：兩帳號密碼相同，但 Django PBKDF2 對每個帳號使用**獨立隨機 salt**，
> 因此雜湊字串必然不同。驗證「共用密碼」的正確方式是**對兩帳號用同一組密碼 `check_password()` 皆為 True**（交叉驗證），
> 而非比較雜湊是否相等。

---

## 三、驗收結果（14/14 PASS）

全程走手機實際路徑 `http://192.168.1.114:8111`，使用 iPhone Safari UA。

| # | 驗收項 | 結果 | 實測數據 |
|---|---|---|---|
| 1 | 學生共同密碼登入 `/student/` | **PASS** | 200 → `/student/`，`sessionid` 已設 |
| 2 | 教師共同密碼登入 `/teacher/` | **PASS** | 200 → `/teacher/`，`sessionid` 已設 |
| 2b | 教師帳號無法經學生入口 `/login/` 登入 | **PASS** | 停留 `/login/`，角色分流正確 |
| 3 | 學生不能進入教師後台 | **PASS** | `/teacher/`、`vision-flywheel`、`golden-sets` **全數 403** |
| 4 | 教師權限維持正常 | **PASS** | 教師後台 3 頁皆 200 |
| 5 | R07 與 prop-scan 可開啟 | **PASS** | R07=200（4615B）、prop-scan=200（9872B） |
| 6 | 錯誤密碼不能登入（學生） | **PASS** | 顯示錯誤、**無 session** |
| 6 | 錯誤密碼不能登入（教師） | **PASS** | 顯示錯誤、**無 session** |
| 6b | 舊密碼已失效 | **PASS** | 顯示錯誤、**無 session** |
| 7 | DEMO 8110／8111 正常 | **PASS** | 8111 首頁/health=200、8110 兩登入頁=200 |
| 8a | 正式 DB mtime 未變 | **PASS** | 仍 `2026-10-07T19:08:32` |
| 8b | 正式 DB 僅原帳號 | **PASS** | 只有 `r07.student@local.test` |
| 8c | DEMO 帳號角色正確 | **PASS** | 學生 `is_staff=0`、教師 `is_staff=1` |
| 8d | 正式 8022 拒絕 DEMO 帳號 | **PASS** | 顯示錯誤、無 session → 證明 8111 未指向正式 |

### 驗收過程中修正的兩處腳本誤判（非系統問題）

1. **教師登入端點用錯**：`/login/` 是**學生專用入口**（`StudentLoginForm`，會拒絕 staff），
   教師必須走 `/teacher/login/`（`TeacherLoginForm`）。修正後教師登入 PASS。
2. **錯誤訊息文字不同**：
   - 學生入口用自訂訊息「電子郵箱或密碼錯誤，請重新確認。」
   - 教師入口沿用 Django 內建翻譯「輸入正確的 使用者名稱 和密碼。請注意兩者皆區分大小寫。」
   兩者皆代表登入被正確拒絕（`sessionid` 未建立、停留原頁）。已同時涵蓋兩種文字。

> **重要**：教師帳號無法從 `/login/` 登入是**既有的正確設計**（角色分流），
> 因此教師必須使用 `/teacher/login/`。桌面帳密檔已據此標示正確入口。

---

## 四、桌面帳密檔

**實際位置**：

```
C:\Users\admin\Desktop\FDE_DEMO_測試帳密.txt
```

**實際內容**（密碼行已遮罩）：

```
FDE-AI-UAS 2.0 DEMO

學生帳號：demo.student01@fde-demo.local
教師帳號：demo.teacher@fde-demo.local
共同測試密碼：
zy********QV

學生登入：
http://192.168.1.114:8111/login/
教師登入：
http://192.168.1.114:8111/teacher/login/

# 本檔案僅供教師本人使用。請勿放入版本控制、雲端同步或共用資料夾。
# 產生時間：2026-10-10T10:22:21
# 撤銷方式：執行 demo/tools/reset_demo_shared_password.py --revoke
```

內容與順序**完全依指令要求**：標題 → 學生帳號 → 教師帳號 → `共同測試密碼：` 標籤 →
**下一行只放完整密碼**（無附加標籤）→ 學生登入網址 → 教師登入網址。

**未建立桌面捷徑**（依指令建議，避免在共用或公開桌面暴露明文密碼）。

---

## 五、密碼取得與撤銷

**取得方式（本機受限位置，`0600`）**

```
C:\Users\admin\.fde-demo-credentials\demo.shared.password.txt
```

編號格式：密碼獨立成行，夾在兩條分隔線之間，**方便整行選取複製**
（已修正先前 `password: xxx` 格式在 iPhone 上易連同標籤複製的問題）。

**撤銷方式（DEMO 測試結束後）**

```bash
python demo/tools/reset_demo_shared_password.py --revoke
```

---

## 六、未變更項（已核實）

| 項目 | 狀態 |
|---|---|
| 正式 1.5C 程式與分支 | 未觸碰 ✅ |
| 正式 8022 | 僅唯讀探測（用 DEMO 帳號，無寫入）✅ 未重啟 |
| 8030 / 8765 / 8770 | 未觸碰 ✅ 8770 仍 LISTENING |
| Cloudflare Worker／Tunnel | 未觸碰 ✅ |
| 正式資料庫 | 未連線、未寫入；mtime 仍 `2026-10-07T19:08:32`、size 450560 ✅ |
| 正式教師／學生帳號 | 未觸碰 ✅ |
| DEMO 8110／8111 | 未重啟，持續正常（PID 7620 / 18548）✅ |
| 其他帳號 | `other accounts unchanged = True` ✅ |

**密碼未寫入**：Git、程式碼、公開日誌、網頁。
`.gitignore` 已補強規則（`*password*.txt`、`*帳密*.txt`、`*.password.txt`、`.fde-demo-credentials/`），
並實測三種檔名皆已被忽略。

---

## 七、交付物

| 檔案 | 說明 |
|---|---|
| `C:\Users\admin\Desktop\FDE_DEMO_測試帳密.txt` | **教師桌面帳密檔**（依指令格式） |
| `C:\Users\admin\.fde-demo-credentials\demo.shared.password.txt` | 本機受限交付檔（`0600`） |
| `demo/tools/reset_demo_shared_password.py` | 設定／撤銷共用密碼（含 `--revoke`） |
| `demo/tools/verify_shared_password_acceptance.py` | 驗收腳本（唯讀，14 項） |
| `demo/runtime/logs/shared_password_acceptance.json` | 驗收結果 JSON |
| `demo/backup/demo.sqlite3.bak-20261010-102132-sharedpwd` | 改前備份 |

---

## 八、待使用者確認

**人工 iPhone 驗收：PENDING**

伺服器端驗收 14/14 PASS（含端到端登入、角色隔離、錯誤密碼拒絕），
但依專案鐵律，**須以 iPhone 真機實際登入成功才可宣告完成**。

### iPhone 測試方式

**學生**
1. Safari 開 `http://192.168.1.114:8111/login/`
2. 帳號：`demo.student01@fde-demo.local`
3. 密碼：從桌面帳密檔複製「共同測試密碼」**下一行的那一行**（只是 16 個英數字，不含任何標籤與空白）
4. 應進入 `/student/`

**教師**
1. Safari 開 `http://192.168.1.114:8111/teacher/login/`
2. 帳號：`demo.teacher@fde-demo.local`
3. 密碼：**同一組**密碼
4. 應進入 `/teacher/`

> ⚠️ **教師請務必使用 `/teacher/login/`**，`/login/` 是學生入口，教師帳號會被拒絕（此為正確設計）。

---

## 九、本輪完成後已停止

依指令「本輪完成後停止，不開發其他功能」——本輪僅執行帳號統一、驗收與交付，未開發任何其他功能。
