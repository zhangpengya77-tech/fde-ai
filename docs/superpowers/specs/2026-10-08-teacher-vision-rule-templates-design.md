# 教師視覺模型規則模板設計

## 目標

在 v2.0 既有的 R07 模型上傳與 Vision Center 之上，提供一個最小教師操作流程：學員上傳 `best.pt`，教師在 Django 教師後台選擇既定的任務模板並執行「列為候選」或「退回補件」。教師不需要編寫或調整 CW、CCW、馬達位置、四面懸停方向等規則。

本期只提供兩個固定模板：

1. `PROP_DIRECTION_V1`：F450 槳葉正反面、CW/CCW 與 M1–M4 位置關係。
2. `FOUR_SIDE_HOVER_V1`：前、右、後、左四面懸停方向與完成條件。

## 範圍與非目標

### 本期範圍

- Django 教師後台的「視覺模型中心」入口、清單、詳情、私有下載與最小審核操作。
- 兩個唯讀的內建規則模板與其教師可讀說明。
- 以既有 R07 `MODEL / YOLO_MODEL Evidence` 及 Vision Submission 為單一來源。
- 審核意見、操作者、時間、動作及模板識別碼的持久化審核紀錄。
- 只針對目前教師可存取班級列出模型提交。

### 非目標

- 不改寫 Vision Center、Vision API、YOLO、RAG、Live Coach、Growth Record 核心或學生上傳流程。
- 不新建第二套模型倉庫、學生資料庫或教師登入。
- 不讓教師自由撰寫規則、類別或閾值。
- 不載入、不執行、不啟用未受信任的學員 `.pt`。
- 不建立 Golden Set、模型隔離驗證器、模型切換或 ACTIVE 啟用。

## 現有基礎

既有 Vision Center 的模型類別為：

- `PROP_DIRECTION`：`CW_F`、`CCW_F`、`CW_B`、`CCW_B`。
- `FOUR_SIDE_HOVER`：`FRONT`、`RIGHT`、`BACK`、`LEFT`。

R07 的 A 方向已會建立 `MODEL / YOLO_MODEL Evidence`，並送出 `PROP_DIRECTION` Vision Submission。教師已使用 Django `teacher_required` 與班級權限。這些既有鏈路保持不變。

## 方案選擇

採用「Django 審核介面 + 內建唯讀模板 + Evidence metadata 審核歷程」。

此方案不增加資料表或 migration；每筆既有模型 Evidence 的 `processed_metadata` 保留一個 `vision_model_review` 區塊，包含目前狀態與按時間排序的歷程。它可將本期改動限制在教師頁、既有 Evidence 與現有私有下載，不改動 Vision Center 的模型執行或 ACTIVE 指向。

未採用的方案：

- 直接讓教師操作現有 DEV Vision Center：其身分依賴開發用 header，不符合 Django 教師 Session。
- 新增獨立模型資料庫：會重複既有 Evidence / Submission 來源且超出 MVP。
- 讓教師設定規則表單：會提高誤設安全與教學邏輯的風險。

## 固定規則模板

### PROP_DIRECTION_V1：槳葉方向與安裝關係

教師只會從兩個固定模板中確認適用模板並看到模板摘要與模型應學會的類別；不會填寫規則。

| 項目 | 固定定義 |
| --- | --- |
| 模型任務 | `PROP_DIRECTION` |
| 模型輸出類別 | `CW_F`、`CCW_F`、`CW_B`、`CCW_B` |
| 機體位置語意 | **M1 右前、M2 左後、M3 左前、M4 右後**（教師 2026-10-08 確認；Codex Phase A 記錄的 M1 左前 / M2 右前 / M3 右後 / M4 左後 為已知錯誤，已修正）；畫面解讀以現有 F450 機頭方向定義為準 |
| 規則層責任 | 將偵測出的 CW/CCW、正反面與 M1–M4 位置關係組合為教學結果 |
| 結果 | `PASS`、`NG` 或 `REVIEW` |
| `REVIEW` 條件 | 類別未知、低信心、位置不足、畫面方向無法可靠取得或偵測結果互相衝突 |
| 安全 | 結果只能提供教學觀察；不解除槳葉、上電、Motor Test、Arm 或飛行的教師安全關卡 |

### FOUR_SIDE_HOVER_V1：四面懸停方向

| 項目 | 固定定義 |
| --- | --- |
| 模型任務 | `FOUR_SIDE_HOVER` |
| 模型輸出類別 | `FRONT`、`RIGHT`、`BACK`、`LEFT` |
| 規則層責任 | 依既有任務階段、方向序列與完成條件整理結果 |
| 結果 | `PASS`、`NG` 或 `REVIEW` |
| `REVIEW` 條件 | 未知方向、低信心、階段不相符或不足以量測完成條件 |
| 安全 | 不會自動放行真機起飛或飛行模式；安全階段仍要求教師現場確認 |

