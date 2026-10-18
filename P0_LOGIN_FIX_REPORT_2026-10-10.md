# FDE-AI-UAS 2.0｜P0 修復報告：iPhone Safari 學員登入無反應

**日期**：2026-10-10
**範圍**：僅 DEMO 2.0 登入功能（未動任何其他功能、未動正式 1.5C）
**結果**：已修復並通過 7/7 P0 驗收（+ 8/8 區網回歸、6/6 登入單元測試）

---

## 一、根因

`StudentLoginForm.username` 原本是 `forms.EmailField`，Django 會渲染成：

```html
<input type="email" name="username" maxlength="150" required id="id_username">
```

**行動版 Safari 的 HTML5 原生表單驗證，在判定失敗時會「靜默阻擋送出」**：
不送出 POST、不跳轉、不顯示任何錯誤訊息 —— 與實機回報的「畫面完全沒有反應」完全一致。

再加上原本表單 `<form method="post">` **沒有 `action` 屬性**，一旦 submit 被原生驗證攔下，
使用者與開發者都無從觀察到任何線索。

> 補充事實：HTML5 規格正則其實**接受** `demo.student01@fde-demo.local`（已實測 VALID）。
> 但 Safari 實作較嚴 —— 例如 iOS 鍵盤自動補上尾端空白時，`"...fde-demo.local "` 會被判 INVALID。
> 因此修法是**直接消除整類原生驗證風險**，不依賴各瀏覽器的判定差異。

---

## 二、逐步排查證據（對應指令六步）

| 步驟 | 檢查項 | 結果 |
|---|---|---|
| 第一步 | 登入按鈕是否真觸發 Form Submit | `<form method="post">` **無 `action`**；`<button type="submit">` 本身正常 |
| 第二步 | Safari JS 錯誤／事件阻止／disabled／驗證失敗／外掛干擾 | **登入頁完全沒有 JavaScript**（全 learning 模板 grep：登入頁與 `base.html` 皆無 `<script>`）；無重複 `id`、無 overlay、CSS 無 `pointer-events:none`。故 JS 錯誤與事件攔截**不可能**是原因；真正原因是 HTML5 原生驗證 |
| 第三步 | 是否產生 POST `/login/` | **未產生** —— 用 iPhone UA 直接對 `/login/` POST 則 **200 且成功跳轉 `/student/`**，證明伺服器與網路路徑完全正常，問題 100% 在用戶端送出前 |
| 第四步 | HTTP 狀態／CSRF／Session／驗證／302 | 全部正常：`csrftoken` 非 Secure、`SameSite=Lax`、`Path=/`；`DEBUG=true` 使 `SESSION_COOKIE_SECURE`／`CSRF_COOKIE_SECURE`／`SECURE_SSL_REDIRECT` 皆 False → 純 HTTP 可用 |
| 第五步 | 帳號存在／已啟用／密碼有效 | `demo.student01@fde-demo.local`（id=1）`is_active=True`、`StudentProfile.active=True`、enrollment／cohort／R01–R08 完整。`check_password` 對**正確密碼 = True**、對 `123456` = **False**（**未假設密碼為 123456**；全程未輸出、未記錄明文） |
| 第六步 | 修復後行為 | 錯誤密碼 → 明確顯示「電子郵箱或密碼錯誤」；正確帳密 → 跳轉 `/student/` |

---

## 三、修改內容（4 個檔案，修改前皆已備份）

備份位置：`demo/backup/`（`student_login.html.bak-20261010-0919`、`teacher_login.html.bak-20261010-0919`、`forms.py.bak-20261010-0919`、`portal.css.bak-20261010-0920`）

1. **`student_portal/learning/forms.py`**
   `EmailField` → `CharField` + `TextInput`，並加上行動版友善屬性：
   `autocomplete="username"`、`autocapitalize="none"`、`autocorrect="off"`、`spellcheck="false"`、`inputmode="email"`
   （保留 iOS 郵件鍵盤，但不觸發原生 email 驗證）；
   於 `clean()` 增加伺服器端 `@` 格式檢查，**安全性不降低**。

