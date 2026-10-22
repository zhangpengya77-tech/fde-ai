import { describe, expect, it } from 'vitest';
import { InputNormalizer } from '../../src/input/InputNormalizer';
import { ChannelMapper } from '../../src/input/ChannelMapper';
import { fromStoredDeviceProfile, type DeviceProfile } from '../../src/input/device-profile';
import { SimpleFlightController } from '../../src/flight/adapters/SimpleFlightController';
import bundledProfileDoc from '../../public/rc-profile-latest.json';
import type { PilotCommand } from '../../src/flight/types';

/**
 * Direction contract for the FDE Mode-2 training build.
 *
 * These tests pin the per-axis motion semantics the teacher reported broken
 * ("俯仰方向相反，橫滾也不正確") and prove that flipping the per-axis `reverse`
 * flag in the calibration profile inverts the motion — i.e. the 軸向反轉 switch
 * in the calibration panel is what corrects a reversed stick.
 *
 * Convention (matches SimpleFlightController.updateManual):
 *   pitch = +1  -> 機頭前進 (forward, -Z at heading 0)
 *   roll  = +1  -> 機體右移   (right,   +X at heading 0)
 *   yaw   = +1  -> 航向角增加 (heading increases)
 */

function bipolar(reverse: boolean) {
  return { min: -1, center: 0, max: 1, reverse, deadzone: 0, expo: 0 };
}

function unipolar() {
  return { min: -1, center: -1, max: 1, reverse: false, deadzone: 0, expo: 0 };
}

function buildProfile(pitchReverse: boolean, rollReverse: boolean): DeviceProfile {
  return {
    id: 'test-radio',
    label: 'test-radio',
    type: 'gamepad',
    mode: 'custom',
    axes: {
      roll: { source: 0, kind: 'bipolar', calibration: bipolar(rollReverse) },
      pitch: { source: 1, kind: 'bipolar', calibration: bipolar(pitchReverse) },
      yaw: { source: 3, kind: 'bipolar', calibration: bipolar(false) },
      throttle: { source: 2, kind: 'unipolar', calibration: unipolar() },
    },
    gimbal: null,
    armButton: null,
    unsupported: false,
  };
}

const MANUAL_PITCH: PilotCommand = {
  roll: 0, pitch: 1, yaw: 0, throttle: 0.5, arm: true, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
};
const MANUAL_ROLL: PilotCommand = {
  roll: 1, pitch: 0, yaw: 0, throttle: 0.5, arm: true, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
};
const MANUAL_YAW: PilotCommand = {
  roll: 0, pitch: 0, yaw: 1, throttle: 0.5, arm: true, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
};

function armAndTakeoff(fc: SimpleFlightController): void {
  fc.arm();
  fc.takeoff(5);
  // Fly enough frames to leave the taking-off phase and reach a stable hover.
  for (let i = 0; i < 80; i += 1) fc.update(MANUAL_PITCH, 0.05);
}

describe('SimpleFlightController direction contract', () => {
  it('pitch = +1 moves the aircraft forward (-Z at heading 0)', () => {
    const fc = new SimpleFlightController();
    armAndTakeoff(fc);
    for (let i = 0; i < 40; i += 1) fc.update(MANUAL_PITCH, 0.05);
    expect(fc.snapshot().position.z).toBeLessThan(0);
  });

  it('roll = +1 moves the aircraft right (+X at heading 0)', () => {
    const fc = new SimpleFlightController();
    armAndTakeoff(fc);
    for (let i = 0; i < 40; i += 1) fc.update(MANUAL_ROLL, 0.05);
    expect(fc.snapshot().position.x).toBeGreaterThan(0);
  });

  it('yaw = +1 increases the heading', () => {
    const fc = new SimpleFlightController();
    armAndTakeoff(fc);
    const before = fc.snapshot().headingDeg;
    for (let i = 0; i < 40; i += 1) fc.update(MANUAL_YAW, 0.05);
    expect(fc.snapshot().headingDeg).toBeGreaterThan(before);
  });
});

describe('InputNormalizer reverse flag', () => {
  const normalizer = new InputNormalizer();

  it('bipolar raw at +max -> +1 when reverse=false', () => {
    expect(normalizer.normalizeAxis(1, bipolar(false), 'bipolar')).toBeCloseTo(1, 5);
  });

  it('bipolar raw at +max -> -1 when reverse=true (軸向反轉)', () => {
    expect(normalizer.normalizeAxis(1, bipolar(true), 'bipolar')).toBeCloseTo(-1, 5);
  });
});

/**
 * End-to-end proof for task #1.4: report each axis' measured motion before
 * (buggy reverse=false) and after (corrected reverse=true) the fix.
 *
 * This block is a *mechanism* proof only: it feeds an arbitrary raw extreme
 * (-1) and shows that `reverse` inverts the resulting command. It deliberately
 * does NOT claim what the hardware reads — the hardware sign is pinned by the
 * bundled-profile block below. (2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1
 * 已不適用：早期「上推 = -1」的記錄是誤記，pitch 的 reverse 已隨之改為 false。)
 */
