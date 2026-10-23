import { describe, expect, it } from 'vitest';
import { buildExamField } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { ExamSession } from '../../src/exam/session';
import { subjectDSteps } from '../../src/exam/scripted-programs';
import {
  CHECKLIST_ITEMS,
  CONTROLLER_CHECK_ITEMS,
  SYSTEM_KNOWLEDGE_ITEMS,
} from '../../src/exam/checklist';
import type { FlightSample } from '../../src/exam/subjects';

const CHECKLIST_IDS = CHECKLIST_ITEMS.map((i) => i.id);
const KNOWLEDGE_IDS = SYSTEM_KNOWLEDGE_ITEMS.map((i) => i.id);
const CONTROLLER_IDS = CONTROLLER_CHECK_ITEMS.map((i) => i.id);

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

/** 科目 D 官方序列的定點（左側面一輪 + 右側面一輪）。 */
function genSubjectD(): FlightSample[] {
  const out: FlightSample[] = [];
  const alt = 1.5;
  const push = (tt: number, x: number, y: number, z: number, h: number, sp: number, vyy: number) =>
    out.push(s(tt, x, y, z, h, sp, vyy));
  // 起飛爬升
  for (let i = 0; i <= 40; i++) push(i * DT, 0, Math.min(alt, 0.75 * (i * DT)), 0, 0, 0, i * DT < 2 ? 0.75 : 0);
  let t = 2;
  const steps = subjectDSteps(field);
  let curX = 0;
  let curZ = 0;
  let heading = 0;
  steps.forEach((step) => {
    const dx = step.point.x - curX;
    const dz = step.point.z - curZ;
    const dist = Math.hypot(dx, dz);
    const dur = Math.max(dist / 3, 0.5);
    const n = Math.max(2, Math.round(dur / DT));
    const dh = step.headingDeg - heading;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      push(t + i * DT, curX + dx * f, alt, curZ + dz * f, heading + dh * f, 3, 0);
    }
    t += n * DT;
    curX = step.point.x;
    curZ = step.point.z;
    heading = step.headingDeg;
    for (let i = 1; i <= 110; i++) push(t + i * DT, curX, alt, curZ, heading, 0, 0);
    t += 5.5;
  });
  for (let i = 1; i <= 40; i++) push(t + i * DT, curX, Math.max(0, alt * (1 - i / 40)), curZ, heading, 0, -0.75);
  return out;
}

/**
 * 科目 F 合成飛行：起飛 → 巡航至 (8,−8) → 監評人員下達緊急返航（回傳觸發事件）
 * → 原處懸停 4s → 飛回右內圈上方 1.5m → 1.0 m/s 穩定下降 → 圓心降落。
 */
