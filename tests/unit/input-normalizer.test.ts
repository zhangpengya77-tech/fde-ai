import { describe, expect, it } from 'vitest';

import {
  InputNormalizer,
  type AxisBindings,
  type AxisCalibration,
  type AxisRangeKind,
} from '../../src/input/InputNormalizer';
import type { RawPilotInput } from '../../src/input/PilotInputAdapter';

function calibration(overrides: Partial<AxisCalibration> = {}): AxisCalibration {
  return {
    min: -1,
    center: 0,
    max: 1,
    reverse: false,
    deadzone: 0,
    expo: 0,
    ...overrides,
  };
}

function normalizer(): InputNormalizer {
  return new InputNormalizer();
}

function raw(channels: number[], buttons: number[] = [], connected = true, timestampMs = 1_000): RawPilotInput {
  return { timestampMs, channels, buttons, connected };
}

function bindings(overrides: Partial<AxisBindings> = {}): AxisBindings {
  return {
    roll: { source: 0, kind: 'bipolar', calibration: calibration() },
    pitch: { source: 1, kind: 'bipolar', calibration: calibration() },
    yaw: { source: 2, kind: 'bipolar', calibration: calibration() },
    throttle: { source: 3, kind: 'unipolar', calibration: calibration({ min: -1, center: -1, max: 1 }) },
    ...overrides,
  };
}

