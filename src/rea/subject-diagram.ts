/**
 * REA 考照模擬器：科目卡片航線示意圖（2026-11-08）。
 *
 * 做法：在背景用「示範自動駕駛」把科目實際飛一遍（無風、定位模式），記下水平軌跡，
 * 再畫成俯視圖。所以示意圖＝示範飛行＝評分依據，三者永遠一致；之後新增科目也會自動有圖。
 * 圖中元素依考場實際尺寸（AC 107-005D）：8 字環帶、角錐 P1…、起降點 H、考生位置、航線與方向箭頭。
 * 高空科目（五邊、緊急返航）另外標出最高高度。圖樣為本專案自行繪製。
 */

import { fieldOf, type Subject, type Vec2 } from './courses';
import { Autopilot } from './autopilot';
import { AIRFRAMES } from './physics';
import { FlightSession, PHYSICS_DT } from './session';
import { DEFAULT_WIND } from './wind';

export interface Flown {
  path: Vec2[];
  maxAlt: number;
}

const cache = new Map<string, Flown>();

/** 背景試飛一次（最多 6 分鐘模擬時間），取每 0.25 秒一點的水平軌跡。 */
export function flySubject(subject: Subject): Flown {
  const hit = cache.get(subject.id);
  if (hit) return hit;
  const result: Flown = { path: [], maxAlt: 0 };
  if (subject.implemented) {
    const sess = new FlightSession({ subject, airframeId: subject.defaultAirframe, mode: 'position', wind: { ...DEFAULT_WIND }, returnCallDelay: 6 });
    const ap = new Autopilot(AIRFRAMES[subject.defaultAirframe]);
    // 直接一步一步推進物理（advance 每次最多 0.1 秒，這裡不受限制）
    const maxSteps = Math.round((6 * 60) / PHYSICS_DT);
    for (let i = 0; i < maxSteps && !sess.done; i++) sess.stepOnce(ap.command(sess.runner, sess.state));
    let lastT = -1;
    for (const smp of sess.samples) {
      result.maxAlt = Math.max(result.maxAlt, smp.h);
      if (smp.t - lastT < 0.25) continue;
      lastT = smp.t;
      result.path.push({ x: smp.x, y: smp.y });
    }
  }
  cache.set(subject.id, result);
  return result;
}

