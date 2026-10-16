import type { FlightMode, PilotCommand } from '../flight/types';
import { InputNormalizer, type AxisBindings, type NormalizedChannels } from './InputNormalizer';
import { STALE_INPUT_MS, type RawPilotInput } from './PilotInputAdapter';
import type { DeviceProfile } from './device-profile';

export interface MapChannelsInput {
  raw: RawPilotInput;
  normalized: NormalizedChannels;
  profile: DeviceProfile;
  /** Current wall-clock time used to decide whether the sample is stale. */
  nowMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Turns a normalized pilot sample into a flight command.
 *
 * Safety rules this class owns:
 * - A disconnected controller or a sample older than 250 ms forces `hover` and
 *   releases roll/pitch/yaw to neutral, but the last known throttle is **held**,
 *   never snapped to zero.
 * - No sample has ever been received means hover with zeroed output.
 *
 * The mapper holds no controller knowledge: it only reads the device profile.
 */
export class ChannelMapper {
  private readonly normalizer = new InputNormalizer();
  private lastThrottle = 0;
  private lastCommand: PilotCommand | null = null;

  constructor(private readonly profile: DeviceProfile) {}

  /** True when this sample must not be allowed to fly the aircraft. */
  isStale(input: MapChannelsInput): boolean {
    if (!input.raw.connected) return true;
    const age = input.nowMs - input.raw.timestampMs;
    return Number.isFinite(age) && age > STALE_INPUT_MS;
  }

  map(input: MapChannelsInput): PilotCommand {
    const stale = this.isStale(input);
    // Only a live sample may move the held throttle. A dead device still emits
    // channel values (often the neutral 0), and those must never be trusted:
    // taking them would make a knock-out disconnect change the throttle.
    if (!stale) {
      this.lastThrottle = clamp(input.normalized.throttle, 0, 1);
    }

    const gimbal = this.readGimbal(input);
    const command: PilotCommand = stale
      ? {
          roll: 0,
          pitch: 0,
          yaw: 0,
          // Hold the last known throttle so the aircraft does not drop out of
          // the sky because a USB cable was knocked loose.
          throttle: this.lastCommand?.throttle ?? this.lastThrottle,
          arm: this.readArm(input),
          flightMode: 'hover' as FlightMode,
          gimbalYaw: 0,
          gimbalPitch: 0,
        }
      : {
          roll: clamp(input.normalized.roll, -1, 1),
          pitch: clamp(input.normalized.pitch, -1, 1),
          yaw: clamp(input.normalized.yaw, -1, 1),
          throttle: this.lastThrottle,
          arm: this.readArm(input),
          flightMode: 'manual',
          gimbalYaw: gimbal.yaw,
          gimbalPitch: gimbal.pitch,
        };

    this.lastCommand = command;
    return command;
  }

  /** Convenience wrapper for callers that already hold a `RawPilotInput`. */
  mapRaw(input: { raw: RawPilotInput; profile: DeviceProfile; nowMs: number }): PilotCommand {
    return this.map({
      raw: input.raw,
      normalized: this.normalizer.normalizeChannels(input.raw, this.axes),
      profile: input.profile,
      nowMs: input.nowMs,
    });
  }

  private get axes(): AxisBindings {
    return this.profile.axes;
  }

  private readGimbal(input: MapChannelsInput): { yaw: number; pitch: number } {
    const gimbal = this.profile.gimbal;
    if (!gimbal) return { yaw: 0, pitch: 0 };
    const safe = (axis: { source: number; kind: 'bipolar' | 'unipolar'; calibration: Parameters<InputNormalizer['normalizeAxis']>[1] }, fallback: number): number => {
      const value = input.raw.channels[axis.source];
      return Number.isFinite(value)
        ? clamp(this.normalizer.normalizeAxis(value, axis.calibration, axis.kind), -1, 1)
        : fallback;
    };
    return { yaw: safe(gimbal.yaw, 0), pitch: safe(gimbal.pitch, 0) };
  }

  private readArm(input: MapChannelsInput): boolean {
    const button = this.profile.armButton;
    if (typeof button !== 'number' || button < 0) return false;
    const value = input.raw.buttons[button];
    return Number.isFinite(value) ? value > 0.5 : false;
  }
}
