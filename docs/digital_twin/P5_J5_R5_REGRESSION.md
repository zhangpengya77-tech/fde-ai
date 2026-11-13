# P5-J5-R5 回歸

| 命令 | 結果 |
|---|---|
| `npx.cmd tsc --noEmit` | PASS |
| `npm.cmd test -- --run` | PASS：65 files / 849 tests |
| `npm.cmd run build` | PASS；保留既有 Three.js 570.66 kB chunk warning |
| `node scripts/p5j5-chrome-layer-diagnosis.mjs`（port 4202） | PASS：C0–C9 |
| `git diff --check` | PASS |

本輪只變更隔離前端畫質選擇、Three.js render budget diagnostics、瀏覽器測試及診斷腳本；
未修改 Gateway、Runner、SITL、Mission、Session、watchdog 或飛行生命週期。因此本輪不需要
重新執行 P5-J3 的真實 G5/Chrome 飛行 E2E；其六份 PASS 工件未被覆寫。

P5-J4 主樹的 864 測試基準與本隔離 J5 的 849 測試差異，已在 R1 確認為 worktree 測試集合
不同，並非本輪遺失測試。
