# FDE-AI-UAS 2.0 ｜ DEMO 登入緊急修復報告

> 時間：2026-10-09（使用者出門前緊急修復）
> 範圍：只修復 DEMO 登入與基本展示，未開發新功能。

---

## 一、根因（Root Cause）

**DEMO 隔離資料庫內的帳號 `username` 欄位已被改成非種子值。**

| 帳號 | 被改壞的值 | 應為（種子值） |
|------|-----------|---------------|
| 學員 user id=1 | `username = FDE@fde-demo.local`、email 同 | `demo.student01@fde-demo.local` |
| 教師 user id=2 | `username = FDE` | `demo.teacher@fde-demo.local` |

登入表單以 **username 查詢帳號**。使用者以種子帳號 `demo.student01@fde-demo.local`
登入時，DB 內查無此 username → 直接回報「電子郵箱或密碼錯誤」，
**這與密碼是否正確無關**（密碼雜湊本身一直是好的）。

- 學員 `StudentProfile.email` 同時也被改成 `FDE@fde-demo.local`，
  導致 profile / enrollment / 8 筆成長紀錄仍綁在舊關聯上。

---

## 二、修復內容

**只修改隔離 DEMO DB，使用 Django 正規雜湊機制，未關閉 CSRF、未繞過密碼驗證、未放寬教師權限。**

1. 以 `StudentProfile（DEMO-STU-0001）` 反查回原學員帳號，
   將 `user.username`、`user.email`、`profile.email` 一起還原為
   `demo.student01@fde-demo.local`，**保留原 user↔profile↔enrollment↔成長紀錄 關聯**。
2. 還原教師帳號 username 為 `demo.teacher@fde-demo.local`（維持 `is_staff=True`）。
3. 兩者皆以 `user.set_password()` 重設密碼 → 演算法 `pbkdf2_sha256`（**非明文**）。
4. 修正腳本含**雙重安全護欄**：
   - 路徑必須在 `demo/` 之下，否則 ABORT。
   - 寫入前再次斷言 Django 實際連線的 DB 就是 DEMO DB，否則 ABORT。

腳本：`demo\tools\fix_demo_accounts.py`

---

## 三、驗收結果

### Django ORM 層（`authenticate()`）
| 帳號 | exists | is_active | is_staff | authenticate |
|------|--------|-----------|----------|--------------|
| 學員 | ✓ | ✓ | — | **OK** |
| 教師 | ✓ | ✓ | ✓ | **OK** |

### HTTP 完整瀏覽器流程（CSRF + session + 302 跟隨 + 登出再登入）
`demo\tools\verify_browser_flow.py` → **5/5 PASS**

| 項目 | 結果 | 證據 |
|------|------|------|
| 學員登入 | **PASS** | POST → 200，落地 `/student/`，取得 `sessionid` |
| 成長紀錄 | **PASS** | `/student/growth/` → `/student/courses/1/growth/`，200，6400 字 |
| 登出後再登入 | **PASS** | 重新登入成功，發出新 `sessionid`（Session/CSRF 正常） |
| 教師登入 | **PASS** | `/teacher/login/` → 200，落地 `/teacher/` |
| 教師後台 | **PASS** | `/teacher/` 200，3599 字 |

> 附註：純 GET `/logout/` 回 405（Django logout 需 POST）——這是我測試腳本的呼叫方式，
> 非功能缺陷；「登出後再登入」已證明登出／重登流程正常。

---

## 四、正式環境

**未修改。**

- 正式 DB `student_portal\db.sqlite3`：mtime **2026-10-07 19:08**（未被本次操作觸碰）。
- 正式服務 `:8022`（Django）、`:8770`（RAG）：全程 **LISTENING、未重啟、未變更**。
- 未觸碰 `:8765`（YOLO）、`:8030`、v1.5C、正式學員資料、正式 Cloudflare/GitHub 資源。

---

## 五、目前服務狀態

| 服務 | 埠 | 狀態 |
|------|-----|------|
| DEMO Django | 8110 | OPEN |
| DEMO Live Backend | 8111 | OPEN |
| 正式 Django | 8022 | OPEN（未動） |
| 正式 RAG | 8770 | OPEN（未動） |

---

## 六、使用方式

```
啟動：D:\FDE-AI-UAS-v2.0\demo\START_FDE_2_DEMO.cmd
停止：D:\FDE-AI-UAS-v2.0\demo\STOP_FDE_2_DEMO.cmd
入口：http://127.0.0.1:8111/
學員登入：http://127.0.0.1:8111/login/
教師登入：http://127.0.0.1:8111/teacher/login/
```

帳號（密碼不寫入報告，僅於啟動視窗顯示）：
- 學員 `demo.student01@fde-demo.local`
- 教師 `demo.teacher@fde-demo.local`
