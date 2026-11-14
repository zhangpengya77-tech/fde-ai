# FDE-GCS 安全報告（截至 P3）

- 日期：2026-11-13
- 範圍：`student_portal/gcs_portal/`（P1～P3）

## 1. 威脅與對策

| 威脅 | 對策 | 驗證 |
|---|---|---|
| 從網路遠端控制真機 | 真機資料只走「瀏覽器 ↔ USB」，伺服器不經手任何 MAVLink 封包，也沒有轉發通道 | 架構；伺服器端沒有任何 MAVLink 程式 |
| 送出危險指令（解鎖、模式切換、起飛、返航、降落、馬達測試、校準、重啟） | 編碼器白名單：只能送心跳、參數讀取、SET_MESSAGE_INTERVAL、REQUEST_MESSAGE | 單元測試逐一確認被拒；模擬飛控收到 0 則不允許訊息 |
| 未經批准寫入參數 | PARAM_SET 需要寫入能力物件，只有 writer.js 使用，而且要先通過六道檢查 | 8 種條件不符的單元測試都確認沒有送出 |
| 修改安全相關參數 | 版本化白名單（9 個 PID）＋程式寫死的禁止清單；伺服器載入白名單時會檢查兩者沒有交集 | Django 測試 |
| 解鎖狀態下寫入 | 寫入前即時檢查心跳的 ARMED 旗標 | 單元測試＋端到端（已解鎖的模擬飛控收到 0 次 PARAM_SET） |
| 批准被重複使用或過期使用 | 批准 10 分鐘內有效，回報結果後狀態結束，不能再回報 | Django 測試 |
| 偽造寫入成功 | 伺服器自己比對讀回值和新值，不一致一律記為失敗 | Django 測試 |
| 跨班級查看或批准 | 學員只看自己的申請；教師只看 `TeacherCohortAccess` 指派且已開放的班級 | Django 測試 |
| CSRF | 所有寫入 API 使用 Django CSRF；頁面以 `data-csrf` 提供 token | Django 測試（缺 token 回 403） |
| XSS、第三方腳本 | `/gcs/` 的 CSP：`default-src 'none'; script-src 'self'; style-src 'self'`；介面用 `textContent` 顯示資料，不插入 HTML | Django 測試＋端到端主控台零錯誤 |
| COM 埠授權外洩或被搶 | 每次手動選擇、不呼叫 `getPorts()`、中斷時 `forget()`；被占用時只提示不重試 | 單元測試＋端到端 |
| 功能誤開 | Feature Flag 預設關閉；學員還要在開放的班級裡 | Django 測試 |

## 2. 已知限制

1. **瀏覽器端檢查無法由伺服器強制**：寫入在學員電腦上發生。伺服器能控制「誰、何時、哪一筆」可以寫，但無法阻止有能力修改自己瀏覽器程式的人直接送封包。教室使用時，靠教師在場監督、拆槳規定和完整紀錄來補足。
2. **白名單範圍尚未經教師確認**。
3. **寫入後沒有自動還原**：若寫入的值不理想，要再走一次申請流程改回。

## 3. 尚未驗證（需本機）

真實 Windows Chrome／Edge 的 Web Serial、Pixhawk 2.4.8 讀寫、拔除 USB、COM 埠被占用、ArduPilot SITL。步驟見 `FDE_GCS_USB_MAVLINK_TEST.md` 第 4 節與 `FDE_GCS_P3_REPORT.md` 第 7 節。
