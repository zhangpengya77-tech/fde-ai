// vitest：Worker 的 YOLO 輸出解碼（座標還原、候選門檻、逐類別 NMS、類別對應）。
// 以 node:vm 載入 prop-live-worker.js（不需要瀏覽器），直接呼叫其中的 decode()。
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadWorker() {
  const code = readFileSync(new URL('../../../src/prop-live/prop-live-worker.js', import.meta.url), 'utf8');
  const context = { self: { postMessage() {}, onmessage: null }, performance, console, Math, Float32Array, navigator: {} };
  vm.createContext(context);
  vm.runInContext(`${code}\n;globalThis.__decode = decode; globalThis.__setNames = (n) => { classNames = n; };`, context);
  return context;
}

/** 依 YOLO 格式 [1, 4+nc, N] 建立假輸出：rows = [{cx, cy, w, h, scores:[...]}] */
function tensor(rows, nc = 2) {
  const count = rows.length;
  const data = new Float32Array((4 + nc) * count);
  rows.forEach((r, i) => {
    data[i] = r.cx; data[count + i] = r.cy; data[2 * count + i] = r.w; data[3 * count + i] = r.h;
    r.scores.forEach((s, c) => { data[(4 + c) * count + i] = s; });
  });
  return { dims: [1, 4 + nc, count], data };
}

describe('Worker decode()', () => {
  const ctx = loadWorker();
  ctx.__setNames(['CW', 'CCW']);
  // 1280×720 原圖 → 640×384 輸入：r = 0.5，上下各補 12
  const meta = { r: 0.5, padX: 0, padY: 12, w: 1280, h: 720 };

  test('座標還原到原圖像素，類別依分數最高者', () => {
    const out = ctx.__decode(tensor([{ cx: 100, cy: 112, w: 40, h: 20, scores: [0.2, 0.9] }]), meta, 0.25);
    expect(out).toHaveLength(1);
    expect(out[0].class).toBe('CCW');
    expect(out[0].confidence).toBeCloseTo(0.9, 5);
    expect(out[0].bbox.map((v) => Math.round(v))).toEqual([160, 180, 240, 220]);
  });

  test('低於候選門檻的框丟棄', () => {
    const out = ctx.__decode(tensor([{ cx: 100, cy: 100, w: 20, h: 20, scores: [0.2, 0.1] }]), meta, 0.25);
    expect(out).toHaveLength(0);
  });

  test('同類別重疊（IoU > 0.7）只留信心最高者；不同類別重疊都保留（交給判定模組判為重疊）', () => {
    const rows = [
      { cx: 200, cy: 200, w: 50, h: 50, scores: [0.9, 0] },
      { cx: 202, cy: 201, w: 50, h: 50, scores: [0.8, 0] },
      { cx: 201, cy: 200, w: 50, h: 50, scores: [0, 0.7] },
    ];
    const out = ctx.__decode(tensor(rows), meta, 0.25);
    expect(out.map((d) => `${d.class}:${d.confidence.toFixed(1)}`)).toEqual(['CW:0.9', 'CCW:0.7']);
  });

  test('超出畫面的座標夾回原圖範圍', () => {
    const out = ctx.__decode(tensor([{ cx: 5, cy: 20, w: 40, h: 40, scores: [0.9, 0] }]), meta, 0.25);
    expect(out[0].bbox[0]).toBe(0);
    expect(out[0].bbox[1]).toBe(0);
  });
});
