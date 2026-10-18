# FDE-AI-UAS 2.0 ｜ 展示封版狀態（DEMO_READY_STATUS）

> 產出時間：2026-10-09（出門前緊急收尾與展示封版）
> 範圍：限 DEMO 環境，不含正式產品功能 / 正式資料庫 / v1.5C。

---

## 1. 展示版狀態：READY

五項功能全部通過真實 Chrome + 已驗證 session 驗收（5 / 5 PASS）。
唯一現場注意事項：啟動後**務必保持 START 視窗開啟**（見第 9 項說明）。

---

## 2. 五項功能驗收結果（真實 Chrome / 已登入 session）

| 功能 | 網址 | 結果 | 說明 |
|------|------|------|------|
| 首頁 | http://127.0.0.1:8111/ | **PASS** | HTTP 200，標題「FDE-AI \| 無人載具學習控制中心」 |
| 學員登入 | http://127.0.0.1:8111/login/ | **PASS** | 登入後落地 /student/，sessionid 已發給，儀表板 200 |
| 學員成長紀錄 | http://127.0.0.1:8111/student/growth/ | **PASS** | 登入後自動重定向至 /student/courses/1/growth/，HTTP 200，內文 6400 字（真實內容，非連線拒絕） |
| 教師後台 | http://127.0.0.1:8111/teacher/ | **PASS** | 經 /teacher/login/ 登入後落地 /teacher/，HTTP 200，內文 3599 字 |
| 下載中心 | http://127.0.0.1:8111/downloads/ | **PASS** | 頁面 HTTP 200；/api/downloads 回傳 JSON 含種子檔案（FDE-AI YOLO 等），API 200 |

> 備註：成長紀錄為「課程導向」設計，進入 /student/growth/ 後會依學員第一期別自動跳轉至
> /student/courses/<enrollment_id>/growth/。未登入時會被導向登入頁（這是正常行為，非故障）。

---

## 3. 啟動檔（START）完整路徑

```
D:\FDE-AI-UAS-v2.0\demo\START_FDE_2_DEMO.cmd
```

雙擊執行即可。啟動約 20–30 秒後服務就緒。

---

## 4. 停止檔（STOP）完整路徑

```
D:\FDE-AI-UAS-v2.0\demo\STOP_FDE_2_DEMO.cmd
```

（附）健康檢查：`D:\FDE-AI-UAS-v2.0\demo\CHECK_FDE_2_DEMO.cmd`

---

## 5. 首頁網址

```
http://127.0.0.1:8111/
```

---

## 6. 學員 / 教師登入方式（不寫入密碼）

- **學員登入**：瀏覽器開啟 http://127.0.0.1:8111/login/ → 輸入學員種子帳號與密碼登入。
- **教師登入**：瀏覽器開啟 http://127.0.0.1:8111/teacher/login/ → 輸入教師種子帳號與密碼登入。
- 帳號為 DEMO 種子帳號（student / teacher 各一組），登入憑證請見現場交付單 / 種子設定檔，**本報告不記錄密碼**。
- 登入後即可在學員首頁點擊「我的學習成長日誌」進入成長紀錄；教師登入後進入教師後台。

---

## 7. 明天現場無法展示的項目（標記「不展示」）

以下項目依收尾指令排除，不納入展示、亦不偽造成功：

- Live Coach 即時 AI 助教（手機攝影機 → Gateway → 推論 → overlay）
- Golden Test 推論 / 模型驗證流程
- YOLO 訓練
- ACTIVE 正式發布流程
- RTK 相關功能
- 其餘未完成整合項目

> 展示僅限上述五項功能（首頁 / 學員登入 / 成長紀錄 / 教師後台 / 下載中心）。

---

## 8. 服務若崩潰的 2 分鐘復原步驟

1. 先確認 `START_FDE_2_DEMO.cmd` 的視窗是否仍開著——**務必保持開啟**，關閉會殺掉 Django。
2. 若首頁連不上且視窗已被關閉：
   - 雙擊 `STOP_FDE_2_DEMO.cmd` 清理殘留程序（只停 DEMO 程序，不動其他 Python）。
   - 再雙擊 `START_FDE_2_DEMO.cmd` 重新啟動。
   - 約 20–30 秒後重開 http://127.0.0.1:8111/ 。
3. 若 Live(8111) 在但 Django(8110) 掛掉：同樣 STOP → START 一次即可。
4. 復原後可雙擊 `CHECK_FDE_2_DEMO.cmd` 確認兩埠皆 LISTENING、五頁皆 200。

---

## 9. 是否動到正式環境 ＋ 檢查結果

**未動到正式環境。**

- 正式 Django `:8022`、正式 RAG `:8770` 全程**未停止、未修改、未重啟**；驗收前後均處於 LISTENING，PID 與啟動前一致。
- v1.5C 穩定分支、正式 GitHub Pages、正式 Cloudflare Worker / Tunnel / 入口網址、正式資料庫**均未變更**。
- 本次僅啟動 DEMO 用 Django(`:8110`) 與 Live Backend(`:8111`)，且二者皆為 DEMO 專用程序。

### 啟動方式說明（重要）

- 新版「關閉視窗後仍能存活」的 detached 啟動（Win32 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`）
  因本沙箱工具禁止執行 `Add-Type`（.NET 執行期編譯）而無法在此環境驗證。
- 已依指示**回退為先前通過 10 分鐘監測的啟動方式**：plain `Start-Process` 啟動並**保持服務視窗開啟**。
- 此方式功能完整、五項驗收全 PASS；唯一代價是視窗關閉會連帶結束 Django，故現場請保持視窗開著（見第 8 項）。

---

## 驗收證據

- `demo/runtime/logs/acceptance_auth.json`：五項功能 5/5 PASS（已驗證 session）。
- `demo/runtime/logs/acceptance_final.json` + `demo/screenshots/`：真實 Chrome 截圖與落地網址。
- 埠檢查：8110 / 8111 / 8022 / 8770 均 LISTENING（前二者 DEMO，後二者正式、未動）。
