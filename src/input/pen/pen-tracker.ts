/**
 * 原子筆搖桿：影像追蹤的純函式層（2026-11-07）
 *
 * 做法（不用 AI 模型、不上傳影像，全部在瀏覽器本機計算）：
 *   1. 使用者在鏡頭畫面上點一下筆尖（或筆蓋）→ 取樣那一點的顏色當「目標色」
 *   2. 每一格影像縮小到約 160×120，找出和目標色相近的像素（比對色相 Hue、飽和度、亮度）
 *   3. 取這些像素的重心＝筆尖位置；像素數量＝筆離鏡頭遠近（越近越大）
 *   4. 筆尖相對「校正中心」的偏移 → 右搖桿（左右＝橫滾 roll、上下＝俯仰 pitch）
 *
 * 這一層只有計算，沒有鏡頭或畫面，所以可以完整做單元測試。
 */

export interface HSV {
  /** 色相 0..360 */
  h: number;
  /** 飽和度 0..1 */
  s: number;
  /** 亮度 0..1 */
  v: number;
}

export interface ColorTarget extends HSV {
  /** 色相容許差（度），預設 18 */
  hueTolerance: number;
}

export interface Blob {
  /** 重心（0..1，相對畫面寬高；x 已依鏡像設定處理前的原始座標） */
  x: number;
  y: number;
  /** 符合的像素數 */
  count: number;
  /** 佔整張畫面的比例 0..1 */
  area: number;
}

export interface StickSample {
  roll: number;
  pitch: number;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** 兩個色相的最短角度差（0..180） */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 判斷一個像素是否屬於目標色。
 * 灰白黑（飽和度太低）的東西色相不可靠，一律排除，避免把白牆、皮膚反光當成筆。
 */
export function matchesTarget(px: HSV, target: ColorTarget): boolean {
  if (px.s < Math.max(0.28, target.s * 0.45)) return false;
  if (px.v < 0.18) return false;
  return hueDistance(px.h, target.h) <= target.hueTolerance;
}

/** 從點選位置周圍 5×5 取平均色，做為目標色（單一像素容易取到雜訊） */
export function sampleTarget(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  hueTolerance = 18,
): ColorTarget | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.max(0, cy - 2); y <= Math.min(height - 1, cy + 2); y++) {
    for (let x = Math.max(0, cx - 2); x <= Math.min(width - 1, cx + 2); x++) {
      const i = (y * width + x) * 4;
      r += rgba[i];
      g += rgba[i + 1];
      b += rgba[i + 2];
      n++;
    }
  }
  if (n === 0) return null;
  const hsv = rgbToHsv(r / n, g / n, b / n);
  // 點到灰白色時無法追蹤：請使用者改點有顏色的筆蓋／筆尖
  if (hsv.s < 0.28 || hsv.v < 0.18) return null;
  return { ...hsv, hueTolerance };
}

/**
 * 在一張 RGBA 影像中找目標色的重心。
 * 像素太少（< minCount）視為「沒看到筆」，回傳 null。
 * step=2 表示每隔一個像素取樣，速度快一倍、對 160×120 的畫面精度已足夠。
 */
export function findBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  target: ColorTarget,
  minCount = 12,
  step = 2,
): Blob | null {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (matchesTarget(rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]), target)) {
        sx += x;
        sy += y;
        count++;
      }
    }
  }
  if (count < minCount) return null;
  const sampled = Math.ceil(width / step) * Math.ceil(height / step);
  return { x: sx / count / width, y: sy / count / height, count, area: count / sampled };
}

/**
 * 筆尖位置 → 右搖桿。
 * - center：使用者按「設為中心」時筆尖的位置（0..1）
 * - range：筆尖離中心多遠算「推到底」（畫面比例，預設 0.22）
 * - mirror：畫面是否左右鏡像（自拍視角下，筆往右移、畫面也往右才直覺）
 * - deadzone：中心附近的手抖不動作（預設 0.08）
 * 畫面 y 往下為正，所以筆往上移 → pitch 為正（前進）。
 */
export function blobToSticks(
  blob: { x: number; y: number },
  center: { x: number; y: number },
  range = 0.22,
  mirror = true,
  deadzone = 0.08,
): StickSample {
  const dx = (blob.x - center.x) / range;
  const dy = (blob.y - center.y) / range;
  const shape = (v: number): number => {
    const c = Math.max(-1, Math.min(1, v));
    const m = Math.abs(c);
    if (m <= deadzone) return 0;
    return (Math.sign(c) * (m - deadzone)) / (1 - deadzone);
  };
  return { roll: shape(mirror ? -dx : dx), pitch: shape(-dy) };
}

/** 指數平滑（減少手抖造成的機體抖動）；alpha 越大越跟手 */
export function smooth(prev: StickSample | null, next: StickSample, alpha = 0.35): StickSample {
  if (!prev) return next;
  return {
    roll: prev.roll + (next.roll - prev.roll) * alpha,
    pitch: prev.pitch + (next.pitch - prev.pitch) * alpha,
  };
}
