# P5-J5-R5 Chrome C0–C9 實測

測試環境：隔離工作樹 `D:\FDE-REA-Exam-Sim-P5J5-R2`，Windows Chrome、Vite preview、
動態端口 4202。工件 run id：`chrome-layer-ac41c584784f4ec296f60e0411f2f364`。

| 層級 | 結果 | 實測時間 |
|---|---|---:|
| C0 Vite HTTP readiness | PASS | 540 ms |
| C1 Chrome / Playwright launch | PASS | 375 ms |
| C2 blank page | PASS | 46 ms |
| C3 static page | PASS | 60 ms |
| C4 REA exam DOMContentLoaded | PASS | 60 ms |
| C5 WebGL canvas | PASS | 417 ms |
| C6 two render frames | PASS | 43 ms |
| C7 LOW→MEDIUM→HIGH→LOW | PASS | 339 ms |
| C8 local preference reload | PASS | 158 ms |
| C9 page/browser/Vite owned-resource teardown | PASS | 30 ms |

瀏覽器與 Vite 均由此 runner 建立；C9 中 Browser API 已 `closed`、Vite 已送 SIGTERM，
完成後 4202 無 Listen socket。測試未附加、終止或接管任何來源不明 Chrome/Node 程序。

Chrome console 僅記錄一個非功能性 404（favicon）；本輪沒有 pageerror 或 requestfailed
影響 C0–C9。

此畫質測試沒有建立 Gateway Session、read-ticket 或飛控控制路徑；因此它不提供新的
Gateway read-only 權限證明，也不會賦予頁面控制能力。P5-J3 的 read-only 飛行 observer
驗收工件仍保持獨立有效。
