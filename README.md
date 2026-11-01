# FDE-AI-UAS 2.0 正式發布版

AI 驅動的無人載具人才培養與職業能力驗證平台。

- 版本：**v2.0.0**（Git 標記 `v2.0.0`）
- 開發分支：`fde-ai-v2.0`
- 公開網站（GitHub Pages）來源：`public-site/v2/`

## 取得程式碼繼續開發

```bash
git clone https://github.com/zhangpengya77-tech/fde-ai.git
cd fde-ai
git checkout fde-ai-v2.0
```

只要下載 2.0 正式版的固定快照：`git checkout v2.0.0`。

## 開始前必讀

| 文件 | 內容 |
|---|---|
| `AGENTS.md` | 開發規則：最小修改、保護區（v1.5C 唯讀、Flight Health、MP-12）、未經同意不 commit／push |
| `PROJECT_CONTEXT.md` | 專案背景 |
| `V2_ARCHITECTURE.md`、`docs/architecture/` | 2.0 架構與模組整合 |
| `DEV_HANDOFF.md`、`docs/AI_HANDOFF.md` | 開發交接、服務埠號、已知問題 |
| `FDE_2_0_FINAL_CLOSURE_REPORT.md` | 2.0 驗收報告 |

## 主要模組

| 目錄 | 說明 |
|---|---|
| `student_portal/` | Django 學員／教師平台（啟動方式見 `student_portal/README.md`） |
| `live_backend/` | Live Coach 後端（`pip install -r live_backend/requirements.txt`） |
| `flight-health/` | 飛行健康 AI：上傳 ArduPilot `.bin` 日誌，8 張健康卡（電池與供電、馬達輸出、振動、姿態追蹤、事件與失效保護、GPS、羅盤、EKF） |
| `public-site/v2/` | GitHub Pages 靜態網站 |
| `demo/` | DEMO 隔離環境與驗收工具（Windows PowerShell） |
| `ops/` | 課堂啟動／停止腳本 |

飛行健康模組可單獨在本機試跑：

```bash
cd flight-health
python -m unittest test_engine_resolver
python reference_server.py   # 瀏覽器開 http://127.0.0.1:8040/index.html
```

## 不在倉庫內的東西

以下需向專案負責人另外取得，不會隨程式碼下載：

- YOLO 模型權重 `best.pt`
- DEMO 帳號密碼（由環境變數或 `~/.fde-demo-credentials/` 提供，見 `demo/tools/demo_credentials.py`）
- 教師診斷主機（:8040 正式版）與下載中心檔案
