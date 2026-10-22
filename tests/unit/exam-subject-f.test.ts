/**
 * 科目 F 判定單元測試（緊急處置程序，AC 107-005D p166）。
 *
 * 以合成飛行樣本直接測 judgeSubjectF 的純函式行為（不經飛控）；
 * 「真的飛完科目」的端到端驗證（真實飛控積分＋風場）見 exam-e2e-subject-f.test.ts。
 *
 * 官方準則重點（p166）：監評人員在空中任一位置下達「緊急返航」→ 應考人立即原處
 * 懸停 → 自行判斷後以合理下滑角度穩定進場 → 飛回相對較近一側八字內圈上方約
 * 1~2m → 精準降落於內圈；不得壓到標線或撞擊角錐。
 */

import { describe, expect, it } from 'vitest';
import { buildExamField, subjectDWaypoints } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { judgeSubjectF, type SubjectFTrigger } from '../../src/exam/subject-f';
import type { FlightSample } from '../../src/exam/subjects';

const config = loadExamConfig();
const field = buildExamField(config);

const DT = 0.05;

function s(t: number, x: number, y: number, z: number, heading: number, speed: number, vy = 0): FlightSample {
  // 合成樣本視為無風（對地速度＝對空速度）。
  return { t, x, y, z, headingDeg: heading, speedMps: speed, groundSpeedMps: speed, vy, mode: 'position' };
}

/** 右圓圓心（較近一側目標；P3=(−6,−22)、P7=(6,−22)、H=(0,0)）。 */
const RIGHT_CENTER = field.figure8.rightCircle.center; // { x: 6, z: -16 }
const RIGHT_RADIUS = field.figure8.rightCircle.radiusM; // 6
const P7_CONE = field.figure8.cones.P7; // 右圓底端角錐 (6,−22)

interface GenOptions {
  /** 緊急返航觸發時間（null = 監評人員從未下達）。 */
  triggerT?: number | null;
  /** 觸發位置（預設 (10, −6)，較近一側為右圓）。 */
  triggerPos?: { x: number; z: number };
  /** 原處懸停秒數（0 = 不懸停，直接飛走）。 */
  holdS?: number;
  /** 懸停點偏移（模擬漂移；預設 0）。 */
  holdOffset?: { x: number; z: number };
  /** 進場飛行高度（預設 1.5，在 [1,2] 內）。 */
  approachAltM?: number;
  /** 下降速率（m/s；預設 1.0 ≤ 1.5 上限）。 */
  descentRateMps?: number;
  /** 落點（預設右圓圓心）。 */
  landing?: { x: number; z: number };
  /** 是否先飛到內圈上方再前往落點（false = 從未進入內圈）。 */
  viaCircle?: boolean;
}

/**
 * 合成一次科目 F 飛行：起飛 → 五邊待命巡航 →（triggerT 時）緊急返航 →
 * 原處懸停 → 飛回內圈上方 → 穩定下降 → 降落。
 */
