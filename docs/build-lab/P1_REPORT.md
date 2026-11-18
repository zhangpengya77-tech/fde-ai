# 組裝實訓室｜P1 組裝引擎報告

日期：2026-11-19　分支：`feat/build-lab-r2`（`D:\FDE-AI-build-lab`）　方案：A（原生 ES Modules＋three.js r181，已批准）

## 狀態

| 項目 | 狀態 |
|---|---|
| 3D 場景（淺色網格、旋轉縮放平移、視角 俯視／側視／等角） | PASS（無頭瀏覽器截圖確認） |
| 零件庫（搜尋、四類篩選、程式產生縮圖、已安裝狀態、下一個建議） | PASS |
| 步驟列與步驟清單（第 n 步／共 N 步、進度條） | PASS |
| 下一步安裝（動畫）、上一步、全部顯示、拆解全部、爆炸視圖、隱藏已安裝 | PASS |
| 拖放＋吸附＋位置校驗（容許 18 mm） | PASS（差 336 mm 判錯、拖到正確位置安裝成功） |
| 依賴檢查（上板前要先放好上下板之間的零件、槳最後裝） | PASS |
| 撤銷／重做（Ctrl+Z／Ctrl+Y，含整批拆解） | PASS |
| 本機自動儲存、重新整理後恢復、匯出／載入 JSON | PASS（重新整理後恢復 1 件） |
| 學習／自由組裝／考試 模式切換 | PASS（考試隱藏提示與虛影；完整計分屬 P4） |
| 完成畫面（零件數、錯誤統計、用時、匯出） | PASS |
| 手機（390 寬）：抽屜、無水平溢出 | PASS（只驗證檢視；觸控拖放未實機測） |
| 零件尺寸 | **待確認**（通用件估計值；馬達編號與旋向依 ArduPilot，PENDING_MANUAL） |
| 實機手機、實際觸控操作 | PENDING_MANUAL（須由人實測） |

## 測試

- 單元測試：`f450-twin/build-lab` 內 `node --test tests/*.test.js` → **13／13 通過**（依賴、位置、撤銷重做、拆解、存檔竄改防護、Quad X 編號旋向、箭頭方向）。
- 無頭瀏覽器冒煙測試（Playwright 1.64.1＋SwiftShader，預覽 `http://127.0.0.1:8095`）：載入、27 張縮圖、下一步安裝、順序錯誤提示、撤銷／重做、全部顯示→完成畫面、爆炸、俯視、拖放錯誤與正確、重新整理恢復、手機版面；**主控台 0 個錯誤**。
- 測試中發現並修正：
  1. 零件卡片縮圖被瀏覽器當成原生拖曳圖片，吃掉拖放事件 → 停用縮圖原生拖曳。
  2. 飛控與 GPS 的箭頭指向機尾 → 改為指向機頭並加測試。

## 新增檔案（全部在 `f450-twin/build-lab/`，未改任何既有檔案）

```
index.html  build-lab.css  build-lab-flags.js（入口開關 entryVisible:false）  package.json（只給 node 測試用）
core/assembly-engine.js  core/scene.js  core/parts-gen.js  core/storage.js
data/f450-pixhawk248.js
ui/app.js
tests/assembly-engine.test.js
```

## 未改動

正式站、網站其他頁面、舊版數位孿生、Live 後端、Gateway、Worker、學員資料庫；未 push／merge／deploy。網站上沒有任何新入口（開關預設關閉）。

## 預覽方式

在 `D:\FDE-AI-build-lab` 執行 `python -m http.server 8095 --bind 127.0.0.1`，瀏覽器開 `http://127.0.0.1:8095/f450-twin/build-lab/`。

## 回滾

刪除 `f450-twin/build-lab/` 資料夾即可；分支未合併，正式站不受影響。

## 下一階段（P2）需要的資料

實際套件的機架／電機／電調／電源模組／GPS／接收機／數傳廠牌型號、Pixhawk 2.4.8 克隆版來源、ArduPilot 韌體版本（見 DIMENSION_SOURCES.md）。沒有的話 P2 會先用通用件並標「待確認」。
