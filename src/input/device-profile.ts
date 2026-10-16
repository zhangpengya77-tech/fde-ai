import type { PilotInputType } from './PilotInputAdapter';
import type { AxisBinding, AxisBindings, AxisRangeKind } from './InputNormalizer';

/**
 * A persisted, brand-neutral device profile.
 *
 * Keyed by `Gamepad.id`, this holds the calibration the wizard captured for one
 * physical controller. RadioMaster/EdgeTX, the RadioLink AT9S simulator dongle
 * and any unknown teaching dongle all use this one shape - the flight contract
 * never learns which brand produced the numbers.
 */
export interface DeviceProfile {
  /** `Gamepad.id` - stable for the same physical controller on the same machine. */
  readonly id: string;
  /** Human readable label shown in the teaching UI. */
  readonly label: string;
  readonly type: PilotInputType;
  /** `mode2` is the default; `custom` comes from the calibration wizard. */
  readonly mode: 'mode2' | 'custom';
  readonly axes: AxisBindings;
  /** Optional gimbal axes. Absent means the gimbal stays neutral. */
  readonly gimbal?: { yaw: AxisBinding; pitch: AxisBinding } | null;
  /** Optional button index that expresses the pilot arm intent. */
  readonly armButton?: number | null;
  /**
   * True when the Gamepad API cannot interpret this device. The UI must show a
   * blocking hint rather than guessing a channel layout.
   */
  unsupported: boolean;
  unsupportedReason?: string;
}

export interface CreateProfileOptions {
  label?: string;
  type?: PilotInputType;
  unsupported?: boolean;
  reason?: string;
}

function binding(source: number, kind: AxisRangeKind, calibration: AxisBinding['calibration']): AxisBinding {
  return { source, kind, calibration };
}

function linearBipolar(): AxisBinding['calibration'] {
  return { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0 };
}

/**
 * The Mode 2 default: left stick pitch/roll, right stick yaw/throttle.
 *
 * Throttle is marked reversed because a standard-mapping gamepad reports -1 when
 * the throttle stick is pushed fully forward and +1 at the idle stop.
 *
 * This is a *starting point only*: the design requires the calibration wizard to
 * run the first time any external controller is used, so it deliberately stays
 * linear with no deadzone and no expo.
 */
export function createMode2Profile(id: string, options: CreateProfileOptions = {}): DeviceProfile {
  return {
    id,
    label: options.label ?? id,
    type: options.type ?? 'gamepad',
    mode: 'mode2',
    axes: {
      roll: binding(0, 'bipolar', linearBipolar()),
      pitch: binding(1, 'bipolar', linearBipolar()),
      yaw: binding(2, 'bipolar', linearBipolar()),
      throttle: binding(3, 'unipolar', {
        min: -1,
        center: -1,
        max: 1,
        reverse: true,
        deadzone: 0,
        expo: 0,
      }),
    },
    gimbal: null,
    armButton: null,
    unsupported: options.unsupported ?? false,
    ...(options.reason ? { unsupportedReason: options.reason } : {}),
  };
}

/** Shape written to and read back from IndexedDB / the export file. */
export interface StoredDeviceProfile {
  readonly schema: 'fde.device-profile/1';
  readonly profile: DeviceProfile;
  readonly savedAtMs: number;
}

export function toStoredDeviceProfile(profile: DeviceProfile, savedAtMs: number): StoredDeviceProfile {
  return { schema: 'fde.device-profile/1', profile, savedAtMs };
}

export function fromStoredDeviceProfile(stored: unknown): DeviceProfile | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const candidate = stored as Partial<StoredDeviceProfile>;
  if (candidate.schema !== 'fde.device-profile/1') return null;
  const profile = candidate.profile;
  if (
    typeof profile?.id !== 'string' ||
    typeof profile.label !== 'string' ||
    typeof profile.mode !== 'string' ||
    typeof profile.axes?.roll?.source !== 'number' ||
    typeof profile.axes?.pitch?.source !== 'number' ||
    typeof profile.axes?.yaw?.source !== 'number' ||
    typeof profile.axes?.throttle?.source !== 'number'
  ) {
    return null;
  }
  return profile;
}
