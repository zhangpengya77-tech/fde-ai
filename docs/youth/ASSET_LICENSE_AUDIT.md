# 素材與開源授權稽核

## 本模組使用的素材
| 項目 | 來源 | 授權 |
|---|---|---|
| three.js r181＋OrbitControls | 網站既有 `f450-twin/vendor/three`（未新增檔案） | MIT（`f450-twin/vendor/three/LICENSE`） |
| 3D 模型（無人機、電機、球場、球門） | 本次以程式生成 | 自製 |
| 圖示、插畫 | 內嵌 SVG／emoji，自製 | 自製 |
| 教材文字、測驗 | 本次自編 | 自製；需教師審核 |
| 字型 | 使用者系統字型（微軟正黑體等） | 不散佈 |

**沒有**複製參考影片中的品牌、Logo、插畫、照片、文案或 3D 模型。參考影片與抽幀只存在 `D:\FDE-AI-Youth-Reference\`，不進 Git、不上網站。

## GitHub 開源資源調查（2026-11-20）
| 資源 | 網址 | 授權 | 可復用範圍 | 本次決定 |
|---|---|---|---|---|
| three.js | github.com/mrdoob/three.js | MIT | 3D 繪圖 | 已在用（r181） |
| React Three Fiber | github.com/pmndrs/react-three-fiber | MIT | React 宣告式 3D | 不採用：網站無 React 建置流程，引入成本高 |
| Rapier | github.com/dimforge/rapier | Apache-2.0 | 剛體物理 | 不採用：足球為教學級運動學即可，避免加大載入量（約 1 MB wasm） |
| zz85/drone.js | github.com/zz85/drone.js | 未在本次確認 | Gamepad＋three.js 四旋翼思路 | 只參考思路，未複製程式 |
| ertrzyiks/threejs-drone | github.com/ertrzyiks/threejs-drone | MIT（依索引頁） | three.js 無人機範例 | 只參考，未複製 |
| glurp/quadwebgl | github.com/glurp/quadwebgl | 「other」不明確 | — | 不使用 |
| MDN Gamepad API | developer.mozilla.org | 文件 | API 用法 | 依標準實作 |

- 沒有找到開源的「無人機足球模擬器」，足球場為自行開發。
- 以上授權欄位為搜尋結果與索引頁資訊，**正式採用任一專案前需再到原始倉庫確認 LICENSE**。
