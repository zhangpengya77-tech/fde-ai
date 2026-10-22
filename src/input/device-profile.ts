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
 * The Mode 2 (美國手) default, matched to the 2026-10-22 real-hardware probe of
 * the RadioMaster Pocket (fde-stick-axis-probe-2026-10-22T00-08-20-141Z.json):
 *
 *   axis0 = 右搖桿左右（右推 = +1）  -> roll  (reverse=false: 右打 = roll +1 = 右移)
 *   axis1 = 右搖桿上下（上推 = +1）  -> pitch (reverse=false: 上推 = pitch +1 = 前進)
 *   axis2 = 左搖桿上下（底部休止 -1） -> throttle, unipolar (reverse=false: 頂 = 1)
 *   axis3 = 左搖桿左右（右推 = +1）  -> yaw   (reverse=false: 右打 = 航向角增)
 *
 * 2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1 已不適用：早期 live probe 與
 * 2026-10-21 pitchroll-restore 檔把「上推」記成 -1，draft 的 pitch 因此一直帶
 * reverse=true。軸向探針實測（右桿上推峰值 +0.984）證明原始值為正，reverse=true
 * 會把前推變成後退，故改為 false。roll←axis0 已另行實測驗證（右打為正、峰值
 * 1.000），兩個 source 都不再動。
 *
 * This replaces the earlier standard-gamepad guess (yaw=axis2/throttle=axis3
 * with a reversed throttle), which was wrong for this device: the teacher got
 * stuck with a scrambled left stick before a profile existed. It is still a
 * *starting point only* - the calibration wizard runs the first time any
 * external controller is used - but the starting point now matches the verified
 * stick layout instead of guessing.
 */
export function createMode2Profile(id: string, options: CreateProfileOptions = {}): DeviceProfile {
  return {
    id,
    label: options.label ?? id,
    type: options.type ?? 'gamepad',
    mode: 'mode2',
    axes: {
      roll: binding(0, 'bipolar', linearBipolar()),
      // 2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1 已不適用：pitch 不反轉。
      pitch: binding(1, 'bipolar', linearBipolar()),
      yaw: binding(3, 'bipolar', linearBipolar()),
      // 單向油門：底部休止 = -1 對應 0，推到頂 = +1 對應 1。
      throttle: binding(2, 'unipolar', {
        min: -1,
        center: -1,
        max: 1,
        reverse: false,
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
  /**
   * Optional provenance so a reload can still say where this profile came
   * from (manual save / guided calibration / auto-imported capture file).
   * Older documents simply omit it.
   */
  readonly origin?: { kind: string; file?: string };
}

export function toStoredDeviceProfile(
  profile: DeviceProfile,
  savedAtMs: number,
  origin?: { kind: string; file?: string },
): StoredDeviceProfile {
  return {
    schema: 'fde.device-profile/1',
    profile,
    savedAtMs,
    ...(origin ? { origin } : {}),
  };
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
