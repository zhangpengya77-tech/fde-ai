import { describe, expect, it } from 'vitest';
import { ScriptedPilot } from '../../src/exam/scripted-pilot';
import type { ExamFlightSnapshot } from '../../src/exam/types';

function snap(over: Partial<ExamFlightSnapshot> = {}): ExamFlightSnapshot {
  return {
    state: 'flying',
    mode: 'position',
    position: { x: 0, y: 1.5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    rollDeg: 0,
    pitchDeg: 0,
    headingDeg: 0,
    altitudeM: 1.5,
    horizontalSpeedMps: 0,
    verticalSpeedMps: 0,
    windVector: { x: 0, y: 0, z: 0 },
    positionHoldCompensating: false,
    ...over,
  };
}

describe('ScriptedPilot — 定點懸停', () => {
  it('已在定點且靜止 → 精確放桿（roll/pitch = 0），讓定位保持接手', () => {
    const p = new ScriptedPilot();
    p.hold({ x: 0, z: 0 }, 0, 1.5);
    const c = p.update(snap(), 1 / 60);
    expect(c.roll).toBe(0);
    expect(c.pitch).toBe(0);
    expect(c.throttle).toBe(0.5); // 高度達標 → 回中自動定高
  });

  it('遠離定點 → 朝定點給桿（世界 +X 的定點、航向 0 → 右移為正 roll）', () => {
    const p = new ScriptedPilot();
    p.hold({ x: 2, z: 0 }, null, 1.5);
    const c = p.update(snap({ position: { x: 0, y: 1.5, z: 0 } }), 1 / 60);
    expect(c.roll).toBeGreaterThan(0);
    expect(c.pitch).toBe(0);
  });

  it('定位保持生效時不再重複補償（有效風視為 0，維持放桿）', () => {
    const p = new ScriptedPilot();
    p.hold({ x: 0, z: 0 }, 0, 1.5);
    const c = p.update(
      snap({ velocity: { x: 0, y: 0, z: 0 }, windVector: { x: 5, y: 0, z: 0 }, positionHoldCompensating: true }),
      1 / 60,
    );
    expect(c.roll).toBe(0);
    expect(c.pitch).toBe(0);
  });

  it('偏航誤差大 → 輸出偏航；進入死區 → 偏航歸零', () => {
    const p = new ScriptedPilot({ headingDeadzoneDeg: 1 });
    p.hold({ x: 0, z: 0 }, 90, 1.5);
    expect(p.update(snap({ headingDeg: 0 }), 1 / 60).yaw).toBeGreaterThan(0);
    expect(p.update(snap({ headingDeg: 90.5 }), 1 / 60).yaw).toBe(0);
  });

  it('高度過低 → 油門推高；過高 → 油門拉低', () => {
    const p = new ScriptedPilot();
    p.hold({ x: 0, z: 0 }, 0, 1.5);
    expect(p.update(snap({ position: { x: 0, y: 1.0, z: 0 } }), 1 / 60).throttle).toBeGreaterThan(0.5);
    expect(p.update(snap({ position: { x: 0, y: 2.0, z: 0 } }), 1 / 60).throttle).toBeLessThan(0.5);
  });
});

describe('ScriptedPilot — 風', () => {
  it('有風時以觀測風做前饋：同樣的位置誤差，頂風/順風會改變搖桿量', () => {
    const target = { x: 0, z: -1 };
    const still = snap({ position: { x: 0, y: 1.5, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
    const calm = new ScriptedPilot();
    calm.hold(target, 0, 1.5);
    const windy = new ScriptedPilot();
    windy.hold(target, 0, 1.5);
    const calmPitch = calm.update(still, 1 / 60).pitch;
    // 尾風（+Z，把機體推離 −Z 的目標）→ 需要更多前推桿。
    const windyPitch = windy.update(
      snap({ ...still, windVector: { x: 0, y: 0, z: 0.5 } }),
      1 / 60,
    ).pitch;
    expect(calmPitch).toBeGreaterThan(0); // 目標在 −Z（前方）→ 前推桿為正
    // 尾風把機體推離目標 → 需要更多前推桿（前饋補償）。
    expect(windyPitch).toBeGreaterThan(calmPitch);
  });

  it('關閉風補償時不輸出頂風修正', () => {
    const p = new ScriptedPilot({ compensateWind: false });
    p.hold({ x: 0, z: 0 }, 0, 1.5);
    const c = p.update(snap({ windVector: { x: 5, y: 0, z: 0 } }), 1 / 60);
    expect(c.roll).toBe(0);
    expect(c.pitch).toBe(0);
  });
});

describe('ScriptedPilot — 路徑跟隨', () => {
  const line = [
    { x: 0, z: 0 },
    { x: 0, z: -10 },
  ];

  it('路徑起點即當前位置 → 先放桿（參考點尚未離開）', () => {
    const p = new ScriptedPilot();
    p.followPath(line, 3, 1.5, 0);
    const c = p.update(snap(), 1 / 60);
    expect(c.pitch).toBe(0);
    expect(c.roll).toBe(0);
  });

  it('參考點推進後：沿 -Z 路徑、航向 0 → 前推桿為正', () => {
    const p = new ScriptedPilot();
    p.followPath(line, 3, 1.5, 0);
    for (let i = 0; i < 30; i += 1) p.update(snap(), 1 / 60); // 參考點前進 1.5m
    const c = p.update(snap(), 1 / 60);
    expect(c.pitch).toBeGreaterThan(0);
    expect(c.roll).toBeCloseTo(0, 5);
  });

  it('progress 隨時間前進並在終點收斂到 1', () => {
    const p = new ScriptedPilot();
    p.followPath(line, 3, 1.5, 0);
    expect(p.progress).toBe(0);
    for (let i = 0; i < 60 * 10; i += 1) p.update(snap(), 1 / 60);
    expect(p.progress).toBe(1);
  });

  it("機頭朝切向（'tangent'）：-Z 路徑 → 目標航向 0", () => {
    const p = new ScriptedPilot();
    p.followPath(line, 3, 1.5, 'tangent');
    // 航向已在 0（等於切向）→ 不輸出偏航。
    expect(p.update(snap({ headingDeg: 0 }), 1 / 60).yaw).toBe(0);
    // 航向 90 → 需右轉回 0？不，切向是 -Z（heading 0），誤差 -90 → 左轉。
    expect(p.update(snap({ headingDeg: 90 }), 1 / 60).yaw).toBeLessThan(0);
  });

  it('pause 期間輸出精確放桿', () => {
    const p = new ScriptedPilot();
    p.followPath(line, 3, 1.5, 'tangent');
    p.pause(1);
    const c = p.update(snap({ velocity: { x: 0, y: 0, z: -3 } }), 1 / 60);
    expect(c.roll).toBe(0);
    expect(c.pitch).toBe(0);
  });

  it('搖桿量不超過 ±1', () => {
    const p = new ScriptedPilot({ maxSpeedMps: 8 });
    p.hold({ x: 500, z: 500 }, 180, 3);
    const c = p.update(snap({ position: { x: 0, y: 0, z: 0 } }), 1 / 60);
    expect(Math.abs(c.roll)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.pitch)).toBeLessThanOrEqual(1);
    expect(c.throttle).toBeLessThanOrEqual(1);
    expect(c.throttle).toBeGreaterThanOrEqual(0);
  });
});
