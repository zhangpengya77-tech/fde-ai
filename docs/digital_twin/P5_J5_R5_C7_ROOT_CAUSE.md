# P5-J5-R5 C7 畫質切換根因

狀態：PASS（真實 Windows Chrome / WebGL 驗證）；Camera Sensor SIGSEGV 與本項無關，仍為 BLOCKED。

## 根因

R4 的分層診斷在 `<details class="rea-settings">` 保持折疊時，直接對隱藏的
`[data-rea-quality-select]` 呼叫 Playwright `selectOption()`。Playwright 因 actionability
（控制項不可見）停在 C7，change event 沒有送入應用程式；因此當時 canvas 的
`data-rea-quality` 沒有更新並不是 `ExamScene.setQuality()` 或 WebGL renderer 失效。

另有一個只存在於診斷腳本的後續錯誤：ESM JavaScript 的 `page.evaluate()` 內誤用了
TypeScript 泛型寫法 `querySelector<HTMLCanvasElement>`。該表達式在 Chrome 中不是有效的
TypeScript，造成錯誤診斷。已改為純 JavaScript `querySelector()`；未修改 Three.js 行為。

## 修正

- `scripts/p5j5-chrome-layer-diagnosis.mjs`：C7 先以真正的 summary 開啟設定面板，確認
  select 可見後，實際走 LOW → MEDIUM → HIGH → LOW。
- `src/rea/scene.ts`：`setQuality()` 在已套用 `setPixelRatio`、shadow enable 與 shadow map
  size 後，才輸出唯讀 canvas diagnostics：`data-rea-quality`、pixel ratio、shadow、map size。
  這些值讀自 renderer，不是自行偽造的 flight 或 renderer state。
- `tests/browser/rea-exam.spec.ts`：瀏覽器測試先開啟設定面板，依使用者可操作的控制鏈選擇 LOW。

控制鏈：select change → `prefs.quality` 驗證為 `RenderQuality` → `refreshAll()` →
`ExamScene.setQuality()` → WebGL renderer budget → canvas dataset。

## 真實 C7 證據

工件：`.p5j5-chrome-diagnosis/chrome-layer-ac41c584784f4ec296f60e0411f2f364/`。

| 請求 | canvas quality | pixel ratio | shadows | shadow map |
|---|---|---:|---|---:|
| LOW | low | 1 | false | 512 |
| MEDIUM | medium | 1.0000000298023224 | true | 1024 |
| HIGH | high | 1.0000000298023224 | true | 2048 |
| LOW | low | 1 | false | 512 |

此 Chrome 的 device pixel ratio 約為 1，因此 MEDIUM/HIGH pixel ratio 依設計受裝置比率上限
限制；shadow budget 仍按檔位確實變化。