describe('end-to-end: 軸向反轉開關 corrects a reversed stick (before/after)', () => {
  function fly(axis: 'roll' | 'pitch', reverse: boolean) {
    const profile = buildProfile(axis === 'pitch' ? reverse : false, axis === 'roll' ? reverse : false);
    const mapper = new ChannelMapper(profile);
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    // Stick held at its lower extreme (-1) = "forward" for pitch, "right" for roll.
    const channels = axis === 'pitch' ? [0, -1, 0, 0] : [-1, 0, 0, 0];
    for (let i = 0; i < 120; i += 1) {
      const nowMs = 1000 + i * 50;
      const sample = { connected: true, timestampMs: nowMs, channels, buttons: [] };
      fc.update(mapper.mapRaw({ raw: sample, profile, nowMs }), 0.05);
    }
    return fc.snapshot().position;
  }

  it('pitch: fixed (reverse=true) moves forward (-Z), buggy (reverse=false) moves backward (+Z)', () => {
    const fixed = fly('pitch', true).z; // corrected config -> forward
    const buggy = fly('pitch', false).z; // original bug -> backward
    console.log(`[pitch] BEFORE(buggy reverse=false) z=${buggy.toFixed(3)} (backward +Z) | AFTER(fixed reverse=true) z=${fixed.toFixed(3)} (forward -Z)`);
    expect(fixed).toBeLessThan(0);
    expect(buggy).toBeGreaterThan(0);
  });

  it('roll: fixed (reverse=true) moves right (+X), buggy (reverse=false) moves left (-X)', () => {
    const fixed = fly('roll', true).x; // corrected config -> right
    const buggy = fly('roll', false).x; // original bug -> left
    console.log(`[roll]  BEFORE(buggy reverse=false) x=${buggy.toFixed(3)} (left -X)     | AFTER(fixed reverse=true) x=${fixed.toFixed(3)} (right +X)`);
    expect(fixed).toBeGreaterThan(0);
    expect(buggy).toBeLessThan(0);
  });
});

/**
 * Mode-2 mapping (2026-10-22 pitch 方向修正) — regression pin for this
 * RadioMaster Pocket's probed axis order:
 *   axis0 = 右搖桿左右 X（右推 = +1）→ roll
 *   axis1 = 右搖桿上下 Y（上推 = +1）→ pitch
 *   axis2 = 左搖桿上下（油門，底部休止 -1，unipolar）
 *   axis3 = 左搖桿左右（偏航）
 *
 * History this test guards against repeating: the 2026-10-20 08:20 "axis-swap"
 * build wrongly exchanged the roll/pitch sources (roll<-axis1, pitch<-axis0)
 * after misreading a teacher report — the reported cross-coupling actually came
 * from a stale default-draft profile, not from the axis order. That swap made
 * the pitch stick fly ROLL and the roll stick fly PITCH, the exact symptom
 * re-reported on 2026-10-21. The restored (probe-verified) mapping reads:
 *   roll  <- axis0 reverse=false (右推 = +1 -> 右移 +X / 右側下沉)
 *   pitch <- axis1 reverse=false (上推 = +1 -> 前進 -Z / 機頭下壓)
 *   yaw   <- axis3 reverse=false
 *   throttle <- axis2 (unipolar, bottom-idle)
 *
 * 2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1 已不適用：軸向探針
 * (fde-stick-axis-probe-2026-10-22T00-08-20-141Z.json) 記錄右桿上推原始值
 * +0.984（峰值有效），而當時 pitch←axis1 reverse=true 會把推滿歸一化成 -1
 * （前推變後退），因此 reverse 改為 false。roll←axis0 已由另一次實測驗證
 * （右打為正、峰值 1.000），兩個 source 都不再動。
 *
 * `finalProfile()` loads the bundled static file so this test always asserts
 * against the exact bytes the offline deployment will import.
 */
describe('Mode-2 mapping (probe-verified): 上推=前進、右推=右移', () => {
  function finalProfile(): DeviceProfile {
    const profile = fromStoredDeviceProfile(bundledProfileDoc as unknown);
    if (!profile) throw new Error('bundled static fallback profile is invalid');
    return profile;
  }

  /** Fly with the right stick held at the given raw extremes for both axes. */
  function flyRightStick(rawX: number, rawY: number): { x: number; z: number } {
    const profile = finalProfile();
    const mapper = new ChannelMapper(profile);
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    const channels = [rawX, rawY, -1, 0]; // throttle parked at bottom-idle
    for (let i = 0; i < 120; i += 1) {
      const nowMs = 1000 + i * 50;
      const sample = { connected: true, timestampMs: nowMs, channels, buttons: [] };
      fc.update(mapper.mapRaw({ raw: sample, profile, nowMs }), 0.05);
    }
    const pos = fc.snapshot().position;
    return { x: pos.x, z: pos.z };
  }

  it('上推 (axis1 = +max) -> pitch +1 -> 前進/機頭下壓 (-Z)', () => {
    const pos = flyRightStick(0, 0.984);
    console.log(`[pitch-fix] 上推 raw=[0,+0.984] -> z=${pos.z.toFixed(3)} (forward -Z expected)`);
    expect(pos.z).toBeLessThan(0);
  });

  it('下拉 (axis1 = -max) -> pitch -1 -> 後退/機頭上仰 (+Z)', () => {
    const pos = flyRightStick(0, -0.984);
    console.log(`[pitch-fix] 下拉 raw=[0,-0.984] -> z=${pos.z.toFixed(3)} (backward +Z expected)`);
    expect(pos.z).toBeGreaterThan(0);
  });

  it('右推 (axis0 = +max) -> roll +1 -> 右移/右側下沉 (+X)', () => {
    const pos = flyRightStick(0.984, 0);
    console.log(`[restore] 右推 raw=[+0.984,0] -> x=${pos.x.toFixed(3)} (right +X expected)`);
    expect(pos.x).toBeGreaterThan(0);
  });

  it('左推 (axis0 = -max) -> roll -1 -> 左移/左側下沉 (-X)', () => {
    const pos = flyRightStick(-0.984, 0);
    console.log(`[restore] 左推 raw=[-0.984,0] -> x=${pos.x.toFixed(3)} (left -X expected)`);
    expect(pos.x).toBeLessThan(0);
  });
});
