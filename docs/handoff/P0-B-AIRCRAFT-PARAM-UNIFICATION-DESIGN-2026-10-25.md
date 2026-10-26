# P0-B 機體參數一致性設計（第三輪任務 B）

- 日期：2026-10-25
- 工作樹：`D:\FDE-Power-Inspection-Simulator-P0`（分支 `codex/fde-p0-visibility`，HEAD `eb242c7`）
- 性質：**只讀調查 + 設計**，本輪不修改任何原始碼
- 基線備份：`D:\FDE-REA-Review\backups\P0-BASELINE-20261025-041229\`

---

## 一、調查結論（現狀）

### 1.1 `diagonalSpanCm` 定義與使用位置

| 位置 | 內容 | 讀取端 |
|---|---|---|
| `config/exam-aircraft.json` `.sampleAircraft.diagonalSpanCm` | `{ value: 100, rangeCm: [90,110], source: 附件十二級別I（PDF p35／印刷頁33）, adjustable: true }` | **無**（`loadExamAircraftParams()` 只取 8 個飛控欄位，不含軸距） |
| `config/caa-exam.json` `.aircraft.sampleAircraftDefaults.diagonalSpanCm` | `100` + `diagonalSpanRangeCm: [90,110]` | **無**（`loadExamConfig()` 不讀 `aircraft` 鍵，整段為死數據） |
| `src/` 全域 | **零引用**（grep 僅命中兩份 JSON 與 Round 2 報告） | — |
| `src/exam/scene.ts` `createExamQuad()` | `Math.cos(angle) * 0.5` → 馬達半徑 0.5m → **對角 1.00m 硬編碼**（:198-199） | 場景建構 |

### 1.2 雙配置源現狀

```
config/caa-exam.json .aircraft             （官方權威檔意圖；含 sampleAircraftDefaults；無讀取端）
  ├─ massKg: 4.0                    ← 官方可核實（附件十二）
  ├─ diagonalSpanCm: 100 (90–110)   ← 官方可核實（附件十二）
  └─ maxTiltDeg/maxSpeed/accel/drag: null   ← 待原廠規格

config/exam-aircraft.json .sampleAircraft  （實際生效源；loadExamAircraftParams() 唯一讀取）
  ├─ massKg 4.0 / diagonalSpanCm 100   ← 與上方重複定義（無交叉校驗）
  ├─ maxTiltDeg 25 / maxSpeed 8 / accel 2.5 / drag 0.6 / inertia τ… ← 模擬假設（非官方）
  └─ meta.constraint：「考試機用本獨立參數檔疊加」
```

**分歧風險**：同一官方數值（4kg／100cm）存兩處且無校驗；模擬假設值只在 exam-aircraft.json，caa 側為 null——未來原廠規格填入 caa 側時，兩源對同 4 字段一 null 一有值，**沒有消歧規則**。

### 1.3 飛控依賴（`src/exam/flight-controller.ts`）

| 參數 | 使用位置 | 語意 |
|---|---|---|
| `maxTiltDeg` | :265, :317-318 | 傾角上限；加速度 = (傾角/maxTilt) × accelerationMps2 |
| `attitudeRateLimitDegPerS` | :266, :285-290 | 傾角變化速率上限 |
| `attitudeTimeConstantS` | :285, :290 | 姿態一階滯後 |
| `accelerationMps2` | :316-318 | 加速度上限 |
| `dragCoefficient` | :328 | 無推進時速度衰減 |
| `maxHorizontalSpeedMps` | :313 | 水平速度上限 |
| `horizontalVelocityTimeConstantS` | :356-363, :419 | 水平/垂直速度一階滯後 |
| `massKg` | **無使用**（僅 config→型別傳遞） | 飛控為傾角-加速度比例模型，不經質量 |

**軸距不參與飛控動力學**——它是「規格/視覺」屬性，與飛控 8 參數正交。

### 1.4 視覺模型與註釋瑕疵

- `scene.ts:148` 與 `:372` 註釋均寫「馬達對角約 1.1m」，實際硬編碼為 **1.00m**（官方 90–110cm 區間中值）——文字與實作不符。
- `scene.ts:372`：「尺寸對照附件十二級別 I 樣機軸距 90–110cm（馬達對角約 1.1m）」。

### 1.5 官方依據與適用類別

- 附件十二（遙控無人機管理規則，109.3.31 施行）級別 I：「對角馬達之軸心距離介於九十公分至一百一十公分；起飛重量 ≧4 公斤」（PDF 第 35 頁／印刷頁 33）。
- 鏡像 PDF 已核驗：SHA-256 `7b4e8f616be70d10f02a0f372f811cb33871513393b8eab55db7bc621b589fd3`／755,420 bytes／42 頁（2026-10-23）；**官方發布版原檔連結 404，法規數值維持「待官方原檔核驗」標註**。
- 適用類別：專業操作證**基本級（多旋翼）級別 I**（未達 25 公斤、≥4kg）。級別 II/III（25–150kg／>150kg）之樣機軸距規格**未核實**（附件十二各級別完整規格表未逐項核對）。

---

## 二、單一參數來源方案（設計，不修改）

### 2.1 權威分層

| 層 | 內容 | 權威檔 | 標註 |
|---|---|---|---|
| L0 | 官方規範數值（附頁碼） | `caa-exam.json` | 唯一權威；讀不到留 null |
| L1 | 附件十二樣機規格（massKg／diagonalSpanCm） | `caa-exam.json .aircraft.sampleAircraftDefaults`（**激活讀取**） | 官方（待原檔核驗） |
| L2 | 飛控動力學模擬假設（maxTilt/maxSpeed/accel/drag/inertia） | `exam-aircraft.json .sampleAircraft` | 模擬假設，非官方，可調 |

### 2.2 讀取鏈（`loadExamAircraftParams()` 擴展設計）

```
diagonalSpanCm:
  caa-exam.json .aircraft.sampleAircraftDefaults.diagonalSpanCm（數字）
    → exam-aircraft.json .sampleAircraft.diagonalSpanCm.value
    → 100（硬編碼兜底 + console.warn「兩處配置均缺失，使用兜底值」）