## 教師操作流程

```text
學員 R07 上傳 best.pt
  -> 現有 Evidence + Vision Submission（不變）
  -> 教師後台 / 視覺模型中心
  -> 查看檔案、學員、班級、任務與固定規則模板
  -> 「列為候選」或「退回補件」+ 可選教師意見
  -> Evidence 的 vision_model_review 歷程更新
  -> 學員提交維持非 ACTIVE；前端只可顯示候選/審核狀態
```

「列為候選」不是「ACTIVE」。本輪候選模型僅同步給學員查看審核狀態；絕不進入現有 Vision API 的推論或 ACTIVE 路徑，也不會覆蓋任何正式模型。

## 資料契約

每筆模型 Evidence 在 `processed_metadata` 中新增或更新：

```json
{
  "vision_model_review": {
    "status": "PENDING|CANDIDATE|RETURNED",
    "task_type": "PROP_DIRECTION|FOUR_SIDE_HOVER",
    "rule_template_id": "PROP_DIRECTION_V1|FOUR_SIDE_HOVER_V1",
    "current_note": "教師最新意見",
    "history": [
      {
        "action": "CANDIDATE|RETURNED",
        "teacher_id": "教師帳號 ID",
        "teacher_name": "教師顯示名稱",
        "note": "可選意見",
        "at": "ISO-8601 UTC"
      }
    ]
  }
}
```

教師只能選擇與 Evidence 既有 `task_type` 相符的固定模板：`PROP_DIRECTION -> PROP_DIRECTION_V1`，`FOUR_SIDE_HOVER -> FOUR_SIDE_HOVER_V1`。請求中的任務或模板值不可跨類型指定，也不可新增或編輯規則。

## Django 介面

新增的 Django 教師頁面路徑：

- `GET /teacher/vision-models/`：只列出教師可存取班級內的模型 Evidence。
- `GET /teacher/vision-models/<uuid:evidence_id>/`：模型詳情、固定模板、既有 Vision Submission 狀態、私有下載與審核歷程。
- `POST /teacher/vision-models/<uuid:evidence_id>/review/`：只接受 `candidate` 或 `return`；可帶一段可選教師意見。

所有路徑使用既有 `teacher_required`，並以 `teacher_cohorts(request.user)` 限制 Evidence 所屬 Enrollment。未授權 Evidence 一律回應 404，避免洩漏學員提交存在性。

教師首頁只增加一個「視覺模型中心」入口；既有學員 R07 頁面只讀取並顯示其既有 Evidence 的審核狀態，不改動 Live Coach 或其他學生流程。

## 錯誤與邊界

- 非 `.pt`、過大或現有後端拒絕的檔案仍由既有 R07 上傳流程拒絕。
- 沒有模型 Evidence 時，教師清單顯示空狀態，不建立假資料。
- 不支援的 `task_type` 不會產生審核表單。
- 已退回模型可重新送件；既有歷程不刪除。
- 候選模型不能出現在 ACTIVE 清單、不能被 Live Coach 載入，也不能觸發任何 Vision 推論。
- `DEMO_TEST_ONLY` 永遠不視為 PROP_DIRECTION 或 FOUR_SIDE_HOVER 已驗證模型。

## 測試與驗收

定向自動測試需覆蓋：

1. 教師只看到自己可存取班級的模型 Evidence；其他班級與未授權存取回 404。
2. `PROP_DIRECTION` 只顯示 `PROP_DIRECTION_V1`，且含四個既有模型類別與 M1–M4 位置說明。
3. `FOUR_SIDE_HOVER` 只顯示 `FOUR_SIDE_HOVER_V1`，且含四個方向。
4. 教師列為候選或退回補件會持久化意見、操作者、時間與歷程。
5. 提交者的檔案仍可透過既有私有下載取得；候選動作不呼叫 Vision Center import、evaluate 或 activate。
6. `DEMO_TEST_ONLY` 不能成為 ACTIVE；本輪不存在任何 ACTIVE 操作。

人工驗收：教師以 v2.0 測試帳號登入、開啟模型中心、看到 R07 上傳、查看詳情並執行一次候選或退回；iPhone Safari 驗收另行標為 PENDING，直到實機完成。

## 保護約束

- 本輪只實作教師倉庫、固定模板審核及學員 R07 審核狀態同步.
- 不修改 v1.5C / 8022、Vision 核心、Flight Health、MP-12、Task 08、RAG、YOLO、Live Coach 核心、General AI 或正式資料。
- 不 commit、push、merge、deploy、重啟 Vision/RAG/Flight Health 或改動現有 ACTIVE 模型。
- 所有學生與教師可見文字使用繁體中文。
