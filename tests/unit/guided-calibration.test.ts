import { describe, expect, it } from 'vitest';

import {
  describeDetection,
  detectMovedAxis,
  extremeToCalibration,
  GUIDED_MIN_PEAK,
  GUIDED_MOVE_THRESHOLD,
  GUIDED_STEPS,
  GuidedCalibrationState,
  type GuidedStepResult,
} from '../../src/ui/guided-calibration';

/** 2026-10-20 live probe 的 RadioMaster Pocket 靜止值（8 軸）。 */
const REST = [0.015, 0, -1, -0.006, 0, 0, 0, 0];

function withAxis(index: number, value: number, base: readonly number[] = REST): number[] {
  const sample = [...base];
  sample[index] = value;
  return sample;
}

describe('detectMovedAxis', () => {
  it('stays neutral when no axis moves past the threshold', () => {
    const sample = withAxis(1, REST[1] + 0.1, REST);
    expect(detectMovedAxis(REST, sample)).toBeNull();
  });

  it('picks the axis with the largest deviation and records its extreme', () => {
    // 右搖桿上推：axis1 跑到 -0.98，其餘只有雜訊。
    const found = detectMovedAxis(REST, withAxis(1, -0.98, REST));
    expect(found).not.toBeNull();
    expect(found?.axis).toBe(1);
    expect(found?.extreme).toBeCloseTo(-0.98, 6);
    expect(found?.deviation).toBeGreaterThanOrEqual(GUIDED_MOVE_THRESHOLD);
  });

  it('ignores axes outside the shorter sample (device with fewer axes)', () => {
    const baseline = [0, 0];
    const found = detectMovedAxis(baseline, [0, 0.8]);
    expect(found?.axis).toBe(1);
  });

  it('ignores non-finite samples instead of throwing', () => {
    const found = detectMovedAxis([0, 0], [NaN, Infinity]);
    expect(found).toBeNull();
  });

  it('uses the larger deviation when two axes wobble', () => {
    const sample = [0.015, -0.4, -1, 0.9, 0, 0, 0, 0];
    expect(detectMovedAxis(REST, sample)?.axis).toBe(3);
  });
});

describe('extremeToCalibration', () => {
  it('reverses a bipolar axis whose requested extreme reads below center', () => {
    // 右搖桿上推回報 -1 → 反向，歸一化 +1。
    const cal = extremeToCalibration('bipolar', 0, -0.98);
    expect(cal.reverse).toBe(true);
    expect(cal.center).toBe(0);
    expect(cal.min).toBeCloseTo(-0.98, 6);
    expect(cal.max).toBeCloseTo(0.98, 6);
  });

  it('keeps a bipolar axis forward when the extreme reads above center', () => {
    const cal = extremeToCalibration('bipolar', -0.006, 0.98);
    expect(cal.reverse).toBe(false);
    // 對稱端 = 2*center - extreme = -0.992。
    expect(cal.min).toBeCloseTo(-0.992, 6);
    expect(cal.max).toBeCloseTo(0.98, 6);
    expect(cal.center).toBeCloseTo(-0.006, 6);
  });

  it('treats baseline and extreme as the two ends for a unipolar throttle', () => {
    const cal = extremeToCalibration('unipolar', -1, 1);
    expect(cal.min).toBe(-1);
    expect(cal.max).toBe(1);
    expect(cal.reverse).toBe(false);
  });

  it('reverses a unipolar throttle whose top reads below the rest position', () => {
    const cal = extremeToCalibration('unipolar', 1, -1);
    expect(cal.reverse).toBe(true);
    expect(cal.min).toBe(-1);
    expect(cal.max).toBe(1);
  });
});