飛控 8 參數：維持 exam-aircraft.json（caa 側現為 null）
  但每次載入交叉比對：若 caa 側由 null 變為數字 → 以官方值為準並告警
  （原廠規格到手時的自動消歧路徑，無需改碼）
```

### 2.3 型別與場景參數化

- `ExamAircraftParams`（`src/exam/types.ts`）新增：
  - `diagonalSpanCm: number`（規格/視覺欄位，註釋明確「不參與飛控動力學」）
  - `diagonalSpanRangeCm: [number, number] | null`（官方區間，供 UI 顯示與範圍校驗）
- `scene.ts createExamQuad(track, motorRadiusM?)`：
  - 由參數計算 `motorRadiusM = diagonalSpanCm / 100 / 2`（對角軸心距 = 2 × 馬達半徑；100cm → 0.5m）
  - 參數缺省時回退 0.5（現值）——**不破壞現有行為**，呼叫方由 config 供值。
- 純函式 `motorRadiusFromDiagonalSpanCm(cm: number): number`（放 `field.ts` 或新 `aircraft-geometry.ts`），場景與測試共用同一換算，避免兩處公式漂移。

### 2.4 防不一致機制

1. **單一換算函式 + 單測**：`90→0.45 / 100→0.5 / 110→0.55`。
2. **啟動一致性檢查**（純函式 `checkAircraftVisualConsistency(configSpanCm, sceneRadiusM)`）：偏差 > 0.01m → HUD 警示「機型參數與視覺模型不一致」+ console.warn；不阻止運行（教學工具）。
3. **載入單測**：config 返回 `diagonalSpanCm === 100`；caa 優先於 exam-aircraft；雙缺失時回落兜底。
4. **註釋修正**：`scene.ts` 「約 1.1m」→「1.00m（官方 90–110cm 區間中值）」。
5. **雙源標註**：exam-aircraft.json 的 massKg/diagonalSpanCm 加註「鏡像自 caa-exam.json，以 caa 為準」（JSON `$comment` 或 note 欄）。
6. **UI 範圍校驗**（若未來開放 adjustable）：面板顯示「樣機軸距 100cm（官方 90–110cm）」，超出區間拒絕寫入並提示。

### 2.5 級別擴展預留

`levels[]` 每級可帶 `diagonalSpanCm`；當前僅級別 I 有官方值，II/III 留 null 並標「尚未核實」——設計上不阻止將來補充，但**不得為進度填猜測值**。

---

## 三、待裁決（提交架構師）

1. 是否批准「caa 側優先」讀取鏈（涉及 `loadExamAircraftParams()` 與 `createExamQuad` 簽名變更，属 P0-B 正式立項範圍）？
2. 原廠型別規格（maxTilt/maxSpeed/accel/drag）何時可取？到手後 exam-aircraft.json 的模擬假設字段是否退役？
3. 級別 II/III 樣機軸距規格是否需要另行核實附件十二全文？
4. 附件十二官方原檔（laws.taipei.gov.tw 404）是否有替代官方取得途徑？

---

## 四、紅線遵守

- 本輪僅調查與設計：`git diff HEAD -- src/ config/` 為空（調查過程未改任何檔案）。
- 1.00m 對角馬達距、附件十二 90–110cm 官方區間、4kg 質量假設均維持不變。
