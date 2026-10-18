# P0 診斷報告：iPhone 真機「按登入後停留原頁」

**日期**：2026-10-10 ｜ **性質**：唯讀診斷（本輪未修改任何檔案、未重啟任何服務）
**入口**：`http://192.168.1.114:8111/login/` ｜ **帳號**：`demo.student01@fde-demo.local`

---

## 結論（一句話）

**不是代理問題、不是表單問題、不是 CSRF、不是 Cookie —— 是那幾次送出的「密碼字串」不符。**

真機**確實送出了 `POST /login/`**，伺服器以 **HTTP 200** 回覆登入失敗頁
（診斷紀錄：`check_password: False`、`authenticate: False`、`session_created: False`）。
**整條代理與認證鏈路都是健康的** —— 同一支真機 UA 在紀錄中也多次出現
`check_password: True` → `302` → `GET /student/ 200` **成功登入**。

---

## 第一步（決定性證據）：真機 POST 確實送達

取自 8110 Django 即時請求紀錄（真機 UA = `iPhone OS 18_7 ... Version/26.6`）：

**失敗的那次：**
```
"GET /login/ HTTP/1.1" 200 1806
"GET /static/learning/portal.css ... 200
Student login diagnostic: {..., 'check_password': False, 'authenticate': False, 'session_created': False, ...}
"POST /login/ HTTP/1.1" 200 1958      ← 停留在登入頁（1958 bytes = 含錯誤訊息的登入頁）
"GET /login/ HTTP/1.1" 200 1806
```

**成功的那次（同一支真機）：**
```
Student login diagnostic: {..., 'check_password': True, 'authenticate': True, ...}
Student login session diagnostic: {..., 'session_created': True, 'redirect_url': '/student/'}
"POST /login/ HTTP/1.1" 302 0         ← 正確跳轉
"GET /student/ HTTP/1.1" 200 2017     ← 進入學員頁
```

> **200 而非 403** 代表 **CSRF 驗證已通過**；**200 而非 302** 代表**只有認證失敗**。

---

## 五步診斷逐項結果

| 步驟 | 檢查項 | 結果 |
|---|---|---|
| 1 | 8111／8110 是否收到真機 POST | ✅ **收到**。真機 UA 下有 `POST /login/ 200 1958`（失敗）與 `POST /login/ 302 0`（成功）兩種紀錄 |
| 2 | 若未送出：表單事件／Safari 驗證／JS／翻譯 | ❌ **排除**。登入頁**完全沒有 JavaScript**、已加 `novalidate`、非 403，證明表單可正常送出 |
| 3 | 有 POST 時：狀態／CSRF／認證／Session／302／GET /student/ | ✅ 全部正常：CSRF 通過、Session 正確建立、`Location: /student/`、後續 `GET /student/ 200 2017` |
| 4 | 代理轉送 Set-Cookie／Location／Host／Origin／Referer；是否誤指 8022 | ✅ **完全正常**。`Set-Cookie` 正確帶出（`csrftoken` + `sessionid; HttpOnly; SameSite=Lax`）；`Location` 由 `http://192.168.1.114:8110/student/` 正確改寫為 `/student/`。第 493 行硬編碼 `Host: 127.0.0.1:8022` **僅影響錯誤頁顯示文字**，不影響路由或認證 |
| 5 | 與已通過的自動化測試比較，找第一個不同環節 | ✅ `verify_login_p0.py` 仍 **7/7 PASS**。唯一差異：**自動化測試每次送出精確密碼字串**；真機失敗場次送出的是變異字串 |

---

## 根因：密碼中的 `#` 在 iOS 上被轉換／吃掉

DEMO 密碼結構（僅屬性，不洩漏明文）：**長度 16，含 2 大寫、9 小寫、4 數字、1 個符號 `#`**。

實測矩陣（每個案例使用**全新 session**，排除 CSRF token 輪換干擾）：

| 送出的密碼形態 | 登入結果 |
|---|---|
| 精確正確 | ✅ 成功 → `/student/` |
| 尾端空白（iOS 鍵盤自動補） | ❌ 「電子郵箱或密碼錯誤」 |
| 前端空白 / 尾端換行 | ❌ |
| `#` 被 iOS 智慧標點轉為全形 `＃` | ❌ |
| `#` 被轉為 `﹟`（小型數字號） | ❌ |
| `#` 被省略／被當成 URL fragment 截斷 | ❌ |
| 首字大小寫被自動修正 | ❌ |

**關鍵對照**：
- **username 欄位有容錯** → `clean_username()` 做 `strip().lower()`，且查詢用 `email__iexact`，
  所以帳號大小寫／前後空白**都能登入**。
- **密碼欄位刻意不做任何正規化**（正確的安全設計）→ 任何單一字元差異都會失敗。

> iOS 在中文／英文鍵盤切換或開啟自動修正時，`#` 很容易變成全形字元；
> 這是「有時成功、有時失敗」的根本原因。

---

## 未變更項（已核實）

- **本輪全程唯讀**：未修改任何檔案、未重設密碼、未重做登入頁、未重啟任何服務
- 正式 DB `student_portal/db.sqlite3`：mtime 仍 `2026-10-07T19:08:32.138590`
- 正式服務 8022／8030／8765／8770、Cloudflare、正式資料庫：**完全未觸碰**

---

## 建議處理方式（不需改碼，先做前三項）

1. **iPhone 上逐字重打密碼**，特別確認 `#` 是**半形**（先切到英文鍵盤的符號頁再按 `#`）。
2. **關閉 Safari 自動修正／自動翻譯**：設定 → Safari → 關閉「自動修正」；並確認網址列未啟用翻譯。
3. **避免從聊天軟體貼上密碼**（可能夾帶全形字元或不可見字元）。
4. **（可選，需授權）** 若希望長期免除 iOS 標點轉換問題，
   可將 DEMO 學員密碼改為**純英數（不含符號）** —— 屬 **DEMO-only** 變更，
   需你授權後執行，並同步更新 `demo/tools/seed_demo.py` 與 `start_demo.ps1` 的提示文字。

---

## 需要授權的事項

- 第 1～3 項：**不需要授權**（純使用者端操作）
- 第 4 項（改 DEMO 密碼為純英數）：**需要授權**

---

## 驗收標準提醒

依你的要求，**最終驗收必須以 iPhone 真機成功進入 `/student/` 為準**。
本輪為唯讀診斷，**不宣稱已通過真機驗收**；在真機成功進入 `/student/` 前，
本項狀態維持 `人工 iPhone 驗收：PENDING`。

伺服器端證據（真機 UA 下曾出現 `check_password: True` → `302` → `GET /student/ 200`）
已證明**後端鏈路完全可用**，目前卡點在使用者端輸入的密碼字串。
