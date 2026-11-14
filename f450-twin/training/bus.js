// F450 實訓中心｜2D 與 3D 之間的同步事件（P4）
// 事件：
//   focus2d  { components: [元件 id], wire: { from, to } | null, label }   2D 選取 → 3D 高亮
//   focus3d  { components: [元件 id], label }                              3D 選取 → 2D 框出
//   wires2d  { wires: [...], result: validateWiring 結果 | null, show }     2D 接線草稿 → 3D 顯示
// 只在同一頁面內傳遞，不送到伺服器。
const bus = new EventTarget();
const last = {};   // 每種事件的最後一筆，讓晚建立的一方也能拿到目前狀態
export function emit(type, detail) { last[type] = detail; bus.dispatchEvent(new CustomEvent(type, { detail })); }
export function on(type, fn) { bus.addEventListener(type, (e) => fn(e.detail)); }
export const latest = (type) => last[type];
