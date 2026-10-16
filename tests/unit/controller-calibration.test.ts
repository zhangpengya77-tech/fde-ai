import { describe, expect, it } from 'vitest';

import type { PilotInputType } from '../../src/input/PilotInputAdapter';
import type { AxisBindings, AxisCalibration } from '../../src/input/InputNormalizer';
import {
  captureToCalibration,
  createAxisCapture,
  draftToDeviceProfile,
  feedAxisCapture,
  resetAxisCapture,
  type AxisCaptureField,
  type CalibrationDraft,
} from '../../src/ui/controller-calibration';

function calibration(overrides: Partial<AxisCalibration> = {}): AxisCalibration {
  return { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0, ...overrides };
}

describe('axis capture state machine', () => {
  it('starts from the seed calibration but marks nothing seen', () => {
    const state = createAxisCapture({ min: -0.8, center: 0.05, max: 0.9 });
    expect(state).toMatchObject({ min: -0.8, center: 0.05, max: 0.9, minSeen: false, centerSeen: false, maxSeen: false });
  });

  it('sets the minimum on first feed and folds later samples', () => {
    let state = createAxisCapture();
    state = feedAxisCapture(state, 'min', 0.4);
    expect(state.min).toBe(0.4);
    state = feedAxisCapture(state, 'min', -0.9);
    expect(state.min).toBe(-0.9);
    state = feedAxisCapture(state, 'min', 0.2);
    expect(state.min).toBe(-0.9);
    expect(state.minSeen).toBe(true);
  });

  it('folds the maximum, taking the largest seen value', () => {
    let state = createAxisCapture();
    state = feedAxisCapture(state, 'max', -0.3);
    state = feedAxisCapture(state, 'max', 0.95);
    expect(state.max).toBe(0.95);
  });

  it('treats center as the most recent sample', () => {
    let state = createAxisCapture();
    state = feedAxisCapture(state, 'center', 0.1);
    state = feedAxisCapture(state, 'center', -0.05);
    expect(state.center).toBe(-0.05);
  });

  it('ignores non-finite samples without changing seen flags', () => {
    let state = createAxisCapture();
    state = feedAxisCapture(state, 'min', NaN);
    expect(state.minSeen).toBe(false);
    state = feedAxisCapture(state, 'min', Infinity);
    expect(state.minSeen).toBe(false);
  });

  it('resets a single field and keeps the others', () => {
    let state = createAxisCapture({ min: -0.9, max: 0.9 });
    state = feedAxisCapture(state, 'min', -0.9);
    state = feedAxisCapture(state, 'max', 0.9);
    const reset: AxisCaptureField = 'min';
    state = resetAxisCapture(state, reset);
    expect(state.minSeen).toBe(false);
    expect(state.maxSeen).toBe(true);
    expect(state.max).toBe(0.9);
  });
});

describe('captureToCalibration', () => {
  it('keeps the seed value when a field was never captured', () => {
    const base = calibration({ min: -0.8, center: 0, max: 0.8 });
    const state = createAxisCapture({ min: -0.8, center: 0, max: 0.8 });
    expect(captureToCalibration(state, base)).toEqual(base);
  });

  it('swaps an inverted capture so min never exceeds max', () => {
    const base = calibration();
    let state = createAxisCapture({ min: -1, center: 0, max: 1 });
    state = feedAxisCapture(state, 'min', 0.7);
    state = feedAxisCapture(state, 'max', -0.7);
    const result = captureToCalibration(state, base);
    expect(result.min).toBeLessThanOrEqual(result.max);
    expect(result.min).toBe(-0.7);
    expect(result.max).toBe(0.7);
  });

  it('clamps a captured center into the measured [min, max] span', () => {
    const base = calibration();
    let state = createAxisCapture({ min: -1, center: 0, max: 1 });
    state = feedAxisCapture(state, 'min', -0.9);
    state = feedAxisCapture(state, 'max', 0.9);
    state = feedAxisCapture(state, 'center', 1.5);
    const result = captureToCalibration(state, base);
    expect(result.center).toBeLessThanOrEqual(result.max);
    expect(result.center).toBe(0.9);
  });
});

describe('draftToDeviceProfile', () => {
  it('produces a custom, supported device profile from a calibration draft', () => {
    const bindings: AxisBindings = {
      roll: { source: 0, kind: 'bipolar', calibration: calibration() },
      pitch: { source: 1, kind: 'bipolar', calibration: calibration() },
      yaw: { source: 2, kind: 'bipolar', calibration: calibration() },
      throttle: { source: 3, kind: 'unipolar', calibration: calibration({ reverse: true }) },
    };
    const draft: CalibrationDraft = {
      id: 'RadioMaster EdgeTX (Vendor: 0483)',
      label: 'RadioMaster 模拟器',
      axes: bindings,
      gimbal: null,
      armButton: null,
    };
    const profile = draftToDeviceProfile(draft, 'gamepad' as PilotInputType);
    expect(profile.mode).toBe('custom');
    expect(profile.unsupported).toBe(false);
    expect(profile.axes).toBe(bindings);
    expect(profile.id).toBe('RadioMaster EdgeTX (Vendor: 0483)');
  });
});

// Local test doubles (the panel only needs the PilotInputAdapter + ProfileStore contracts).

