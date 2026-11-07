# 部署報告（REA 考照模擬器）

## 實際發布路徑（已查證）
- GitHub Pages 建置方式：**GitHub Actions**（`gh api …/pages` → build_type = workflow）。
- 觸發分支：`codex/github-pages-public`；工作流程 `.github/workflows/deploy-public-site.yml` 只上傳 `public-site/` 資料夾。
- `public-site/v2/sim/app/` → https://zhangpengya77-tech.github.io/fde-ai/v2/sim/app/
- 舊的 `gh-pages` 分支（2026-10-25）不再是發布來源，本次不動。

## 版本
| 項目 | 值 |
|---|---|
| 模擬器原始碼 | `D:\FDE-REA-Exam-Sim`，分支 `feat/rea-exam-simulator`（基於 `feature/pen-phone-input` 08b3f54） |
| 網站 | `D:\FDE-AI-sim-rea`，分支 `feat/rea-exam-simulator`（基於 `origin/codex/github-pages-public` 99ef710） |
| 變更範圍 | 只有 `public-site/v2/sim/app/`（建置產物）與 `public-site/v2/sim/index.html`（考照卡片說明＋舊版連結） |

## 測試結果（2026-11-07，本機）
| 測試 | 結果 | 證據 |
|---|---|---|
| 單元測試（全套，含 47 項 REA） | 847 / 847 通過 | `npx vitest run` |
| 瀏覽器回歸（桌機，全套） | 80 通過、2 跳過（既有「需真實硬體」占位）、0 失敗 | `evidence-browser-regression-desktop.txt` |
| REA 瀏覽器測試（手機 iPhone 13 模擬） | 8 / 8 通過 | `evidence-browser-rea-mobile.txt` |
| 型別檢查 `tsc -b` | 通過 | — |
| 截圖 | 設定、示範飛行、評等回放、I2 俯視（桌機＋手機） | `screenshots/` |

舊版考試瀏覽器測試（exam-drone／ground-check／smoke／subject-f）只把網址從 `?mode=exam` 改為 `?mode=exam-legacy`（8 行），斷言完全未改，全部通過。
真實 USB 遙控器、鏡頭原子筆、手機配對、教師電腦關機情境：**未自動驗證，列為人工驗收**。

## 部署計畫（需教師批准後執行）
1. 把網站分支的變更合併／推送到 `codex/github-pages-public` → Actions 自動部署（約 1–2 分鐘）。
2. 線上驗證：`/v2/sim/`、`/v2/sim/app/?mode=exam&exam=0`、`?mode=exam-legacy`、首頁、課程、F450 數位孿生。
3. 失敗即回滾。

## 一鍵回滾
```bash
git -C D:/FDE-AI push origin 99ef710:codex/github-pages-public --force-with-lease
```
（把發布分支退回部署前的 99ef710，Actions 會重新部署舊版。執行前需再確認。）
更溫和的方式：在網站分支 `git revert` 本次提交後推送。

## 不受影響
登入、Gateway、資料庫、AI 電力巡檢、學員上傳與權限隔離：本次**沒有修改任何後端或其他頁面**。