function genSubjectF(): { samples: FlightSample[]; trigger: { t: number; x: number; z: number } } {
  const out: FlightSample[] = [];
  const alt = 1.5;
  const push = (tt: number, x: number, y: number, z: number, h: number, sp: number, vyy: number) =>
    out.push(s(tt, x, y, z, h, sp, vyy));
  for (let i = 0; i <= 40; i++) push(i * DT, 0, Math.min(alt, 0.75 * (i * DT)), 0, 0, 0, i * DT < 2 ? 0.75 : 0);
  let t = 2;
  // 巡航至觸發點 (8,−8)（較近一側為右圓）。
  const cruiseN = 60;
  for (let i = 1; i <= cruiseN; i++) {
    const f = i / cruiseN;
    push(t + i * DT, 8 * f, alt, -8 * f, 0, 3, 0);
  }
  t += cruiseN * DT;
  const trigger = { t, x: 8, z: -8 };
  // 原處懸停 4s。
  for (let i = 1; i <= 80; i++) push(t + i * DT, 8, alt, -8, 0, 0, 0);
  t += 4;
  // 飛回右內圈圓心 (6,−16) 上方 1.5m。
  const right = field.figure8.rightCircle.center;
  const flyN = 60;
  for (let i = 1; i <= flyN; i++) {
    const f = i / flyN;
    push(t + i * DT, 8 + (right.x - 8) * f, alt, -8 + (right.z + 8) * f, 0, 3, 0);
  }
  t += flyN * DT;
  // 1.0 m/s 穩定下降至圓心。
  const descN = 90;
  for (let i = 1; i <= descN; i++) {
    const f = i / descN;
    push(t + i * DT, right.x, Math.max(0, alt * (1 - f)), right.z, 0, 0, -1.0);
  }
  return { samples: out, trigger };
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

  it('同一會話可連續記錄 B/C/D/F → 四科皆判定為 S（simulatedPass 另見完整考試測試）', () => {
    const sess = new ExamSession();
    // 實際考試：每科一次獨立飛行，起飛前標記所屬科目（否則科目間互相污染）。
    sess.startSubject('B');
    genSubjectB().forEach((smp) => sess.record(smp));
    sess.startSubject('C');
    genSubjectC().forEach((smp) => sess.record(smp));
    sess.startSubject('D');
    genSubjectD().forEach((smp) => sess.record(smp));
    sess.startSubject('F');
    const f = genSubjectF();
    f.samples.forEach((smp) => sess.record(smp));
    // 監評人員在空中下達緊急返航（觸發事件）。
    sess.triggerEmergency(f.trigger.t, f.trigger.x, f.trigger.z);
    const res = sess.finalize(config, field);
    expect(res.subjectB.rating).toBe('S');
    expect(res.subjectC.rating).toBe('S');
    expect(res.subjectD.rating).toBe('S');
    expect(res.subjectF.rating).toBe('S');
    expect(res.report.items[1].rating).toBe('S');
    expect(res.report.items[2].rating).toBe('S');
    expect(res.report.items[3].rating).toBe('S');
    expect(res.report.items[5].rating).toBe('S');
    // 未做 A／G 地面檢查 → simulatedPass 不成立（完整考試流程見下一個測試）。
    expect(res.report.simulatedPass).toBe(false);
  });

  it('完整考試：A 飛行前檢查 → B/C/D/F → G 飛行後檢查 → 六科皆 S', () => {
    const sess = new ExamSession();
    // 科目 A：飛行前 360 度檢查（逆時針繞行＋附件3 飛行前欄＋知識＋遙控器）。
    sess.startSubject('A');
    ['nose', 'left', 'tail', 'right'].forEach((st) => sess.recordStation(st as 'nose'));
    CHECKLIST_IDS.forEach((id) => sess.recordChecklist(id, 'pre', true));
    KNOWLEDGE_IDS.forEach((id) => sess.recordKnowledge(id, true));
    CONTROLLER_IDS.forEach((id) => sess.recordControllerCheck(id, true));
    // 科目 B/C/D/F。
    sess.startSubject('B');
    genSubjectB().forEach((smp) => sess.record(smp));
    sess.startSubject('C');
    genSubjectC().forEach((smp) => sess.record(smp));
    sess.startSubject('D');
    genSubjectD().forEach((smp) => sess.record(smp));
    sess.startSubject('F');
    const f = genSubjectF();
    f.samples.forEach((smp) => sess.record(smp));
    sess.triggerEmergency(f.trigger.t, f.trigger.x, f.trigger.z);
    // 科目 G：飛行後 360 度檢查（逆時針繞行＋附件3 飛行後欄）。
    sess.startSubject('G');
    ['nose', 'left', 'tail', 'right'].forEach((st) => sess.recordStation(st as 'nose'));
    CHECKLIST_IDS.forEach((id) => sess.recordChecklist(id, 'post', true));
    const res = sess.finalize(config, field);
    expect(res.subjectA.rating).toBe('S');
    expect(res.subjectG.rating).toBe('S');
    expect(res.report.items[0].rating).toBe('S');
    expect(res.report.items[6].rating).toBe('S');
    expect(res.report.simulatedPass).toBe(true);
    // 僅 E（高度保持五邊飛行）未涵蓋。
    expect(res.report.items[4].rating).toBeNull();
  });

  it('未進行飛行前檢查（無地面記錄）→ subjectA=N 且 simulatedPass=false', () => {
    const sess = new ExamSession();
    sess.startSubject('B');
    genSubjectB().forEach((smp) => sess.record(smp));
    const res = sess.finalize(config, field);
    expect(res.subjectA.rating).toBe('N');
    expect(res.report.simulatedPass).toBe(false);
  });

  it('科目 F 未下達緊急返航 → subjectF=N（未執行）且 simulatedPass=false', () => {
    const sess = new ExamSession();
    sess.startSubject('F');
    genSubjectF().samples.forEach((smp) => sess.record(smp));
    const res = sess.finalize(config, field);
    expect(res.subjectF.rating).toBe('N');
    expect(res.subjectF.failReasonKeys).toContain('subjectF.notTriggered');
    expect(res.report.simulatedPass).toBe(false);
  });

  it('startSubject 切換後各科只看到自己的切片（D 的直飛不污染 C 的八字）', () => {
    const sess = new ExamSession();
    sess.startSubject('C');
    genSubjectC().forEach((smp) => sess.record(smp));
    // 同一會話接著飛 D：D 的 P3↔P7 往返直線會切進八字盒。
    sess.startSubject('D');
    genSubjectD().forEach((smp) => sess.record(smp));
    const res = sess.finalize(config, field);
    expect(res.subjectC.rating).toBe('S');
    expect(res.subjectC.raw.maxPathDeviationM).toBe(0);
    // 未應考 B → B 為未執行。
    expect(res.subjectB.rating).toBe('N');
  });

  it('clear() 後樣本數歸零', () => {
    const sess = new ExamSession();
    genSubjectB().forEach((smp) => sess.record(smp));
    expect(sess.getSampleCount()).toBeGreaterThan(0);
    sess.clear();
    expect(sess.getSampleCount()).toBe(0);
  });
});
