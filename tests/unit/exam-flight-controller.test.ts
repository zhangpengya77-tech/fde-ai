import { describe, expect, it } from 'vitest';
import { ExamFlightController } from '../../src/exam/flight-controller';
import type { ExamAircraftParams, ExamStickCommand } from '../../src/exam/types';

const PARAMS: ExamAircraftParams = {
  massKg: 4,
  maxTiltDeg: 25,
  maxHorizontalSpeedMps: 8,
  accelerationMps2: 2.5,
  dragCoefficient: 0.6,
  horizontalVelocityTimeConstantS: 0.7,
  attitudeTimeConstantS: 0.45,
  attitudeRateLimitDegPerS: 45,
};

const NEUTRAL: ExamStickCommand = { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 };

/** 前推到滿舵的指令（機頭應前進）。 */
const FORWARD: ExamStickCommand = { roll: 0, pitch: 1, yaw: 0, throttle: 0.5 };
const RIGHT: ExamStickCommand = { roll: 1, pitch: 0, yaw: 0, throttle: 0.5 };
const YAW_RIGHT: ExamStickCommand = { roll: 0, pitch: 0, yaw: 1, throttle: 0.5 };

function stepFor(c: ExamFlightController, cmd: ExamStickCommand, seconds: number, dt = 0.02): void {
  const n = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < n; i += 1) c.update(cmd, dt);
}

/** 起飛並穩定到目標高度（預設 2m），確保進入自由飛狀態。 */
function airborne(c: ExamFlightController, cmd: ExamStickCommand = NEUTRAL, seconds = 2.5): void {
  stepFor(c, cmd, seconds);
}

