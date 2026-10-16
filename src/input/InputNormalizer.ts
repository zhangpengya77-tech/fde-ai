import type { RawPilotInput } from './PilotInputAdapter';

/**
 * `bipolar` self-centering sticks map onto [-1, 1].
 * `unipolar` throttle sticks map onto [0, 1] and never return a negative value.
 */
export type AxisRangeKind = 'bipolar' | 'unipolar';

/**
 * Everything the calibration wizard captures for one physical axis.
 * `center` only matters for a self-centering stick.
 */
export interface AxisCalibration {
  min: number;
  center: number;
  max: number;
  reverse: boolean;
  /** 0..0.9 of travel held as neutral. */
  deadzone: number;
  /** 0 = linear, 1 = strong softening of small deflections. */
  expo: number;
}

/** One pilot function bound to one physical channel of one device. */
export interface AxisBinding {
  source: number;
  kind: AxisRangeKind;
  calibration: AxisCalibration;
}

export interface AxisBindings {
  roll: AxisBinding;
  pitch: AxisBinding;
  yaw: AxisBinding;
  throttle: AxisBinding;
}

/** The four standard control ranges every flight stage consumes. */
export interface NormalizedChannels {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function applyDeadzone(value: number, deadzone: number): number {
  if (deadzone <= 0) return value;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * (magnitude - deadzone)) / (1 - deadzone);
}

function applyThrottleDeadzone(value: number, deadzone: number): number {
  if (deadzone <= 0) return value;
  // A throttle has a hard bottom stop, so only the bottom band is suppressed.
  // The remaining travel keeps its measured slope: it is never rescaled, which
  // would distort how far the top half of the stick travels.
  return value <= deadzone ? 0 : value;
}

function applyExpo(value: number, expo: number): number {
  if (expo <= 0) return value;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.pow(Math.abs(value), 1 + 2 * expo);
}

/**
 * Converts one raw device channel into a standard control range.
 *
 * Pure and synchronous so it can be unit tested and reused by the calibration
 * preview without any browser API.
 */
export class InputNormalizer {
  normalizeAxis(value: number, calibration: AxisCalibration, kind: AxisRangeKind = 'bipolar'): number {
    if (!Number.isFinite(value)) return 0;

    if (kind === 'unipolar') {
      const span = calibration.max - calibration.min;
      const ratio = span > 0 ? (value - calibration.min) / span : 0;
      const clamped = clamp(ratio, 0, 1);
      const oriented = calibration.reverse ? 1 - clamped : clamped;
      return clamp(
        applyExpo(applyThrottleDeadzone(oriented, clamp(calibration.deadzone, 0, 0.9)), clamp(calibration.expo, 0, 1)),
        0,
        1,
      );
    }

    const lowerSpan = calibration.center - calibration.min;
    const upperSpan = calibration.max - calibration.center;
    let ratio: number;
    if (value >= calibration.center) {
      ratio = upperSpan > 0 ? (value - calibration.center) / upperSpan : 0;
    } else {
      ratio = lowerSpan > 0 ? (value - calibration.center) / lowerSpan : 0;
    }
    const clamped = clamp(ratio, -1, 1);
    const oriented = calibration.reverse ? -clamped : clamped;
    const deadzoned = applyDeadzone(oriented, clamp(calibration.deadzone, 0, 0.9));
    return clamp(applyExpo(deadzoned, clamp(calibration.expo, 0, 1)), -1, 1);
  }

  /**
   * Applies the device profile to a whole sample and returns the standard
   * control ranges. Unknown brands travel this exact path; there is no
   * brand-specific branch anywhere in this class.
   */
  normalizeChannels(input: RawPilotInput, bindings: AxisBindings): NormalizedChannels {
    const read = (role: keyof AxisBindings, binding: AxisBinding): number => {
      // A device that reports no axes at all cannot be trusted to move the
      // aircraft, so every function is held neutral instead of guessed at.
      if (input.channels.length === 0) return 0;
      if (!Number.isInteger(binding.source) || binding.source < 0 || binding.source >= input.channels.length) {
        throw new RangeError(
          `Pilot input ${role} is bound to axis ${binding.source}, but the device only reports ${input.channels.length} axes.`,
        );
      }
      return this.normalizeAxis(input.channels[binding.source], binding.calibration, binding.kind);
    };

    return {
      roll: read('roll', bindings.roll),
      pitch: read('pitch', bindings.pitch),
      yaw: read('yaw', bindings.yaw),
      throttle: read('throttle', bindings.throttle),
    };
  }
}
