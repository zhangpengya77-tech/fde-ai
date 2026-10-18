# P0 診斷報告：手機登入後 Django 404（U+FFFC 路徑）

**日期**：2026-10-10 ｜ **性質**：唯讀診斷（本輪未修改任何系統）
**症狀**：iPhone 真機開啟 `http://192.168.1.114:8111/login/` 後顯示 Django 404
**錯誤頁**：`Request URL: http://127.0.0.1:8022/login/%EF%BF%BC`

---

## 結論（一句話）

**第一個真正失敗節點是「Django URLconf 收到含 U+FFFC 的路徑，找不到對應路由」→ 404。**
`127.0.0.1:8022` 只是錯誤頁的**顯示字串**（代理硬編碼的 Host），
**不是實際連線目標，也不代表正式系統被修改**。

本機已完整複現該 404，且錯誤頁內容與實機回報 byte 級一致。

---

## 八項診斷逐項結果

| # | 檢查項 | 結果 | 證據 |
|---|---|---|---|
| 1 | 8111 代理目標是否仍為 DEMO 8110（非正式 8022） | ✅ **是，仍指向 8110** | 以 **DEMO 專屬帳號**探測：經 `:8111` 登入**成功**（200 → `/student/`）；直接打 `:8022` 則回**「電子郵箱或密碼錯誤」**（該帳號不存在於正式 DB）。若代理真指向 8022，登入不可能成功 |
| 2 | DEMO 的 Host／CSRF／Location／redirect 設定 | ✅ 正常 | `DJANGO_ALLOWED_HOSTS` 與 `DJANGO_CSRF_TRUSTED_ORIGINS` 皆含 `192.168.1.114:8110/8111`；`FDE_DJANGO_PORTAL_URL=http://192.168.1.114:8110`。`LOGIN_REDIRECT_URL` **未設定**（改用 `StudentLoginView.get_success_url()` → `reverse('student_dashboard')`） |
| 3 | Django 為何顯示 `127.0.0.1:8022` | ✅ **找到硬編碼** | `live_backend/app/main.py:493`：`headers["host"] = "127.0.0.1:8022"` —— 代理**一律以此 Host 轉發**，故 Django 的 `request.get_host()` 與錯誤頁 `Request URL` 都顯示 8022。**純顯示假象** |
| 4 | 登入後 302 Location 是否含異常字元 | ✅ **乾淨** | `Location: /student/`，codepoints 全為 ASCII（`0x2f 0x73 ...`），**無 U+FFFC** |
| 5 | 學員登入表單 action 是否正確 | ✅ **正確** | `<form method="post" action="/login/" novalidate>` |
| 6 | U+FFFC 是否由 Safari／翻譯引入 | ✅ **來源在用戶端** | 以 raw socket 直接送 `%EF%BF%BC` → 404；送乾淨路徑 → 200。伺服器**忠實處理所收位元組**，未自行引入該字元 → 來自 Safari 網址貼上／自動翻譯／複製時夾帶的不可見字元 |
| 7 | `GET /login/` vs `GET /login/%EF%BF%BC` | ✅ 200 vs **404** | **8110 與 8111 行為完全一致** → 證明與代理無關，問題在 Django 路由層 |
| 8 | 完整 DEMO POST → 302 → `/student/` | ✅ **全程只走 DEMO** | 登入 200，最終 URL `http://192.168.1.114:8111/student/`；R07 200；prop-scan 200；學員首頁 200；cookie 域僅 `192.168.1.114` |

---

## 根因鏈

```
iPhone Safari 位址含 U+FFFC（不可見）
        ↓  GET /login/%EF%BF%BC
8111 Live Backend 代理（正確轉發至 DEMO 8110）
        ↓  硬編碼 Host: 127.0.0.1:8022（僅影響顯示）
DEMO 8110 Django：URLconf 無 login/<U+FFFC>/ 路由
        ↓
404，錯誤頁顯示 Request URL = http://127.0.0.1:8022/login/%EF%BF%BC
```

**關鍵澄清**：`8022` 出現在錯誤頁 ≠ 正式系統被改。
它來自代理層一行硬編碼的 Host header，與實際路由目標無關；
實測已證明 `:8111` 走的是 DEMO 8110（DEMO 帳號可登入、正式帳號不行）。

---

## 未變更項（已核實）

- 正式資料庫 `student_portal/db.sqlite3`：mtime 仍 `2026-10-07T19:08:32.138590`、size `450560`
- 正式服務 8022（PID 22092）、8770（PID 4348）：**非我啟動、未觸碰**
- DEMO 8110（PID 7620）、8111（PID 18548）：維持 `192.168.1.114`
- 本輪**全程唯讀，未修改任何檔案、未重啟任何服務**

---

## 最小修復方式（尚未執行，需授權）

### 方案 A — 免改碼（建議先做，不需授權）
iPhone 以**手動輸入**或乾淨短網址開啟 `http://192.168.1.114:8111/login/`，
避免由聊天軟體／Safari 網址列**貼上**時夾帶不可見字元；
並在 Safari 對該站**關閉自動翻譯**。
> 這是真正的使用者端解法，零風險。

### 方案 B — DEMO-only 1 行改碼（需授權）
`live_backend/app/main.py:493`
```python
headers["host"] = "127.0.0.1:8022"     # 現況（硬編碼）
headers["host"] = django_host          # 建議：隨 FDE_DJANGO_PORTAL_URL 推導
```
**效益**：錯誤頁與任何絕對 URL 會顯示真實 Host，杜絕未來誤判。
**風險**：低（僅影響 Host header 值）；但仍需重啟 DEMO 8111。

### 方案 C — 代理層正規化（不建議本輪）
在代理層剝除 U+FFFC／零寬字元後再轉發。屬**行為變更**，可能掩蓋真實錯誤，建議不做。

---

## 需要授權的事項

- **方案 A：不需要授權**（純使用者端操作）
- **方案 B：需要授權**（修改 `live_backend/app/main.py` 並重啟 DEMO 8111）
- **方案 C：不建議**

在取得授權前，本輪不進行任何修改。
