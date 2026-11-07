/**
 * REA 考照模擬器：手機操控盤（2026-11-08）。
 *
 * 手機版畫面上半部是 3D 考場，下半部是兩支大搖桿（美國手 Mode 2）：
 *  - 左搖桿：上下＝高度（升／降）、左右＝機頭轉向
 *  - 右搖桿：上下＝前進／後退、左右＝左右平移
 * 「浮動中心」：手指按下的位置就是搖桿中心，往外推就是打桿，放開回中（定位模式＝停住）。
 * 本檔只放純函式（方便單元測試）與操控教學內容；畫面接線在 app.ts。
 */

import type { StickXY } from '../phone/stick-math';

const T = 0.15; // 小於這個量視為沒動（避免手指抖動時文字一直閃）

/** 左搖桿目前在做什麼（顯示在搖桿下方）。 */
export function describeLeft(s: StickXY): string {
  const parts: string[] = [];
  if (s.x < -T) parts.push('機頭往左轉');
  else if (s.x > T) parts.push('機頭往右轉');
  if (s.y > T) parts.push('高度往上');
  else if (s.y < -T) parts.push('高度往下');
  return parts.join('・');
}

/** 右搖桿目前在做什麼。 */
export function describeRight(s: StickXY): string {
  const parts: string[] = [];
  if (s.y > T) parts.push('往前飛');
  else if (s.y < -T) parts.push('往後飛');
  if (s.x < -T) parts.push('往左平移');
  else if (s.x > T) parts.push('往右平移');
  return parts.join('・');
}

export const IDLE_LEFT = '升降・轉機頭';
export const IDLE_RIGHT = '前進後退・左右平移';

/** 「怎麼操控」教學的每一頁：標題、說明、示意圖要強調哪一支搖桿與方向。 */
export interface TourPage {
  title: string;
  text: string;
  stick: 'l' | 'r' | 'both';
  /** 示意圖箭頭方向：上、下、左、右（沒有就不畫） */
  dir?: 'up' | 'down' | 'left' | 'right';
}

export const TOUR: TourPage[] = [
  { title: '左手搖桿：升高、降低', text: '左邊搖桿往上推，無人機升高；往下拉，高度降低。起飛時先把左桿往上推。', stick: 'l', dir: 'up' },
  { title: '左手搖桿：轉機頭', text: '左邊搖桿往左、往右推，無人機原地轉動機頭方向，位置不變。', stick: 'l', dir: 'left' },
  { title: '右手搖桿：前後左右', text: '右邊搖桿往上推＝往前飛、往下拉＝往後飛；往左、往右推＝左右平移。', stick: 'r', dir: 'up' },
  { title: '放開就停住', text: '手指放開，搖桿自動回到中間：定位模式下無人機會停在原地、保持高度。手指按下的地方就是搖桿中心，不用對準圓圈。建議先按「看示範」聽解說，再按「開始飛」練習。', stick: 'both' },
];

/** 教學示意圖（自行繪製的簡單手機與搖桿圖）。 */
export function tourSvg(page: TourPage): string {
  const ring = (cx: number, on: boolean) =>
    `<circle cx="${cx}" cy="150" r="26" fill="none" stroke="${on ? '#2fb4ff' : '#9aa7b4'}" stroke-width="${on ? 4 : 2}"/>`;
  const hiL = page.stick === 'l' || page.stick === 'both';
  const hiR = page.stick === 'r' || page.stick === 'both';
  const off = { up: [0, -16], down: [0, 16], left: [-16, 0], right: [16, 0] } as const;
  const knob = (cx: number, on: boolean) => {
    const [dx, dy] = on && page.dir ? off[page.dir] : [0, 0];
    return `<circle cx="${cx + dx}" cy="${150 + dy}" r="9" fill="${on ? '#2fb4ff' : '#e7edf3'}"/>`;
  };
  return `<svg viewBox="0 0 200 200" width="170" height="170" aria-hidden="true">
    <rect x="40" y="10" width="120" height="185" rx="16" fill="#151c24" stroke="#273340" stroke-width="3"/>
    <rect x="50" y="22" width="100" height="90" rx="6" fill="#bfd9ee"/>
    <rect x="50" y="78" width="100" height="34" fill="#8b949e"/>
    <path d="M92 70 h16 M100 62 v16" stroke="#0f141a" stroke-width="4" stroke-linecap="round"/>
    <rect x="50" y="118" width="100" height="66" rx="6" fill="#0f141a"/>
    ${ring(75, hiL)}${ring(125, hiR)}${knob(75, hiL && page.stick !== 'both')}${knob(125, hiR && page.stick !== 'both')}
  </svg>`;
}