function genSubjectF(opts: GenOptions = {}): { samples: FlightSample[]; trigger: SubjectFTrigger | null } {
  const triggerT = opts.triggerT === undefined ? 12 : opts.triggerT;
  // 時間軸數值（未觸發時仍合成完整飛行，但回傳 trigger=null → 判定為未執行）。
  const triggerTime = triggerT ?? 12;
  const triggerPos = opts.triggerPos ?? { x: 10, z: -6 };
  const holdS = opts.holdS ?? 4;
  const holdOffset = opts.holdOffset ?? { x: 0, z: 0 };
  const approachAlt = opts.approachAltM ?? 1.5;
  const descentRate = opts.descentRateMps ?? 1.0;
  const landing = opts.landing ?? { x: RIGHT_CENTER.x, z: RIGHT_CENTER.z };
  const viaCircle = opts.viaCircle ?? true;

  const out: FlightSample[] = [];
  const push = (t: number, x: number, y: number, z: number, h: number, sp: number, vy: number): void => {
    out.push(s(t, x, y, z, h, sp, vy));
  };
  const cruiseAlt = 1.5;
  let t = 0;

  // 起飛爬升（y < 0.15 不算空中）。
  for (let i = 0; i <= 40; i += 1) push(i * DT, 0, Math.min(cruiseAlt, 0.75 * i * DT), 0, 0, 0, i < 27 ? 0 : 0);
  t = 2;
  // 五邊待命巡航：H → 觸發點（直飛，模擬進場中的任一所問位置）。
  const cruiseDur = 3;
  const cruiseN = Math.round(cruiseDur / DT);
  for (let i = 1; i <= cruiseN; i += 1) {
    const f = i / cruiseN;
    push(t + i * DT, triggerPos.x * f, cruiseAlt, triggerPos.z * f, 0, 3, 0);
  }
  t += cruiseN * DT;

  const trigger: SubjectFTrigger | null =
    triggerT === null ? null : { t: triggerT, x: triggerPos.x, z: triggerPos.z };

  // 緊急返航後：原處懸停 holdS 秒（位置 = 觸發點 + 偏移）。
  const holdPoint = { x: triggerPos.x + holdOffset.x, z: triggerPos.z + holdOffset.z };
  if (holdS > 0) {
    const holdN = Math.round(holdS / DT);
    for (let i = 1; i <= holdN; i += 1) push(triggerTime + i * DT, holdPoint.x, cruiseAlt, holdPoint.z, 0, 0, 0);
    t = triggerTime + holdN * DT;
  } else {
    t = triggerTime;
  }

  // 飛回內圈上方 approachAlt（若 viaCircle），再前往落點。
  const target = viaCircle ? { x: RIGHT_CENTER.x, z: RIGHT_CENTER.z } : landing;
  const dist = Math.hypot(target.x - holdPoint.x, target.z - holdPoint.z);
  const flyDur = Math.max(dist / 3, 0.5);
  const flyN = Math.max(2, Math.round(flyDur / DT));
  for (let i = 1; i <= flyN; i += 1) {
    const f = i / flyN;
    push(
      t + i * DT,
      holdPoint.x + (target.x - holdPoint.x) * f,
      approachAlt,
      holdPoint.z + (target.z - holdPoint.z) * f,
      0,
      3,
      0,
    );
  }
  t += flyN * DT;

  if (viaCircle && (landing.x !== RIGHT_CENTER.x || landing.z !== RIGHT_CENTER.z)) {
    // 已在內圈上方，再橫移到落點（例如改降落於 H 或角錐）。
    const d2 = Math.hypot(landing.x - target.x, landing.z - target.z);
    const n2 = Math.max(2, Math.round(d2 / 3 / DT));
    for (let i = 1; i <= n2; i += 1) {
      const f = i / n2;
      push(
        t + i * DT,
        target.x + (landing.x - target.x) * f,
        approachAlt,
        target.z + (landing.z - target.z) * f,
        0,
        3,
        0,
      );
    }
    t += n2 * DT;
  }

  // 穩定下降至落點（descentRate），觸地後停留幾帧。
  const descendN = Math.max(2, Math.round(approachAlt / descentRate / DT));
  for (let i = 1; i <= descendN; i += 1) {
    const f = i / descendN;
    push(t + i * DT, landing.x, Math.max(0, approachAlt * (1 - f)), landing.z, 0, 0, -descentRate);
  }
  t += descendN * DT;
  for (let i = 1; i <= 10; i += 1) push(t + i * DT, landing.x, 0, landing.z, 0, 0, 0);

  return { samples: out, trigger };
}

function judge(opts: GenOptions = {}) {
  const { samples, trigger } = genSubjectF(opts);
  return judgeSubjectF(samples, config, field, trigger);
}