/** 依軌跡長度平均放幾個方向箭頭（回傳位置與角度）。 */
export function arrowMarks(path: Vec2[], count = 4): { p: Vec2; deg: number }[] {
  if (path.length < 3) return [];
  const seg: number[] = [0];
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = seg[seg.length - 1];
  if (total < 1) return [];
  const out: { p: Vec2; deg: number }[] = [];
  for (let k = 1; k <= count; k++) {
    const target = (total * k) / (count + 1);
    let i = seg.findIndex((d) => d >= target);
    if (i < 1) i = 1;
    const a = path[i - 1], b = path[Math.min(path.length - 1, i + 1)];
    out.push({ p: path[i], deg: (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI });
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 產生科目俯視示意圖（SVG 字串）。考場座標：x 往右、y 往前（圖上往上）。 */
export function subjectSvg(subject: Subject): string {
  const field = fieldOf(subject.field);
  const flown = flySubject(subject);
  // 視窗範圍：場地外框＋軌跡（五邊會飛出場外）＋考生位置
  let xMin = field.bounds.xMin, xMax = field.bounds.xMax, yMin = Math.min(field.bounds.yMin, field.examinee.y - 1), yMax = field.bounds.yMax;
  for (const p of flown.path) { xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x); yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); }
  const pad = 1.5;
  xMin -= pad; xMax += pad; yMin -= pad; yMax += pad;
  const W = xMax - xMin, H = yMax - yMin;
  const X = (x: number) => r1(x - xMin);
  const Y = (y: number) => r1(yMax - y); // 往前＝圖上方
  const sw = Math.max(W, H) / 120; // 線寬隨圖大小縮放
  const parts: string[] = [];
  // 場地外框
  parts.push(`<rect x="${X(field.bounds.xMin)}" y="${Y(field.bounds.yMax)}" width="${r1(field.bounds.xMax - field.bounds.xMin)}" height="${r1(field.bounds.yMax - field.bounds.yMin)}" fill="#c9cdd1" stroke="#fff" stroke-width="${r1(sw)}"/>`);
  // 8 字環帶（外圈、內圈）
  for (const ring of field.rings) {
    parts.push(`<circle cx="${X(ring.center.x)}" cy="${Y(ring.center.y)}" r="${ring.outer}" fill="none" stroke="#e05a6d" stroke-width="${r1(sw * 1.2)}"/>`);
    parts.push(`<circle cx="${X(ring.center.x)}" cy="${Y(ring.center.y)}" r="${ring.inner}" fill="none" stroke="#e05a6d" stroke-width="${r1(sw * 1.2)}"/>`);
  }
  // 航線
  if (flown.path.length > 1) {
    const d = flown.path.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="#1769aa" stroke-width="${r1(sw * 2.2)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const a of arrowMarks(flown.path)) {
      const s = sw * 4;
      parts.push(`<path d="M${r1(s)} 0 L${r1(-s)} ${r1(s * 0.8)} L${r1(-s)} ${r1(-s * 0.8)} Z" fill="#1769aa" transform="translate(${X(a.p.x)} ${Y(a.p.y)}) rotate(${r1(a.deg)})"/>`);
    }
  }
  // 停懸科目（原地不動，只轉機頭）：在 H 四周畫四個方向箭頭，表示機頭依序朝外、右、內、左
  const spread = flown.path.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.y)), 0);
  if (subject.implemented && spread < 1 && subject.steps.some((st) => st.kind === 'yaw')) {
    const L = Math.max(2.5, Math.min(W, H) * 0.22);
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const ex = X(dx * L), ey = Y(dy * L);
      const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
      const s2 = sw * 4;
      parts.push(`<line x1="${X(0)}" y1="${Y(0)}" x2="${ex}" y2="${ey}" stroke="#1769aa" stroke-width="${r1(sw * 2.2)}" stroke-linecap="round"/>`);
      parts.push(`<path d="M${r1(s2)} 0 L${r1(-s2)} ${r1(s2 * 0.8)} L${r1(-s2)} ${r1(-s2 * 0.8)} Z" fill="#1769aa" transform="translate(${ex} ${ey}) rotate(${r1(deg)})"/>`);
    }
  }
  // 起降點 H
  parts.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="${field.hRadius}" fill="#fff" fill-opacity=".55" stroke="#fff" stroke-width="${r1(sw)}"/>`);
  // 角錐（只標航線有用到、或場上全部）
  const fs = r1(Math.max(1, Math.max(W, H) / 22));
  for (const [id, c] of Object.entries(field.cones)) {
    parts.push(`<circle cx="${X(c.x)}" cy="${Y(c.y)}" r="${r1(fs * 0.62)}" fill="#f4a259" fill-opacity=".9" stroke="#c4621b" stroke-width="${r1(sw)}"/>`);
    parts.push(`<text x="${X(c.x)}" y="${r1(Y(c.y) + fs * 0.34)}" font-size="${fs * 0.8}" text-anchor="middle" fill="#5a2a00" font-weight="700">${id}</text>`);
  }
  // 考生位置
  parts.push(`<circle cx="${X(field.examinee.x)}" cy="${Y(field.examinee.y)}" r="${r1(fs * 0.35)}" fill="#2b2f36"/>`);
  // 高空科目標最高高度
  if (flown.maxAlt > 5) parts.push(`<text x="${r1(W - fs * 0.4)}" y="${r1(fs * 1.2)}" font-size="${fs}" text-anchor="end" fill="#17212b" font-weight="700">最高約 ${Math.round(flown.maxAlt)} m</text>`);
  if (!subject.implemented) parts.push(`<text x="${r1(W / 2)}" y="${r1(H / 2)}" font-size="${fs * 1.2}" text-anchor="middle" fill="#4a5866" font-weight="700">尚未實作</text>`);
  return `<svg viewBox="0 0 ${r1(W)} ${r1(H)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${subject.name}航線示意圖">${parts.join('')}</svg>`;
}
