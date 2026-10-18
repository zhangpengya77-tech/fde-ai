# FDE-AI-UAS 2.0｜DEMO 現場故障根因與最小修復方案

> 依據指令 B：**先提交根因與最小修復方案**，尚未執行修復。
> 證據來源：已收集的 10 分鐘監測結果 `demo/runtime/logs/monitor.log`（任務 `n4j1jv`，2026-10-09 08:18–08:30），**未重啟服務、未清除現場證據**。
> 範圍：僅處理 DEMO 啟動與路由故障；不動正式 DB / v1.5C / 正式 8022·8770 服務 / Cloudflare；不開發新功能。

---

## 一、六項確認（全部基於現有 monitor.log 與原始碼）

### (a) 8110 / 8111 實際監聽 PID、父子程序及啟動時間
- 啟動腳本記錄的 Django PID = **25920**（`manage.py runserver` 啟動程序），但每個 checkpoint **實際監聽 8110 的是 PID 19276**。
- 8111 實際監聽 PID = **8972**（與啟動記錄一致）。
- **關鍵異常**：啟動器追蹤的 PID（25920）≠ 真正監聽的 PID（19276）。亦即「啟動器以為在管的程序」並不是「真正提供服務的程序」。
- 兩組服務皆由 `START_FDE_2_DEMO.cmd → powershell start_demo.ps1 → Start-Process` 產生的子程序，隸屬同一個 cmd 視窗的 console / process group。

### (b) Chrome 故障發生時兩個服務是否仍在
- 在我的監測環境（背景常駐任務）中：**是**，全程都在（T+0/1/5/10min 同 PID 19276/8972，真實 Chrome 登入每輪都成功）。
- 但「全程都在」正是問題核心：監測任務本身是常駐背景 process，把 console / process group 一直撐住，子程序從未收到結束信號。你的雙擊環境不是這樣（見 f）。

### (c) /login/ 經 8111 代理到 8110 是否成功
- 監測環境中：成功。`monitor.log` → `login_8111: 200`，`django.err.log: "GET /login/ HTTP/1.1" 200`。因 8110 當時存活，`main.py:486 django_portal_proxy → FDE_DJANGO_PORTAL_URL=http://127.0.0.1:8110` 正常轉發。
- 你的故障環境中：8110 已死 → proxy 502 / refused → `/login/` ERR_CONNECTION_REFUSED。與你看到的完全一致。

### (d) /api/downloads 實際 HTTP 狀態、回應內容及錯誤日誌
- 監測環境中：`api_downloads_8111: 200`。此端點由 live_backend（8111）直接服務，自 `FDE_DOWNLOAD_ROOT`（`demo/runtime/downloads/`，含 2 個種子檔 + manifest）讀取，**不依賴 8110**。
- 你看到的「`/downloads/` 顯示下載清單讀取失敗」是 **Django 路由 `/downloads/`（經 8111 反代到 8110）整頁載入失敗**，其內嵌 JS 無法取得資料才顯示「讀取失敗」。根因仍是 8110 死亡；`/api/downloads` 本體在 8111 活著時仍會回 200。

### (e) 啟動腳本是否在執行完畢後終止子程序
- **是，且這正是故障機制。** `START_FDE_2_DEMO.cmd` 跑完 `start_demo.ps1` 後有 `pause`，使用者按鍵 → `exit /b` → cmd 視窗（console）結束 → Windows 對隸屬該 console 的 process group 發送結束信號。**8110（Django runserver）收到並死亡；8111（uvicorn）因信號處理 / group 歸屬不同而存活** → 完全對應「首頁正常、Django 路由拒絕連線」。

### (f) 監測環境是否與你雙擊啟動的環境完全一致
- **不一致，這是本次「全綠」結果不具代表性、且與你現場不符的根本原因。**
  - 監測：`monitor_demo_stability.ps1` 以 `run_in_background` 背景任務執行，其 PowerShell 程序「全程常駐 10 分鐘」，把 console / process group 一直撐住，子服務從未經歷「啟動視窗關閉」。
  - 你：雙擊 `START_FDE_2_DEMO.cmd` 開啟 cmd 視窗 → 跑完 → 關閉視窗 → process group 被拆 → Django 死、uvicorn 活。