describe('GuidedCalibrationState', () => {
  function runStep(state: GuidedCalibrationState, axisIndex: number, extreme: number): GuidedStepResult | null {
    state.arm(REST);
    const detection = state.feed(withAxis(axisIndex, extreme, REST));
    if (!detection) return null;
    return state.confirm();
  }

  it('records the measured axis and direction for each of the four steps', () => {
    const state = new GuidedCalibrationState();
    const pitch = runStep(state, 1, -0.98);
    expect(pitch?.fn).toBe('pitch');
    expect(pitch?.axis).toBe(1);
    expect(pitch?.calibration.reverse).toBe(true);

    const roll = runStep(state, 0, 0.984);
    expect(roll?.fn).toBe('roll');
    expect(roll?.axis).toBe(0);
    expect(roll?.calibration.reverse).toBe(false);

    const yaw = runStep(state, 3, 0.98);
    expect(yaw?.fn).toBe('yaw');
    expect(yaw?.axis).toBe(3);

    const throttle = runStep(state, 2, 1);
    expect(throttle?.fn).toBe('throttle');
    expect(throttle?.axis).toBe(2);
    expect(throttle?.kind).toBe('unipolar');
    expect(throttle?.calibration.reverse).toBe(false);

    expect(state.currentPhase).toBe('done');
    expect(state.isComplete()).toBe(true);
  });

  it('does not lock a step until the peak reaches GUIDED_MIN_PEAK, exposing the soft peak', () => {
    const state = new GuidedCalibrationState();
    state.arm(REST);
    // 只推到 0.5（>= 0.3 偵測到，但 < 0.7 鎖定門檻）→ 不鎖定，仍在 arming。
    expect(state.feed(withAxis(1, -0.5, REST))).toBeNull();
    expect(state.currentPhase).toBe('arming');
    expect(state.currentSoftPeak?.axis).toBe(1);
    expect(state.currentSoftPeak!.deviation).toBeGreaterThanOrEqual(GUIDED_MOVE_THRESHOLD);
    expect(state.currentSoftPeak!.deviation).toBeLessThan(GUIDED_MIN_PEAK);
    expect(state.confirm()).toBeNull();
    // 推到底（>= 0.7）才鎖定。
    expect(state.feed(withAxis(1, -0.98, REST))).not.toBeNull();
    expect(state.currentPhase).toBe('detected');
    expect(state.currentDetection?.axis).toBe(1);
  });

  it('errors when two steps use the same axis, and the step can be retried', () => {
    const state = new GuidedCalibrationState();
    runStep(state, 1, -0.98); // pitch <- axis1

    state.arm(REST);
    const detection = state.feed(withAxis(1, -0.9, REST)); // roll 又推同一根
    expect(detection).toBeNull();
    expect(state.currentPhase).toBe('error');
    expect(state.error).toMatch(/axis1/);
    expect(state.error).toMatch(/俯仰/);
    // confirm must not record anything while in error
    expect(state.confirm()).toBeNull();

    state.retry();
    expect(state.currentPhase).toBe('idle');
    const roll = runStep(state, 0, 0.98);
    expect(roll?.axis).toBe(0);
    expect(state.currentPhase).toBe('idle'); // 還有 yaw/throttle 兩步
    expect(state.stepResults().map((r) => r.fn)).toEqual(['pitch', 'roll']);
  });

  it('refuses to build a profile before all four functions are measured', () => {
    const state = new GuidedCalibrationState();
    expect(state.buildProfile('pad', { gimbal: null, armButton: null }, 'x')).toBeNull();
    runStep(state, 1, -0.98);
    expect(state.buildProfile('pad', { gimbal: null, armButton: null }, 'x')).toBeNull();
  });

  it('builds a profile whose normalized command is +1 at each requested extreme', () => {
    const state = new GuidedCalibrationState();
    runStep(state, 1, -0.98); // pitch
    runStep(state, 0, 0.984); // roll
    runStep(state, 3, 0.98); // yaw
    runStep(state, 2, 1); // throttle
    const extras = { gimbal: { yaw: { source: 4, kind: 'bipolar' as const, calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0 } }, pitch: { source: 5, kind: 'bipolar' as const, calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0 } } }, armButton: 7 };
    const profile = state.buildProfile('Radiomaster Pocket Joystick', extras, '引導標定');
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe('Radiomaster Pocket Joystick');
    expect(profile?.mode).toBe('custom');
    // 保留原有 gimbal / armButton，重標定不丟欄位。
    expect(profile?.gimbal?.yaw.source).toBe(4);
    expect(profile?.armButton).toBe(7);

    const axes = profile!.axes;
    expect(axes.pitch.source).toBe(1);
    expect(axes.roll.source).toBe(0);
    expect(axes.yaw.source).toBe(3);
    expect(axes.throttle.source).toBe(2);
  });

  it('resets back to step 1 with no results', () => {
    const state = new GuidedCalibrationState();
    runStep(state, 1, -0.98);
    state.reset();
    expect(state.currentPhase).toBe('idle');
    expect(state.stepNumber).toBe(1);
    expect(state.stepResults()).toEqual([]);
    expect(state.isComplete()).toBe(false);
  });

  it('does not lock a detection while idle (only when armed)', () => {
    const state = new GuidedCalibrationState();
    expect(state.currentPhase).toBe('idle');
    expect(state.feed(withAxis(1, -0.98, REST))).toBeNull();
  });

  it('exposes one step definition per function in 美國手 order', () => {
    expect(GUIDED_STEPS.map((s) => s.fn)).toEqual(['pitch', 'roll', 'yaw', 'throttle']);
  });
});

describe('describeDetection', () => {
  it('renders the measured axis, reverse flag and the expected effect', () => {
    const step = GUIDED_STEPS[0]; // pitch
    const result: GuidedStepResult = {
      fn: 'pitch',
      axis: 1,
      baseline: 0,
      extreme: -0.98,
      kind: 'bipolar',
      calibration: extremeToCalibration('bipolar', 0, -0.98),
    };
    const text = describeDetection(step, result);
    expect(text).toMatch(/俯仰 Pitch ← axis1/);
    expect(text).toMatch(/reverse=true/);
    expect(text).toMatch(/前進/);
    expect(text).toMatch(/min -0.98/);
  });
});