describe('科目 F 緊急處置程序 — 場地與官方量測', () => {
  it('較近一側八字圓：觸發點 (10,−6) 判為右圓', () => {
    const r = judge();
    expect(r.raw.circleSide).toBe('right');
    expect(r.raw.circleCenterX).toBeCloseTo(RIGHT_CENTER.x, 6);
    expect(r.raw.circleCenterZ).toBeCloseTo(RIGHT_CENTER.z, 6);
  });

  it('未下達緊急返航 → N（未執行）', () => {
    const r = judge({ triggerT: null });
    expect(r.rating).toBe('N');
    expect(r.failReasonKeys).toContain('subjectF.notTriggered');
  });
});

describe('科目 F 緊急處置程序 — 理想操作 → S', () => {
  it('立即原處懸停 4s → 穩定進場 1.0m/s → 內圈上方 1.5m → 圓心降落 → S', () => {
    const r = judge();
    expect(r.rating).toBe('S');
    expect(r.failReasonKeys).toEqual([]);
    expect(r.raw.holdSeconds).toBeGreaterThanOrEqual(3.8);
    expect(r.raw.holdDriftM).toBeLessThanOrEqual(1.0);
    expect(r.raw.arrivalAltitudeM).toBeGreaterThanOrEqual(1);
    expect(r.raw.arrivalAltitudeM).toBeLessThanOrEqual(2);
    expect(r.raw.landingDistanceM).toBeLessThanOrEqual(RIGHT_RADIUS + 1.0);
    expect(r.raw.coneHitIds).toEqual([]);
    expect(r.raw.maxDescentRateMps).toBeGreaterThanOrEqual(-1.5);
  });
});

describe('科目 F 緊急處置程序 — 不良操作 → U', () => {
  it('未原處懸停（接獲即飛走）→ immediateHoldFail', () => {
    const r = judge({ holdS: 0 });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.immediateHoldFail');
  });

  it('原處懸停只有 1.5s（< 3s 容差 2.8s）→ immediateHoldFail', () => {
    const r = judge({ holdS: 1.5 });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.immediateHoldFail');
  });

  it('懸停點漂移 2m（> 1m 容差）→ immediateHoldFail', () => {
    const r = judge({ holdOffset: { x: 2, z: 0 } });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.immediateHoldFail');
  });

  it('下降率 2.5 m/s（> 1.5 上限）→ stableApproachFail', () => {
    const r = judge({ descentRateMps: 2.5 });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.stableApproachFail');
    expect(r.raw.maxDescentRateMps).toBeLessThan(-1.5);
  });

  it('未飛回內圈（直接落於 H）→ circleArrivalFail + landingFail', () => {
    const r = judge({ viaCircle: false, landing: { x: 0, z: 0 } });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.circleArrivalFail');
    expect(r.failReasonKeys).toContain('subjectF.landingFail');
  });

  it('內圈上方 3m 才進場（超出 1~2m）→ circleArrivalFail', () => {
    const r = judge({ approachAltM: 3 });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.circleArrivalFail');
    expect(r.raw.arrivalAltitudeM).toBeCloseTo(3, 6);
  });

  it('降落壓到角錐 P7 → coneHitFail', () => {
    const r = judge({ viaCircle: true, landing: { x: P7_CONE.x, z: P7_CONE.z } });
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.coneHitFail');
    expect(r.raw.coneHitIds).toContain('P7');
  });

  it('觸發點在左圓正上方 → 較近一側判為左圓', () => {
    const r = judge({ triggerPos: { x: -10, z: -6 } });
    expect(r.raw.circleSide).toBe('left');
    // 落點仍為右圓圓心（劇本未跟著改）→ 距離過遠，降落判定不通過。
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectF.landingFail');
  });
});

describe('科目 F — 場地幾何一致性', () => {
  it('P3↔P7 間距 12m（與科目 D 同一場地）', () => {
    const w = subjectDWaypoints(field);
    expect(Math.hypot(w.p7.x - w.p3.x, w.p7.z - w.p3.z)).toBeCloseTo(12, 6);
  });
});
