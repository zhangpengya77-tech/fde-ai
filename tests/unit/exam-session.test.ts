import { describe, expect, it } from 'vitest';
import { buildExamField } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { ExamSession } from '../../src/exam/session';
import type { FlightSample } from '../../src/exam/subjects';

const config = loadExamConfig();
const field = buildExamField(config);

const DT = 0.05;
function s(t: number, x: number, y: number, z: number, heading: number, speed: number, vy: number): FlightSample {
  return { t, x, y, z, headingDeg: heading, speedMps: speed, vy, mode: 'position' };
}

function genSubjectB(): FlightSample[] {
  const out: FlightSample[] = [];
  let t = 0;
  const push = (tt: number, x: number, y: number, z: number, h: number, sp: number, vyy: number) =>
    out.push(s(tt, x, y, z, h, sp, vyy));
  for (let i = 0; i <= 40; i++) push(i * DT, 0, Math.min(1.5, 0.75 * (i * DT)), 0, 0, 0, i * DT < 2 ? 0.75 : 0);
  t = 2;
  let cur = 0;
  for (let k = 0; k < 5; k++) {
    for (let i = 1; i <= 100; i++) push(t + i * DT, 0, 1.5, 0, cur, 0, 0);
    t += 5;
    if (k < 4) {
      const from = cur;
      const to = cur + 90;
      for (let i = 1; i <= 20; i++) push(t + i * DT, 0, 1.5, 0, from + (to - from) * (i / 20), 0, 0);
      cur = to;
      t += 1;
    }
  }
  for (let i = 1; i <= 40; i++) push(t + i * DT, 0, Math.max(0, 1.5 * (1 - i / 40)), 0, cur, 0, -0.75);
  return out;
}

function genSubjectC(): FlightSample[] {
  const out: FlightSample[] = [];
  let t = 0;
  const alt = 1.5;
  const push = (tt: number, x: number, y: number, z: number, h: number, sp: number, vyy: number) =>
    out.push(s(tt, x, y, z, h, sp, vyy));
  for (let i = 0; i <= 40; i++) push(i * DT, 0, Math.min(alt, 0.75 * (i * DT)), 0, 0, 0, i * DT < 2 ? 0.75 : 0);
  t = 2;
  for (let i = 1; i <= 100; i++) push(t + i * DT, 0, alt, 0, 0, 0, 0);
  t += 5;
  for (let i = 1; i <= 40; i++) push(t + i * DT, 0, alt, -16 * (i / 40), 0, 8, 0);
  t += 2;
  const r = 6;
  const lc = { x: -6, z: -16 };
  for (let i = 1; i <= 120; i++) {
    const a = (i / 120) * 2 * Math.PI;
    push(t + i * DT, lc.x + r * Math.cos(a), alt, lc.z + r * Math.sin(a), 0, 6, 0);
  }
  t += 6;
  const rc = { x: 6, z: -16 };
  for (let i = 1; i <= 120; i++) {
    const b = Math.PI - (i / 120) * 2 * Math.PI;
    push(t + i * DT, rc.x + r * Math.cos(b), alt, rc.z + r * Math.sin(b), 0, 6, 0);
  }
  t += 6;
  for (let i = 1; i <= 40; i++) push(t + i * DT, 0, alt, -16 * (1 - i / 40), 0, 8, 0);
  t += 2;
  for (let i = 1; i <= 20; i++) push(t + i * DT, 0, alt, 0, 0, 0, 0);
  return out;
}

describe('考試會話 — 錄製與彙整', () => {
  it('記錄 B 飛行並 finalize → 科目B=S、無重大違失、成績單 simulatedPass 反映', () => {
    const sess = new ExamSession();
    genSubjectB().forEach((smp) => sess.record(smp));
    const res = sess.finalize(config, field);
    expect(res.subjectB.rating).toBe('S');
    expect(res.majorFailure.hasAny).toBe(false);
    expect(res.report.items[1].rating).toBe('S');
    expect(res.trajectory.length).toBe(sess.getSampleCount());
  });

  it('記錄 C 飛行並 finalize → 科目C=S、航跡含八字點', () => {
    const sess = new ExamSession();
    genSubjectC().forEach((smp) => sess.record(smp));
    const res = sess.finalize(config, field);
    expect(res.subjectC.rating).toBe('S');
    expect(res.report.items[2].rating).toBe('S');
    // 航跡應涵蓋八字左圓 x≈-12 處。
    const minX = Math.min(...res.trajectory.map((p) => p.x));
    expect(minX).toBeLessThan(-10);
  });

  it('同一會話可連續記錄 B 與 C → 兩科皆判定', () => {
    const sess = new ExamSession();
    [...genSubjectB(), ...genSubjectC()].forEach((smp) => sess.record(smp));
    const res = sess.finalize(config, field);
    expect(res.subjectB.rating).toBe('S');
    expect(res.subjectC.rating).toBe('S');
    expect(res.report.simulatedPass).toBe(true);
  });

  it('clear() 後樣本數歸零', () => {
    const sess = new ExamSession();
    genSubjectB().forEach((smp) => sess.record(smp));
    expect(sess.getSampleCount()).toBeGreaterThan(0);
    sess.clear();
    expect(sess.getSampleCount()).toBe(0);
  });
});
