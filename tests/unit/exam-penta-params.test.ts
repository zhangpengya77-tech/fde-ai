import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import caaExamJson from '../../config/caa-exam.json';
import examAircraftJson from '../../config/exam-aircraft.json';
import { loadExamAircraftParams, loadExamConfig } from '../../src/exam/config';
import { buildExamField } from '../../src/exam/field';
import { createExamScene } from '../../src/exam/scene';
import { createPentaScene } from '../../src/exam/penta-scene';
import { buildTeachingPentaRoute } from '../../src/exam/penta';

/**
 * P0-B 機體參數一致性（只讀檢查，不對任何配置或幾何做修改）。
 *
 * 檢查四處參數來源：
 *  1. config/exam-aircraft.json  sampleAircraft.diagonalSpanCm（附件十二級別 I 軸距 90–110cm）
 *  2. src/exam/scene.ts          ExamDrone 實際馬達對角距（以場景物件實測）
 *  3. src/exam/penta-scene.ts    PentaDrone 教學機馬達半徑（源碼常數）
 *  4. config/caa-exam.json       官方考試規範（無軸距欄位；官方來源為附件十二）
 */

const config = loadExamConfig();
const field = buildExamField(config);
const route = buildTeachingPentaRoute(field, config.subjects.E.params.operationAltitudeM);

/** 實測考試場景 ExamDrone 的馬達對角距（m）。 */
function measureExamDroneDiagonalM(): number {
  const scene = new THREE.Scene();
  createExamScene(scene, field);
  const motors: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (/^Motor(Front|Rear)(Left|Right)$/.test(o.name)) motors.push(o);
  });
  expect(motors).toHaveLength(4);
  const byName = new Map(motors.map((m) => [m.name, m.position]));
  const pairs: Array<[string, string]> = [
    ['MotorFrontLeft', 'MotorRearRight'],
    ['MotorFrontRight', 'MotorRearLeft'],
  ];
  let sum = 0;
  for (const [a, b] of pairs) {
    const pa = byName.get(a)!;
    const pb = byName.get(b)!;
    sum += Math.hypot(pa.x - pb.x, pa.z - pb.z);
  }
  return sum / pairs.length;
}

describe('P0-B 參數一致性 — exam-aircraft.json（樣機軸距）', () => {
  const span = examAircraftJson.sampleAircraft.diagonalSpanCm;

  it('diagonalSpanCm 值落在附件十二級距 I 官方區間 90–110cm', () => {
    expect(span.value).toBeGreaterThanOrEqual(span.rangeCm[0]);
    expect(span.value).toBeLessThanOrEqual(span.rangeCm[1]);
  });

  it('來源標註附件十二（級別 I）', () => {
    expect(span.source).toContain('附件十二');
  });

  it('sampleAircraft 其餘參數標記為模擬假設、非官方', () => {
    const others = examAircraftJson.sampleAircraft as unknown as Record<string, { source?: string }>;
    expect(others.maxTiltDeg.source).toContain('模擬假設');
    expect(others.maxHorizontalSpeedMps.source).toContain('模擬假設');
  });
});

describe('P0-B 參數一致性 — scene.ts 實際機體尺寸（實測）', () => {
  it('ExamDrone 馬達對角距為 1.00m，與 exam-aircraft.json diagonalSpanCm=100 一致', () => {
    const measured = measureExamDroneDiagonalM();
    expect(measured).toBeCloseTo(1.0, 6);
    expect(measured * 100).toBeCloseTo(examAircraftJson.sampleAircraft.diagonalSpanCm.value, 6);
  });

  it('場景源碼註解與實測一致（1.00m；舊註解「約 1.1m」已修正）', async () => {
    const src = (await import('../../src/exam/scene.ts?raw')).default as string;
    // 程式碼幾何：馬達半徑 0.5 → 對角 1.00m。
    expect(src).toContain('Math.cos(angle) * 0.5');
    // 註解已與實測一致：宣告「對角 1.00m」。
    expect(src).toMatch(/對角 1\.00m/);
    // 舊的「約 1.1m」文件不一致註解已移除（第四輪參數工具 WARN 收斂）。
    expect(src).not.toMatch(/對角約 1\.1m/);
  });

  it('PentaDrone 教學機馬達半徑同為 0.5（源碼常數，對角 1.00m）', async () => {
    const src = (await import('../../src/exam/penta-scene.ts?raw')).default as string;
    expect(src).toContain('Math.cos(angle) * 0.5');
  });
});

describe('P0-B 參數一致性 — caa-exam.json 官方規範', () => {
  it('caa-exam.json aircraft 記录樣機軸距 100cm（與 exam-aircraft.json 一致）', () => {
    const d = caaExamJson.aircraft.sampleAircraftDefaults;
    expect(d.diagonalSpanCm).toBe(100);
    expect(d.diagonalSpanRangeCm).toEqual([90, 110]);
    // 數值標記為模擬預設（非官方公告值）。
    expect(d.note).toContain('模擬預設');
    expect(d.diagonalSpanCm).toBe(examAircraftJson.sampleAircraft.diagonalSpanCm.value);
  });

  it('aircraft.levelSourceNote 標明官方來源為附件十二', () => {
    expect(caaExamJson.aircraft.levelSourceNote).toContain('附件十二');
    expect(caaExamJson.aircraft.source).toContain('附件十二');
  });
});

describe('P0-B 參數一致性 — 飛控參數依賴', () => {
  it('飛控 8 參數不含軸距（軸距不參與動力學）', () => {
    const params = loadExamAircraftParams() as unknown as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual([
      'accelerationMps2',
      'attitudeRateLimitDegPerS',
      'attitudeTimeConstantS',
      'dragCoefficient',
      'horizontalVelocityTimeConstantS',
      'massKg',
      'maxHorizontalSpeedMps',
      'maxTiltDeg',
    ]);
  });

  it('級距 I 樣機註記：附件十二軸距 90–110cm、起飛重量 ≥4kg', () => {
    const l1 = examAircraftJson.levels.find((l) => l.level === 'I');
    expect(l1?.sampleAircraft).toContain('軸距90–110cm');
  });
});

describe('P0-B 參數一致性 — 教學場景隔離', () => {
  it('PentaDrone 與 ExamDrone 互不共用（各自獨立群組）', () => {
    const scene = new THREE.Scene();
    createExamScene(scene, field);
    const pentaScene = new THREE.Scene();
    createPentaScene(pentaScene, field, route, { airspace: null, altitudeM: route.altitudeM });
    expect(scene.getObjectByName('ExamDrone')).toBeTruthy();
    expect(pentaScene.getObjectByName('PentaDrone')).toBeTruthy();
    expect(pentaScene.getObjectByName('ExamDrone')).toBeFalsy();
    expect(scene.getObjectByName('PentaDrone')).toBeFalsy();
  });
});
