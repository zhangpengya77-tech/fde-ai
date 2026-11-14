# FDE-GCS P4／S6：多機 SITL 仿真與編隊

- 日期：2026-11-14
- 分支：`feat/fde-gcs-sitl-fleet`（從 `feat/fde-gcs-web-v1` 849ae29 開出，不影響真機驗收分支）
- 範圍：「04 仿真與航線」接入多機 SITL。學員唯讀，教師持短效控制票控制；考照場景 3D 同步顯示

## 1. 本輪範圍

| 項目 | 內容 |
|---|---|
| 本輪目標 | 在 FDE-GCS 頁面看多機 SITL 遙測與考照場景；教師可一鍵起飛、編隊、開始任務、降落、返航 |
| 允許修改 | `gcs_portal/`（新增 `sitl_api.py`、`sitl.js`、測試；`urls.py`、`views.py`、`home.html` 04 區塊、`gcs.css`）、`settings.py` 三個設定、新增 `gcs-gateway/` |
| 禁止修改（已遵守） | models／migrations、登入流程、真機 Web Serial 與白名單寫入、Flight Health、MP-12、v1.5C、`cloudflare/` |

## 2. 架構

```text
瀏覽器 /gcs/ ──同源 POST──→ Django：/gcs/api/sitl/ticket/（HMAC 簽章，10 分鐘）
     │                               學員只能拿 read；教師可拿 control
     ├──WebSocket（帶票）──→ gcs-gateway  ws://127.0.0.1:8261
     │                         ├─ 只連本機 SITL：tcp:127.0.0.1:5763+10i（寫死，不能改成序列埠或遠端）
     │                         ├─ read：只收遙測；control：每個指令都重驗到期與撤銷
     │                         └─ 撤銷：http://127.0.0.1:8361/revoke（X-Gateway-Secret，Django 呼叫）
     └──iframe──→ 考照場景  http://127.0.0.1:8252/?mode=exam&engine=sitl_follow&embed=1
                    └─ 唯讀轉接程式 ws://127.0.0.1:8263（SERIAL1，與 Gateway 分開）
```

- 埠位依原架構：Gateway 8261；8262 保留給 MAVLink 分流；考照場景轉接程式移到 8263。
- 沒有設定 `FDE_GCS_GATEWAY_SECRET` 時，04 區塊顯示「尚未設定」，不簽發任何票證，CSP 維持原本嚴格政策。
- 設定之後，CSP 只多加兩個來源：`connect-src` 加 Gateway、`frame-src` 加考照場景。

## 3. 功能

- **遙測表**（唯讀票即可）：各機模式、解鎖、高度、速度、電量、GPS；斷線時清空，不保留舊值。
- **教師控制**（控制票）：
  - 一鍵起飛（3～30 m）；
  - 開始任務：先起飛再切 AUTO，所以航線不必以 TAKEOFF 開頭；
  - 原地停住（BRAKE）、全部降落、全部返航。
- **編隊**：一字、三角、縱隊，可設間距與朝向。領航機帶隊沿正方形飛（加減速平滑，以飛控模擬時鐘推進），或原地保持隊形；頁面即時顯示各僚機的隊形誤差。
- **撤銷**：教師按「撤銷所有控制權並停住」後：
  - 所有控制連線立刻關閉（4003）；
  - 舊控制票再連線回 401；
  - 全部飛機切 BRAKE 停在原地。

## 4. 驗證（本機，3 架 ArduCopter SITL V4.8.0-dev）

| 項目 | 結果 |
|---|---|
| Django `gcs_portal` 測試 | 61／61 通過（新增 8 項）；有無 Gateway 金鑰環境變數都通過 |
| Gateway 單元測試 | 4／4 通過（簽章、過期、撤銷、範圍、隊形偏移） |
| 協定端對端（Django 發票 → Gateway → SITL） | 通過：無效票 401；唯讀票控制被拒；起飛 3 架到 8 m；三角編隊正方形 37 秒、僚機最大誤差 0.49 m；撤銷 200、連線 4003、舊票 401、三架 BRAKE；全部返航落地 |
| 介面端對端（無畫面 Chrome，教師 session） | 通過：連線 → 取得控制權 → 一鍵起飛 → 開始編隊 → 全部返航；沒有 CSP 違規或程式錯誤 |
| 考照場景 | 嵌入版面：俯視、3D 填滿，三角隊形、隊形線、目標圈、機間距離同步顯示（`P4_sitl_fleet_formation.png`） |

## 5. 本機啟動

1. 3 架 SITL ＋ 考照場景：在 FDE-Sim-SITL-Mode 雙擊 `tools\sitl-mode\啟動多機SITL(3架).bat`。
2. Gateway（需要 `pymavlink`、`websockets`）：
   ```
   set FDE_GCS_GATEWAY_SECRET=<至少 16 字元，與 Django 相同>
   python gcs-gateway\fde_gcs_gateway.py --count 3 --formation-file D:\FDE-Sim-SITL-Mode\.sitl-run\formation.json
   ```
3. Django：設定 `FDE_GCS_ENABLED=1`、同一把 `FDE_GCS_GATEWAY_SECRET`，以教師登入開 `/gcs/`。

## 6. 尚未完成／限制

- **控制票只發給教師**。「教師授權某位學員短時間控制」還沒做（需要新的授權紀錄，會動到 models，留待下一輪）。
- **航線上傳與任務結果紀錄（S3）**還沒做：「開始任務」執行的是 SITL 上現有的航線。
- **Gateway 與示範／驗收腳本共用腳本埠（5763+10i）**，同時只能跑一個。
- 正式站部署：Gateway 只綁 127.0.0.1，只適用於本機教室電腦；雲端版需要另外設計。
- iframe 使用 `sandbox="allow-scripts allow-same-origin"`。考照場景與網站不同來源時沒有沙箱逃逸問題；若日後改成同源（例如 `/sim/`），要重新評估。
