import { describe, expect, it } from 'vitest';
import { buildExamField } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import {
  detectAutoMajorFailures,
  detectMajorFailures,
  MANUAL_MAJOR_FAILURES,
  AUTO_MAJOR_FAILURES,
} from '../../src/exam/major-failures';
import type { FlightSample } from '../../src/exam/subjects';

const config = loadExamConfig();
const field = buildExamField(config);

function s(t: number, x: number, y: number, z: number): FlightSample {
  return { t, x, y, z, headingDeg: 0, speedMps: 0, vy: 0, mode: 'position' };
}

describe('重大違失 — 清白飛行應無任何違失', () => {
  it('正常起降 + 八字（無低空近錐/越區/越後方）→ hasAny=false', () => {
    // 沿八字左圓飛一圈（高度 1.5，不觸發低空撞錐）。
    const out: FlightSample[] = [];
    for (let i = 0; i <= 10; i += 1) out.push(s(i * 0.05, 0, 1.5, -16 + (i / 10) * 0));
    for (let a = 0; a <= 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      out.push(s(out.length * 0.05, -6 + 6 * Math.cos(rad), 1.5, -16 + 6 * Math.sin(rad)));
    }
    const r = detectMajorFailures(out, field);
    expect(r.hasAny).toBe(false);
    r.items.forEach((it) => expect(it.detected).toBe(false));
  });
});

describe('重大違失 — 自動項① 撞擊角錐（低空）', () => {
  it('低空（y=0.3）重疊角錐 P2 → hitCone=true', () => {
    const p2 = field.figure8.cones.P2;
    const r = detectAutoMajorFailures([s(0, p2.x, 0.3, p2.z)], field);
    const hc = r.find((d) => d.code === 'hitCone')!;
    expect(hc.detected).toBe(true);
  });
  it('高飛（y=1.5）掠過同一角錐位置 → 不算撞擊（高度門檻）', () => {
    const p2 = field.figure8.cones.P2;
    const r = detectAutoMajorFailures([s(0, p2.x, 1.5, p2.z)], field);
    const hc = r.find((d) => d.code === 'hitCone')!;
    expect(hc.detected).toBe(false);
  });
});

describe('重大違失 — 自動項① 墜落', () => {
  it('高度跌破地面（y=-0.5）→ crash=true', () => {
    const r = detectAutoMajorFailures([s(0, 0, 1.5, 0), s(0.05, 0, -0.5, 0)], field);
    const cr = r.find((d) => d.code === 'crash')!;
    expect(cr.detected).toBe(true);
  });
});

describe('重大違失 — 自動項① 超越應考人後方', () => {
  it('z 超過後方界線（z=4 > 3）→ beyondExamineeRear=true', () => {
    const r = detectAutoMajorFailures([s(0, 0, 1.5, 4)], field);
    const b = r.find((d) => d.code === 'beyondExamineeRear')!;
    expect(b.detected).toBe(true);
  });
  it('正常前向飛行（z=-16）→ 不觸發', () => {
    const r = detectAutoMajorFailures([s(0, 0, 1.5, -16)], field);
    const b = r.find((d) => d.code === 'beyondExamineeRear')!;
    expect(b.detected).toBe(false);
  });
});

describe('重大違失 — 自動項① 失控/離開操作區', () => {
  it('x 超出操作區半寬（x=20 > 15）→ outOfOperationArea=true', () => {
    const r = detectAutoMajorFailures([s(0, 20, 1.5, 0)], field);
    const oa = r.find((d) => d.code === 'outOfOperationArea')!;
    expect(oa.detected).toBe(true);
  });
  it('區內飛行（x=10, z=-16）→ 不觸發', () => {
    const r = detectAutoMajorFailures([s(0, 10, 1.5, -16)], field);
    const oa = r.find((d) => d.code === 'outOfOperationArea')!;
    expect(oa.detected).toBe(false);
  });
});

describe('重大違失 — 手動旗標（官方項②③④）', () => {
  it('預設無手動旗標 → 全部 detected=false', () => {
    const r = detectMajorFailures([], field);
    MANUAL_MAJOR_FAILURES.forEach((m) => {
      const it = r.items.find((i) => i.code === m.code)!;
      expect(it.detected).toBe(false);
      expect(it.auto).toBe(false);
    });
  });
  it('監評認定 examinerIntervene → 該項 detected=true 且 hasAny=true', () => {
    const r = detectMajorFailures([], field, { examinerIntervene: true });
    const it = r.items.find((i) => i.code === 'examinerIntervene')!;
    expect(it.detected).toBe(true);
    expect(r.hasAny).toBe(true);
  });
  it('三項手動皆可個別標記', () => {
    const r = detectMajorFailures([], field, { disorder: true, identityFraud: true });
    expect(r.items.find((i) => i.code === 'disorder')!.detected).toBe(true);
    expect(r.items.find((i) => i.code === 'identityFraud')!.detected).toBe(true);
    expect(r.items.find((i) => i.code === 'examinerIntervene')!.detected).toBe(false);
  });
});

describe('重大違失 — 結構與官方對應', () => {
  it('自動項為 4 項、手動項為 3 項，合計 7', () => {
    expect(AUTO_MAJOR_FAILURES.length).toBe(4);
    expect(MANUAL_MAJOR_FAILURES.length).toBe(3);
    const r = detectMajorFailures([], field);
    expect(r.items.length).toBe(7);
  });
});