- **結論**：10 分鐘監測證明的是「啟動程序存在期間服務穩定」，**完全沒有測到「啟動視窗關閉後服務是否仍存活」這個關鍵場景**。這是測量有效性失效，必須承認。

---

## 二、根因（Root Cause）

DEMO 服務用 `Start-Process`（plain）啟動，隸屬雙擊 cmd 視窗的 console / process group。視窗關閉 → group 拆除 → **Django（8110）被終止、uvicorn（8111）存活** → 首頁（8111）正常、`/login/`、`/downloads/`（8110 路由）ERR_CONNECTION_REFUSED。

輔因（已由 monitor.log 證實）：啟動器追蹤的 PID 與實際監聽 PID 不符（25920 ≠ 19276），導致 `check_demo.ps1` / `stop_demo.ps1` 依賴 state 裡的 PID，會產生誤判、且無法乾淨停止孤兒服務。

---

## 三、最小修復方案（DEMO-only）

1. **解除服務與啟動視窗的綁定**
   - 把 `start_demo.ps1` 的 `Start-Process` 改為 `demo_common.ps1` 已寫好的 `Start-DemoServer`（Win32 `CreateProcess`）。
   - **修正旗標（已查證）**：先前只用了 `CREATE_NEW_PROCESS_GROUP (0x200)`。依 Microsoft 文件，該旗標只會禁用群組內 CTRL+C，**不會脫離 parent console 的 CTRL_CLOSE_EVENT**。必須改用：
     `DETACHED_PROCESS (0x8) | CREATE_NEW_PROCESS_GROUP (0x200)`
     搭配 `STARTF_USESTDHANDLES` 將 stdout/stderr 導向 log 檔。這樣子程序不繼承啟動視窗的 console，視窗關閉後仍存活（8110 與 8111 都受保護）。

2. **追蹤「真正的監聽 PID」**
   - 啟動後用 `Get-PortOwner` 解析 8110/8111 實際監聽 PID 寫入 state，而非使用 `Start-Process` 回傳的 PID（監測證明兩者不同）。修復 check / stop 誤判。

3. **STOP 改為「以埠為準」**
   - `stop_demo.ps1` 除 state 裡的 PID 外，再用 `Get-PortOwner` 解析目前埠持有者並停止（保留「僅 python 才終止」安全檢查），確保關閉視窗後殘留的孤兒服務也能被清掉。

4. **START 接管 / 復用**
   - 若埠已被 DEMO 服務持有（前次關閉視窗留下的孤兒），直接復用，而非報衝突或重複綁定。

5. **Live Coach（`/live/` OFFLINE）保持不展示**
   - 屬外部 LLM，超出本次範圍，標註「暫不演示」。

---

## 四、修復後的驗收方式（關鍵：這次要真的測「關窗」）

- 修復後的 10 分鐘常駐測試必須改寫監測腳本：
  1. 啟動 DEMO；
  2. **監測程序主動結束自己的啟動殼層（模擬使用者關閉 START 視窗）**；
  3. 再以獨立程序在 T+0 / +1 / +5 / +10 min 探測 8110 / 8111 是否仍監聽；
  4. 用**真實 Chrome** 驗證頁面確實取到 API 資料（不只是 HTTP 200）。
- 只有「關窗後」仍全綠，才算修復成功。
- 接著做人工操作驗收（真實 Chrome 雙擊啟動 → 關閉視窗 → 再開瀏覽器驗證）。

---

## 五、合規聲明

- 未重啟服務、未清除現場證據（`monitor.log` 原樣保留）。
- 不動正式 DB、v1.5C、正式 8022 / 8770、正式 Cloudflare / Worker / Tunnel。
- 不新增產品功能。

---

## 六、待確認

請確認是否按此方案修復。確認後我將：
1. 改 `Start-DemoServer` 旗標為 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`；
2. 接線進 `start_demo.ps1`；
3. 改 stop / start 的 PID 追蹤與接管邏輯；
4. 重寫監測腳本以「關窗」為前提；
5. 重跑 10 分鐘常駐測試 + 真實 Chrome 人工驗收；
6. 產出 `DEMO_STABILITY_REPORT.md`。

> 附註：背景任務 `ANpiju`（埠 8101、FDE_DEV_MODE 的獨立 uvicorn）已依指示取消，未重啟。該任務與本次 8110/8111 DEMO 故障無關。