describe('ExamFlightController — 模式與慣性', () => {
  it('方向約定與全專案一致：前推使 z 減小（機頭朝 −Z），右打使 x 增大', () => {
    // 定位模式最單純（速度命令模型），用來驗證方向。
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(2);
    stepFor(c, NEUTRAL, 2); // 先穩定到 2m
    const before = c.snapshot().position;
    stepFor(c, FORWARD, 2);
    const afterFwd = c.snapshot().position;
    expect(afterFwd.z).toBeLessThan(before.z - 1); // 前進 = −Z
    stepFor(c, NEUTRAL, 1);
    stepFor(c, RIGHT, 2);
    const afterRight = c.snapshot().position;
    expect(afterRight.x).toBeGreaterThan(afterFwd.x + 1); // 右移 = +X
  });

  it('偏航右打使 heading 角增加（順時針從上方看）', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(2);
    airborne(c);
    const h0 = c.snapshot().headingDeg;
    stepFor(c, YAW_RIGHT, 1); // 60°/s × 1s ≈ 60°
    const h1 = c.snapshot().headingDeg;
    expect(h1).toBeGreaterThan(h0 + 50);
    expect(h1).toBeLessThanOrEqual(360);
  });

  it('重型機慣性：速度不可瞬達指令，先爬升再趨近（τ=0.7s 起停延遲）', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(2);
    stepFor(c, NEUTRAL, 1);
    stepFor(c, FORWARD, 0.2); // 極短推桿
    const early = c.snapshot().horizontalSpeedMps;
    expect(early).toBeLessThan(2); // 尚未到達 8 m/s
    stepFor(c, FORWARD, 3); // 足夠長
    const late = c.snapshot().horizontalSpeedMps;
    expect(late).toBeGreaterThan(6); // 已趨近 maxSpeed 8
  });

  it('手動模式：放桿後不會自動回正，姿態保持（無輔助）', () => {
    const c = new ExamFlightController(PARAMS, { yawRateLimitDegPerS: 45 });
    c.setMode('manual');
    c.arm();
    c.takeoff(2);
    airborne(c);
    stepFor(c, FORWARD, 1); // 用滿舵，手動模式傾角直接到 +25°
    const tilted = c.snapshot().pitchDeg;
    expect(tilted).toBeGreaterThan(20);
    stepFor(c, NEUTRAL, 1); // 放桿
    const still = c.snapshot().pitchDeg;
    expect(still).toBeGreaterThan(15); // 不回正（無自動水平）
  });

  it('姿態模式：放桿自動回正（維持姿態水平）', () => {
    const c = new ExamFlightController(PARAMS, { yawRateLimitDegPerS: 45 });
    c.setMode('attitude');
    c.arm();
    c.takeoff(2);
    airborne(c);
    stepFor(c, FORWARD, 1);
    expect(c.snapshot().pitchDeg).toBeGreaterThan(15);
    stepFor(c, NEUTRAL, 1.5); // 一階滯後 + 回正
    expect(Math.abs(c.snapshot().pitchDeg)).toBeLessThan(2);
    expect(Math.abs(c.snapshot().rollDeg)).toBeLessThan(2);
  });

  it('姿態模式：放桿後減速，但不鎖位置——有風時會飄移', () => {
    const c = new ExamFlightController(PARAMS);
    c.setMode('attitude');
    c.arm();
    c.takeoff(2);
    airborne(c);
    stepFor(c, FORWARD, 4);
    stepFor(c, NEUTRAL, 3); // 減速到靜止
    expect(c.snapshot().horizontalSpeedMps).toBeLessThan(0.5);
    c.applyWind({ x: 5, y: 0, z: 0 }); // 5 m/s 側風
    const pos0 = c.snapshot().position.x;
    stepFor(c, NEUTRAL, 2); // 位置模式未啟動，風應把機體吹走
    const pos1 = c.snapshot().position.x;
    expect(pos1).toBeGreaterThan(pos0 + 2); // 明顯飄移
  });

  it('定位模式：放桿鎖定水平位置，風在可補償上限內被抵銷', () => {
    const c = new ExamFlightController(PARAMS, { positionHoldMaxWindMps: 10 });
    c.setMode('position');
    c.arm();
    c.takeoff(2);
    airborne(c);
    stepFor(c, FORWARD, 4);
    const releasePoint = c.snapshot().position; // 鬆桿瞬間位置（鎖定點）
    c.applyWind({ x: 5, y: 0, z: 0 }); // 5 m/s < 上限 10
    stepFor(c, NEUTRAL, 4); // 回拉並鎖定，風被抵銷
    expect(c.snapshot().positionHoldCompensating).toBe(true);
    const held = c.snapshot().position;
    expect(Math.hypot(held.x - releasePoint.x, held.z - releasePoint.z)).toBeLessThan(1); // 回到鎖定點
  });

  it('定位模式：風超過可補償上限時開始飄移（模擬假設）', () => {
    const c = new ExamFlightController(PARAMS, { positionHoldMaxWindMps: 10 });
    c.setMode('position');
    c.arm();
    c.takeoff(2);
    stepFor(c, NEUTRAL, 2);
    c.applyWind({ x: 16, y: 0, z: 0 }); // 超出上限
    const p0 = c.snapshot().position.x;
    stepFor(c, NEUTRAL, 2);
    const p1 = c.snapshot().position.x;
    expect(p1).toBeGreaterThan(p0 + 2); // 超出量 (6 m/s) 造成飄移
  });

  it('自動定高：姿態／定位模式回中油門維持高度，手動模式則隨油門下沉', () => {
    const attitude = new ExamFlightController(PARAMS);
    attitude.setMode('attitude');
    attitude.arm();
    attitude.takeoff(2);
    stepFor(attitude, NEUTRAL, 2);
    const h0 = attitude.snapshot().altitudeM;
    stepFor(attitude, NEUTRAL, 2);
    expect(Math.abs(attitude.snapshot().altitudeM - h0)).toBeLessThan(0.1); // 維持

    const manual = new ExamFlightController(PARAMS);
    manual.setMode('manual');
    manual.arm();
    manual.takeoff(2);
    stepFor(manual, NEUTRAL, 2); // 手動油門回中 = 0 m/s 垂直速度，不會掉
    const mh0 = manual.snapshot().altitudeM;
    stepFor(manual, { roll: 0, pitch: 0, yaw: 0, throttle: 0 }, 2); // 油門最低 → 下降
    expect(manual.snapshot().altitudeM).toBeLessThan(mh0 - 0.5);
  });

  it('起降：takeoff 升到目標高度，land 後回 armed 並著地', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(1.5);
    stepFor(c, NEUTRAL, 3);
    expect(c.snapshot().altitudeM).toBeGreaterThan(1.4);
    c.land();
    stepFor(c, NEUTRAL, 5);
    expect(c.snapshot().state).toBe('landed');
    expect(c.snapshot().altitudeM).toBeLessThan(0.05);
  });

  it('reset 回到起降點，可再次起飛', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(2);
    stepFor(c, FORWARD, 3);
    c.reset();
    const s = c.snapshot();
    expect(s.position.x).toBeCloseTo(0, 3);
    expect(s.position.z).toBeCloseTo(0, 3);
    expect(s.state).toBe('idle');
    c.arm();
    c.takeoff(1.5);
    stepFor(c, NEUTRAL, 2);
    expect(c.snapshot().altitudeM).toBeGreaterThan(1.4);
  });
});