2. **`learning/templates/learning/student_login.html`**
   - 表單加 `action="{% url 'learning:student_login' %}"` 與 `novalidate`
   - 錯誤訊息移到欄位**之前**（`login-errors`、`role="alert"`），確保手機免捲動即可看見

3. **`learning/templates/learning/teacher_login.html`**
   表單同樣加 `action` 與 `novalidate`（同類風險一併消除，行為不變）

4. **`learning/static/learning/portal.css`**
   新增 `.login-errors` 醒目樣式

---

## 四、驗收結果（7/7 PASS）

新增驗收腳本：`demo/tools/verify_login_p0.py`（走 `http://192.168.1.114:8111`，模擬 iPhone Safari UA）

| 驗收項 | 結果 | 證據 |
|---|---|---|
| 1. 正確帳密 → 成功登入 | **PASS** | 200，落 `/student/`，`sessionid` 已設 |
| 2. 錯誤密碼 → 明確錯誤提示 | **PASS** | 顯示「電子郵箱或密碼錯誤，請重新確認。」，未建立 session，停留登入頁 |
| 3. iPhone Safari 表單可送出 | **PASS** | `action` 存在、`novalidate` 存在、`type="text"`、無 `type="email"`、CSRF 存在 |
| 4. 登出後重新登入正常 | **PASS** | 登出後 session 失效（`/student/` → `/login/?next=/student/`），再登入成功 |
| 5. R07 頁面可開啟 | **PASS** | 200，`/student/courses/1/growth/R07/`，含「專業任務驗證」 |
| 6. 教師登入不受影響 | **PASS** | `/teacher/` 登入成功，`/teacher/vision-models/` 200 可讀 |
| 7. 正式 1.5C 完全不受影響 | **PASS** | 正式 DB mtime 仍為 `2026-10-07T19:08:32.138590`（未變） |

**回歸測試**
- `demo/tools/verify_lan_mobile.py`：**8/8 PASS**
- `manage.py test learning.tests.test_student_email_login`：**6/6 OK**

**已知非本次問題（已用對照組證明）**
`test_auth...test_platform_hero_action_opens_student_growth_portal` FAIL —— 前端 hero 文案契約不一致
（`src/app.js` 寫「我的成長日誌」，測試要「我的學習日誌」）。與登入無關：
把本次模板修改 `git stash` 還原後重跑，**同樣 FAILED** → 屬既有缺陷，本次未動。

---

## 五、重啟與程序歸屬（先確認才動手）

| 連接埠 | PID | 命令列 | 處置 |
|---|---|---|---|
| 8110 | 12744 | `manage.py runserver 192.168.1.114:8110 --noreload` | **僅此 DEMO 服務重啟** |
| 8111 | 16872 | `uvicorn app.main:app --host 192.168.1.114 --port 8111` | **僅此 DEMO 服務重啟** |
| 8022 | 13760→16408 | 正式服務 | **未觸碰**，全程 `127.0.0.1` 持續 LISTENING |
| 8770 | 4348 | 正式服務 | **未觸碰**，全程 `127.0.0.1` 持續 LISTENING |

- 防火牆三個設定檔（Domain／Private／Public）仍為 `Enabled=False` —— **未做任何變更**
- 重啟後綁定仍為 `192.168.1.114`（**非 `0.0.0.0`**）
- 未新增任何帳號；未將測試密碼寫入網頁、日誌或版本庫

---

## 六、回滾方式

```
git checkout -- student_portal/learning/forms.py \
  student_portal/learning/templates/learning/student_login.html \
  student_portal/learning/templates/learning/teacher_login.html \
  student_portal/learning/static/learning/portal.css
```

或直接還原 `demo/backup/*.bak-20261010-0919` 與 `portal.css.bak-20261010-0920`，再重啟 DEMO 8110／8111。

---

## 七、待人工確認

伺服器端與區域網路的登入鏈路已全部自動化驗證通過（7/7）。
**iPhone 實機點擊驗收仍需你本人操作**（本機為 Windows，無 WebKit／Safari 引擎可代跑）。
請以 Safari 開 `http://192.168.1.114:8111/login/` 實測；在完成前本項標註
`人工 iPhone 驗收：PENDING`。
