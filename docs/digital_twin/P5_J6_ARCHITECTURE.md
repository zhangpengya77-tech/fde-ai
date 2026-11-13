# P5-J6 架構

J6 僅擴充既有 REA 前端：`courses.ts` 保持場地／科目座標權威來源，
`training-template.ts` 提供可配置教學描述，`scene.ts` 以同一座標渲染，
`teacher-record.ts` 從 Session telemetry 樣本產生待教師覆核的 JSON。

未建立第二套飛行物理、未連接 Gateway/SITL、未改寫 read-only observer。所有模板均標記
`TRAINING_TEMPLATE`，不是官方認證考場、官方術科判定或成績系統。
