# P5-J7 任務狀態機

狀態：PENDING → READY → RUNNING → COMPLETED／FAILED／CANCELLED／INVALID。
非法轉換會拋錯；Session 遺失、資料來源不符、版本不符、資料過期或 sampleId 非單調遞增時立即 INVALID，後續不再累積有效證據。
