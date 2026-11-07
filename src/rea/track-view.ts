/**
 * REA 考照模擬器：俯視軌跡圖（2D canvas）。
 * 可照時間、偏離航線或機頭偏差上色，回放時標出目前位置。
 */

import type { Field } from './courses';
import type { Sample } from './session';

export type TrackColoring = 'time' | 'cross' | 'heading';

export function drawTrack(cv: HTMLCanvasElement, field: Field, samples: Sample[], coloring: TrackColoring, nowT: number, track: [number, number, number]): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width;
  const Hh = cv.height;
  // 取場地與軌跡的聯集範圍
  let { xMin, xMax, yMin, yMax } = field.bounds;
  for (const s of samples) { xMin = Math.min(xMin, s.x); xMax = Math.max(xMax, s.x); yMin = Math.min(yMin, s.y); yMax = Math.max(yMax, s.y); }
  const pad = 2;
  const scale = Math.min((W - 20) / (xMax - xMin + pad * 2), (Hh - 20) / (yMax - yMin + pad * 2));
  const ox = W / 2 - ((xMin + xMax) / 2) * scale;
  const oy = Hh / 2 + ((yMin + yMax) / 2) * scale;
  const P = (x: number, y: number): [number, number] => [ox + x * scale, oy - y * scale];

  ctx.fillStyle = '#20262e';
  ctx.fillRect(0, 0, W, Hh);
  ctx.strokeStyle = '#5b6470';
  ctx.lineWidth = 1;
  const b = field.bounds;
  const [bx0, by0] = P(b.xMin, b.yMax);
  ctx.strokeRect(bx0, by0, (b.xMax - b.xMin) * scale, (b.yMax - b.yMin) * scale);
  for (const r of field.rings) {
    ctx.fillStyle = 'rgba(229,107,143,.25)';
    ctx.beginPath();
    const [cx, cy] = P(r.center.x, r.center.y);
    ctx.arc(cx, cy, r.outer * scale, 0, Math.PI * 2);
    ctx.arc(cx, cy, r.inner * scale, 0, Math.PI * 2, true);
    ctx.fill();
  }
  ctx.strokeStyle = '#d62839';
  ctx.beginPath();
  ctx.arc(...P(0, 0), field.hRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.font = '11px system-ui';
  for (const [id, p] of Object.entries(field.cones)) {
    const [x, y] = P(p.x, p.y);
    ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillText(id, x + 4, y - 4);
  }
  const [ex, ey] = P(field.examinee.x, field.examinee.y);
  ctx.fillStyle = '#9aa5b1';
  ctx.fillText('考生', ex - 10, ey + 12);

  // 軌跡
  const T = samples.length ? samples[samples.length - 1].t : 1;
  ctx.lineWidth = 2;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const s = samples[i];
    ctx.strokeStyle = colorFor(s, coloring, T, track);
    ctx.globalAlpha = s.t <= nowT || nowT <= 0 ? 1 : 0.35;
    ctx.beginPath();
    ctx.moveTo(...P(a.x, a.y));
    ctx.lineTo(...P(s.x, s.y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 目前位置
  const cur = samples.find((s) => s.t >= nowT) ?? samples[samples.length - 1];
  if (cur && nowT > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(...P(cur.x, cur.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 圖例
  ctx.fillStyle = '#cfd6dd';
  ctx.font = '11px system-ui';
  const legend = coloring === 'time' ? '黃＝起飛 → 紫＝結束' : coloring === 'cross' ? '綠＝頂尖 藍＝標準 黃＝擦邊 紅＝失敗（偏離航線）' : '綠＝頂尖 藍＝標準 黃＝擦邊 紅＝失敗（機頭）';
  ctx.fillText(legend, 8, Hh - 8);
}

const TIER_COLORS = ['#2ec27e', '#3a86ff', '#f4c430', '#e63946'];

function colorFor(s: Sample, mode: TrackColoring, T: number, track: [number, number, number]): string {
  if (mode === 'time') {
    const k = s.t / Math.max(T, 1);
    const r = Math.round(255 - 125 * k);
    const g = Math.round(209 - 160 * k);
    const b = Math.round(102 + 120 * k);
    return `rgb(${r},${g},${b})`;
  }
  const v = mode === 'cross' ? s.cross : s.headErr;
  const lim = mode === 'cross' ? track : [10, 20, 45];
  const tier = v <= lim[0] ? 0 : v <= lim[1] ? 1 : v <= lim[2] ? 2 : 3;
  return TIER_COLORS[tier];
}
