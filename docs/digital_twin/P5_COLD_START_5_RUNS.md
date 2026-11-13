# P5-I 五次獨立冷啟動記錄

| Run | 啟動器 / Gateway readiness | GPS/EKF | gyro / accel | PreArm / armed | 看門狗 | 結論 |
|---|---|---|---|---|---|---|
| 1 | 受控 runner：ready=true；Gateway child PID 19 cleanup 前仍存活 | Fix 6；IMU0/1 initialize + alignment | true / true | 未發 arm（本輪僅生命週期驗收） | 正常 DELETE session | PASS（Gateway 生命週期） |
| 2 | NOT RUN | — | — | — | — | NOT RUN |
| 3 | NOT RUN | — | — | — | — | NOT RUN |
| 4 | NOT RUN | — | — | — | — | NOT RUN |
| 5 | NOT RUN | — | — | — | — | NOT RUN |

注意：此表與 P5-H 舊的三個手動冷啟動樣本分開計算；P5-I 驗收要求是在修復啟動器後重新完成連續五次，現階段不得宣稱成功率為 5/5。