describe('InputNormalizer', () => {
  describe('normalizeAxis for a self-centering stick', () => {
    it.each<[string, number, AxisRangeKind, Partial<AxisCalibration>, number]>([
      ['center position becomes zero', 0, 'bipolar', {}, 0],
      ['minimum becomes -1', -1, 'bipolar', {}, -1],
      ['maximum becomes 1', 1, 'bipolar', {}, 1],
      ['half deflection above center becomes 0.5', 0.5, 'bipolar', {}, 0.5],
      ['half deflection below center becomes -0.5', -0.5, 'bipolar', {}, -0.5],
      ['reverse inverts a positive deflection', 0.5, 'bipolar', { reverse: true }, -0.5],
      ['reverse inverts a negative deflection', -0.25, 'bipolar', { reverse: true }, 0.25],
    ])('%s', (_label, value, kind, overrides, expected) => {
      expect(normalizer().normalizeAxis(value, calibration(overrides), kind)).toBeCloseTo(expected, 6);
    });

    it('maps a non-symmetric measured range to the full standard range', () => {
      const measured = calibration({ min: 0.1, center: 0.55, max: 1.2 });
      expect(normalizer().normalizeAxis(0.55, measured, 'bipolar')).toBeCloseTo(0, 6);
      expect(normalizer().normalizeAxis(1.2, measured, 'bipolar')).toBeCloseTo(1, 6);
      expect(normalizer().normalizeAxis(0.1, measured, 'bipolar')).toBeCloseTo(-1, 6);
      expect(normalizer().normalizeAxis(0.55 + (1.2 - 0.55) / 2, measured, 'bipolar')).toBeCloseTo(0.5, 6);
    });

    it('clamps values measured outside the calibrated range', () => {
      const measured = calibration({ min: 0.1, center: 0.55, max: 1.2 });
      expect(normalizer().normalizeAxis(5, measured, 'bipolar')).toBeCloseTo(1, 6);
      expect(normalizer().normalizeAxis(-5, measured, 'bipolar')).toBeCloseTo(-1, 6);
    });

    it('applies a deadzone around the centre and rescales the live range', () => {
      const withDeadzone = calibration({ deadzone: 0.2 });
      expect(normalizer().normalizeAxis(0.1, withDeadzone, 'bipolar')).toBe(0);
      expect(normalizer().normalizeAxis(0.19, withDeadzone, 'bipolar')).toBe(0);
      expect(normalizer().normalizeAxis(0.2, withDeadzone, 'bipolar')).toBe(0);
      expect(normalizer().normalizeAxis(0.6, withDeadzone, 'bipolar')).toBeCloseTo(0.5, 6);
      expect(normalizer().normalizeAxis(1, withDeadzone, 'bipolar')).toBeCloseTo(1, 6);
      expect(normalizer().normalizeAxis(-0.6, withDeadzone, 'bipolar')).toBeCloseTo(-0.5, 6);
      expect(normalizer().normalizeAxis(0.1, calibration({ deadzone: 0.2, reverse: true }), 'bipolar')).toBe(0);
    });

    it('applies expo as a curve that softens small stick deflections only', () => {
      const soft = normalizer().normalizeAxis(0.5, calibration({ expo: 1 }), 'bipolar');
      const linear = normalizer().normalizeAxis(0.5, calibration({ expo: 0 }), 'bipolar');
      expect(soft).toBeLessThan(linear);
      expect(normalizer().normalizeAxis(1, calibration({ expo: 1 }), 'bipolar')).toBeCloseTo(1, 6);
      expect(normalizer().normalizeAxis(0, calibration({ expo: 1 }), 'bipolar')).toBe(0);
      expect(Math.sign(normalizer().normalizeAxis(-0.5, calibration({ expo: 1 }), 'bipolar'))).toBe(-1);
    });
  });

  describe('normalizeAxis for a throttle stick', () => {
    it('maps the throttle range onto 0..1 and never returns a negative value', () => {
      const throttle = calibration({ min: -1, center: -1, max: 1 });
      expect(normalizer().normalizeAxis(-1, throttle, 'unipolar')).toBe(0);
      expect(normalizer().normalizeAxis(0, throttle, 'unipolar')).toBeCloseTo(0.5, 6);
      expect(normalizer().normalizeAxis(1, throttle, 'unipolar')).toBe(1);
    });

    it('applies the deadzone against the bottom of the throttle travel', () => {
      const throttle = calibration({ min: -1, center: -1, max: 1, deadzone: 0.25 });
      expect(normalizer().normalizeAxis(-1, throttle, 'unipolar')).toBe(0);
      expect(normalizer().normalizeAxis(-0.9, throttle, 'unipolar')).toBe(0);
      expect(normalizer().normalizeAxis(1, throttle, 'unipolar')).toBe(1);
      expect(normalizer().normalizeAxis(0, throttle, 'unipolar')).toBeCloseTo(0.5, 6);
    });

    it('honours the reverse flag for a reversed throttle stick', () => {
      const throttle = calibration({ min: -1, center: -1, max: 1, reverse: true });
      expect(normalizer().normalizeAxis(-1, throttle, 'unipolar')).toBe(1);
      expect(normalizer().normalizeAxis(1, throttle, 'unipolar')).toBe(0);
    });
  });

  describe('normalizeChannels', () => {
    it('produces Roll, Pitch, Yaw in [-1, 1] and Throttle in [0, 1]', () => {
      const channels = normalizer().normalizeChannels(raw([0.5, -0.25, 1, 0]), bindings());
      expect(channels.roll).toBeCloseTo(0.5, 6);
      expect(channels.pitch).toBeCloseTo(-0.25, 6);
      expect(channels.yaw).toBeCloseTo(1, 6);
      expect(channels.throttle).toBeCloseTo(0.5, 6);
    });

    it('routes each function to its own physical axis index', () => {
      const remapped = bindings({
        roll: { source: 2, kind: 'bipolar', calibration: calibration() },
        pitch: { source: 3, kind: 'bipolar', calibration: calibration() },
        yaw: { source: 0, kind: 'bipolar', calibration: calibration() },
        throttle: { source: 1, kind: 'unipolar', calibration: calibration({ min: -1, center: -1, max: 1 }) },
      });
      const channels = normalizer().normalizeChannels(raw([-0.5, 0.5, 0.25, -0.75]), remapped);

      expect(channels.yaw).toBeCloseTo(-0.5, 6); // axes[0]
      expect(channels.roll).toBeCloseTo(0.25, 6); // axes[2]
      expect(channels.throttle).toBeCloseTo(0.75, 6); // axes[1] mapped onto 0..1
      expect(channels.pitch).toBeCloseTo(-0.75, 6); // axes[3]
    });

    it('keeps every channel inside its standard range for extreme raw input', () => {
      const channels = normalizer().normalizeChannels(raw([9, -9, 9, 9], []), bindings());
      expect(channels.roll).toBe(1);
      expect(channels.pitch).toBe(-1);
      expect(channels.yaw).toBe(1);
      expect(channels.throttle).toBe(1);
    });

    it('treats a missing physical axis as a centred neutral channel', () => {
      const channels = normalizer().normalizeChannels(raw([], []), bindings());
      expect(channels).toEqual({ roll: 0, pitch: 0, yaw: 0, throttle: 0 });
    });

    it('rejects an axis index that no Gamepad can provide', () => {
      const broken = bindings({ roll: { source: 7, kind: 'bipolar', calibration: calibration() } });
      expect(() => normalizer().normalizeChannels(raw([0, 0, 0, 0], []), broken)).toThrow(/axis 7/);
    });
  });
});
