/**
 * 3D 畫面滑鼠滾輪縮放（只改攝影機的 zoom，不影響飛行、評分或任何遙測）。
 * 以等比例變化：每一格滾輪放大／縮小相同倍率，手感一致。
 */

export const VIEW_ZOOM_MIN = 0.5;
export const VIEW_ZOOM_MAX = 5;
/** 滾輪 deltaY 每 100（一般滑鼠一格）約變化 16% */
const ZOOM_SENSITIVITY = 0.0015;

/** 依滾輪 deltaY 計算新的縮放倍率：往上滾（deltaY < 0）放大、往下滾縮小，並限制在範圍內。 */
export function nextViewZoom(current: number, deltaY: number, deltaMode = 0): number {
  // deltaMode 1＝以「行」為單位（部分滑鼠／Firefox），換算成像素
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const z = current * Math.exp(-px * ZOOM_SENSITIVITY);
  return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, Number.isFinite(z) ? z : 1));
}

/** 畫面上顯示的縮放文字 */
export function viewZoomLabel(z: number): string {
  return `縮放 ×${z.toFixed(1)}（雙擊畫面重設）`;
}
