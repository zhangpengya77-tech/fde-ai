# FDE-AI-UAS 2.0 DEMO｜最終交付報告（限時收尾模式）

> 時間：2026-10-09 09:5x（GMT+8）｜範圍：僅 DEMO 啟動/路由最小修復，不動 prod / v1.5C / 正式 8022·8770 / Cloudflare。
> 依用戶指令：停止迴圈、保存成果、明確交付狀態；10 分鐘穩定性測試依指示標為「待驗證」。

---

## 當前狀態（即時檢查）
- **無正在運行的 DEMO 子任務**：背景任務 `n4j1jv`（監測）已於 08:30 結束；`ANpiju`（埠 8101 獨立 uvicorn）已依指示取消。
- **8110 / 8111 目前均未監聽**（監測結束後其子程序被一併回收）。無卡住 / 孤兒 DEMO 程序。
- **正式服務正常在線且未被觸碰**：`:8022`（PID 21360）、`:8770`（PID 14640）。
- **等待批准狀態說明**：上一輪「等您確認修復方案」已因您切換到收尾模式並授權修復 Start-DemoServer 而解除。剩餘待辦均為「需您在實機執行的驗收步驟」（見第 7 項），非「待我方繼續」。

---

## 1. 完成百分比
**約 88%** — DEMO 啟動/路由最小修復的程式碼已完成並通過語法檢查；剩餘為「關窗後服務存活」的實機驗證（依指示標為待驗證）。

## 2. 已完成的功能
- **根因分析**：雙擊 `START_FDE_2_DEMO.cmd` 啟動視窗關閉 → console / process group 被拆除 → DEMO 服務被帶走（首頁 8111 偶存活、Django 8110 路由拒絕連線）。
- **最小修復已落地（DEMO-only）**：
  - `Start-DemoServer`（Win32 `CreateProcess`）改用 **`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`**，使服務脫離啟動視窗的 console，關窗後仍存活。
  - 修正先前只用 `CREATE_NEW_PROCESS_GROUP`（僅禁 CTRL+C，不脫離 parent console 的 CTRL_CLOSE_EVENT）的不足（已查證 Microsoft 文件）。
  - `start_demo.ps1` 改用 `Start-DemoServer` 啟動 Django 與 Live Backend，並在健康檢查後以 `Get-PortOwner` 記錄「真正監聽的 PID」（修復 monitor.log 中 25920 ≠ 19276 的追蹤錯誤）。
  - `stop_demo.ps1` 增加「以埠為準」停止，可清掉關窗後殘留的孤兒服務（僅限 python）。
- 三個腳本通過 PowerShell 語法解析檢查（無錯誤）。
- 已產出根因與修復方案文件。

## 3. 尚未完成 / 待驗證
- **關窗後存活驗證（原 10 分鐘穩定性測試）**：依您的指示標為 **待驗證**。原因：我的驗證沙箱禁止 `Add-Type`（Win32 P/Invoke 機制），無法在此實跑 detached 啟動；該限制只存在於我的工具環境，您的實機雙擊 PowerShell 可正常執行 `Add-Type`。請在您的 Windows 實機做展示彩排確認。
- Live Coach（`/live/` OFFLINE，外部 LLM）保持「暫不演示」，不在本次範圍。

## 4. DEMO 是否可以啟動
- 程式碼層面：**可以**（啟動腳本會以 detached 方式啟動 8110 / 8111）。
- 我的沙箱：**無法實跑驗證**（Add-Type 被禁）；但先前監測已證明啟動邏輯、環境隔離、健康檢查、五個頁面與真實 Chrome 登入均正常（全綠），本次僅變更「啟動方式」。
- 請您實機雙擊 `demo\START_FDE_2_DEMO.cmd` 確認。

## 5. 已驗證的服務埠與測試結果
- 既有監測（任務 `n4j1jv`，08:18–08:30，全綠）：8110/8111 監聽；home / login / student_growth / downloads / api-downloads / live-health / django-login 均 HTTP 200；真實 Chrome 學員/教師登入成功並取得資料。
- 當前實機檢查：8110/8111 未監聽（乾淨）；正式 8022/8770 在線且未被影響。
- 三腳本語法檢查：**PASS**。

## 6. 修改過的檔案路徑
- `D:\FDE-AI-UAS-v2.0\demo\tools\demo_common.ps1`（Start-DemoServer：DETACHED_PROCESS 旗標 + 常數 + 註解）
- `D:\FDE-AI-UAS-v2.0\demo\tools\start_demo.ps1`（Django/Live 改用 Start-DemoServer，記錄真實監聽 PID）
- `D:\FDE-AI-UAS-v2.0\demo\tools\stop_demo.ps1`（以埠為準停止孤兒服務）
- `D:\FDE-AI-UAS-v2.0\demo\DEMO_ROOTCAUSE_AND_FIXPLAN.md`（根因與修復方案）
- 先前輪次（本次未更動）：`monitor_demo_stability.ps1`、代理清除修復（同 demo_common）、`AGENTS.md`、`FDE-DEVELOPMENT-CHARTER.md`

## 7. 尚待您批准 / 執行的事項
- **您實機雙擊 `demo\START_FDE_2_DEMO.cmd` 啟動 → 關閉視窗 → 於 1 / 5 / 10 分鐘後用真實 Chrome 驗證 8110/8111 仍可用，學員登入、教師登入、成長紀錄、下載清單均正常**（即原 10 分鐘常駐測試，標為待驗證）。
- 執行 `demo\STOP_FDE_2_DEMO.cmd` 確認 DEMO 程序全部停止；再次 `START` 確認可重啟。
- 未執行 Git 提交 / 推送 / 部署 / 刪除 / 重置（依指示需您批准）。

## 8. 最終狀態：PARTIAL
- 程式碼修復完成且通過語法檢查；但「關窗後服務存活」此一關鍵行為無法在我的沙箱實跑（Add-Type 限制），必須由您在實機展示彩排中確認。完成彩排且全綠後，即可判定為 **PASS**。