describe('ExamFlightController — 起飛／懸停／降落狀態鏈（教師實測回報）', () => {
  it('未解鎖時 takeoff 無效（狀態維持 idle）', () => {
    const c = new ExamFlightController(PARAMS);
    c.takeoff(1.5);
    expect(c.snapshot().state).toBe('idle');
    expect(c.snapshot().altitudeM).toBe(0);
  });

  it('起飛後高度確實上升，並在目標高度穩定', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(1.5);
    const heights: number[] = [];
    for (let i = 0; i < 150; i += 1) {
      c.update(NEUTRAL, 0.02);
      if (i % 15 === 0) heights.push(c.snapshot().altitudeM);
    }
    expect(heights[heights.length - 1]).toBeGreaterThan(1.4);
    expect(Math.max(...heights)).toBeLessThan(1.6);
  });

  it('實體搖桿油門在底部（0）時，自動起飛完成後不會被拉回地面（油門鎖定）', () => {
    const c = new ExamFlightController(PARAMS);
    const BOTTOM: ExamStickCommand = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
    c.arm();
    c.takeoff(1.5);
    stepFor(c, BOTTOM, 4);
    const s = c.snapshot();
    expect(s.state).toBe('flying');
    expect(s.altitudeM).toBeGreaterThan(1.4);
  });

  it('刻意改變油門（>12%）後交還手動垂直控制：油門 0.3 下降', () => {
    const c = new ExamFlightController(PARAMS);
    const BOTTOM: ExamStickCommand = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
    const LOWER: ExamStickCommand = { roll: 0, pitch: 0, yaw: 0, throttle: 0.3 };
    c.arm();
    c.takeoff(1.5);
    stepFor(c, BOTTOM, 3);
    const before = c.snapshot().altitudeM;
    stepFor(c, LOWER, 1);
    expect(c.snapshot().altitudeM).toBeLessThan(before - 0.2);
  });

  it('hover() 在自由飛行時煞停水平速度並維持高度；起飛程序中無效', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(1.5);
    expect(c.hover()).toBe(false); // 起飛程序中
    stepFor(c, NEUTRAL, 3);
    stepFor(c, FORWARD, 1.5);
    const moving = c.snapshot();
    expect(Math.hypot(moving.velocity.x, moving.velocity.z)).toBeGreaterThan(0.5);
    expect(c.hover()).toBe(true);
    const alt = c.snapshot().altitudeM;
    stepFor(c, NEUTRAL, 1);
    const after = c.snapshot();
    expect(Math.hypot(after.velocity.x, after.velocity.z)).toBeLessThan(0.05);
    expect(Math.abs(after.altitudeM - alt)).toBeLessThan(0.1);
  });

  it('已落地後可直接再解鎖起飛（不需 reset）', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(1.5);
    stepFor(c, NEUTRAL, 3);
    c.land();
    stepFor(c, NEUTRAL, 5);
    expect(c.snapshot().state).toBe('landed');
    c.arm();
    expect(c.snapshot().state).toBe('armed');
    c.takeoff(1.5);
    stepFor(c, NEUTRAL, 3);
    expect(c.snapshot().state).toBe('flying');
    expect(c.snapshot().altitudeM).toBeGreaterThan(1.4);
  });

  it('飛行中重複 takeoff 不會改變既有目標高度', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(1.5);
    stepFor(c, NEUTRAL, 3);
    const alt = c.snapshot().altitudeM;
    c.takeoff(3);
    stepFor(c, NEUTRAL, 2);
    expect(c.snapshot().altitudeM).toBeCloseTo(alt, 1);
  });

  it('isTakingOff / isLanding 反映程序狀態', () => {
    const c = new ExamFlightController(PARAMS);
    c.arm();
    c.takeoff(1.5);
    expect(c.isTakingOff()).toBe(true);
    expect(c.isLanding()).toBe(false);
    stepFor(c, NEUTRAL, 3);
    expect(c.isTakingOff()).toBe(false);
    c.land();
    expect(c.isLanding()).toBe(true);
    stepFor(c, NEUTRAL, 5);
    expect(c.isLanding()).toBe(false);
  });
});
