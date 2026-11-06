/**
 * 手勢搖桿：手部關鍵點 → 搖桿（純函式，可單元測試）2026-11-07
 *
 * MediaPipe 每隻手回傳 21 個關鍵點（0..1 的畫面座標）：
 *   0＝手腕、5／9／13／17＝四指根部（掌指關節）、4／8／12／16／20＝五個指尖
 * 規則（美國手 Mode 2）：
 *   - 單手：手掌位置＝右搖桿（上下＝前進後退、左右＝左右移）
 *   - 雙手：使用者的右手＝右搖桿；左手上下＝升降、左右＝轉向
 *   - 任一手「握拳」＝立即懸停（搖桿全部回中）
 *   - 看不到手超過 0.25 秒＝自動懸停（沿用既有斷訊保護）
 */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export interface Point {
  x: number;
  y: number;
}

const PALM = [0, 5, 9, 13, 17];
const TIPS = [8, 12, 16, 20];

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 手掌中心：手腕與四個掌指關節的平均 */
export function palmCenter(lm: readonly Landmark[]): Point {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / PALM.length, y: y / PALM.length };
}

/** 手掌大小：手腕到中指根部的距離（手離鏡頭越近越大） */
export function palmSize(lm: readonly Landmark[]): number {
  return dist(lm[0], lm[9]);
}

/**
 * 握拳判斷：四個指尖都靠近手掌中心。
 * 張開手時指尖到掌心約為手掌大小的 1.3～1.8 倍；握拳時小於 0.9 倍。
 */
export function isFist(lm: readonly Landmark[], ratio = 0.95): boolean {
  const c = palmCenter(lm);
  const size = palmSize(lm);
  if (size <= 0) return false;
  return TIPS.every((i) => dist(lm[i], c) < size * ratio);
}

/**
 * 分配左右手：依「原始影像」的 x 座標判斷（鏡頭畫面未鏡像時，使用者的右手出現在影像左側）。
 * 只有一隻手時，一律當作右手（控制前後左右）。
 */
export function assignHands<T extends readonly Landmark[]>(hands: readonly T[]): { right: T | null; left: T | null } {
  if (hands.length === 0) return { right: null, left: null };
  if (hands.length === 1) return { right: hands[0], left: null };
  const [a, b] = [...hands].sort((h1, h2) => palmCenter(h1).x - palmCenter(h2).x);
  return { right: a, left: b };
}

/**
 * 手掌位置 → 搖桿（-1..1）。
 * mirror=true：原始影像中往左＝使用者往右（自拍視角），roll 取反。
 * 畫面 y 往下為正，所以手往上＝pitch 正（前進）。
 */
export function handToStick(center: Point, neutral: Point, range = 0.18, mirror = true, deadzone = 0.1): { x: number; y: number } {
  const shape = (v: number): number => {
    const c = Math.max(-1, Math.min(1, v));
    return Math.abs(c) <= deadzone ? 0 : (Math.sign(c) * (Math.abs(c) - deadzone)) / (1 - deadzone);
  };
  const dx = (center.x - neutral.x) / range;
  const dy = (center.y - neutral.y) / range;
  return { x: shape(mirror ? -dx : dx), y: shape(-dy) };
}
