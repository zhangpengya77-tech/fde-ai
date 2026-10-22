import { describe, expect, it } from 'vitest';

import { ChannelMapper } from '../../src/input/ChannelMapper';
import {
  createMode2Profile,
  fromStoredDeviceProfile,
  type DeviceProfile,
} from '../../src/input/device-profile';
import { InputNormalizer, type AxisCalibration, type NormalizedChannels } from '../../src/input/InputNormalizer';
import type { RawPilotInput } from '../../src/input/PilotInputAdapter';

const normalizer = new InputNormalizer();

function calibration(overrides: Partial<AxisCalibration> = {}): AxisCalibration {
  return { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0, ...overrides };
}

const DEFAULT_AXIS_COUNT = 6;
const DEFAULT_BUTTON_COUNT = 16;

/**
 * A standard-mapping gamepad: axes 0-2 are centreing, axis 3 is the throttle
 * stick which reads -1 when pushed fully forward (full throttle) and +1 at the
 * idle stop, so the Mode 2 profile marks that axis reversed.
 */
function raw(channels: number[], overrides: Partial<RawPilotInput> = {}, pressedButtons: number[] = []): RawPilotInput {
  const buttons = new Array(DEFAULT_BUTTON_COUNT).fill(0);
  for (const index of pressedButtons) buttons[index] = 1;
  return {
    timestampMs: 5_000,
    channels: new Array(DEFAULT_AXIS_COUNT).fill(0).map((_, index) => channels[index] ?? 0),
    buttons,
    connected: true,
    ...overrides,
  };
}

/** Mirrors how the app feeds a sample into the mapper: normalize once, then map. */
function map(mapper: ChannelMapper, profile: DeviceProfile, sample: RawPilotInput, nowMs: number) {
  const normalized: NormalizedChannels = normalizer.normalizeChannels(sample, profile.axes);
  return mapper.map({ raw: sample, normalized, profile, nowMs });
}

/**
 * 標準對應遊戲手把形狀的顯式 profile（軸 0-3：Roll/Pitch/Yaw/Throttle，
 * 油門單向且反向）。ChannelMapper 的行為測試用它，不依賴預設草稿的軸序。
 */
function explicitProfile(id = 'pad'): DeviceProfile {
  const base = createMode2Profile(id);
  return {
    ...base,
    axes: {
      roll: { source: 0, kind: 'bipolar', calibration: calibration() },
      pitch: { source: 1, kind: 'bipolar', calibration: calibration() },
      yaw: { source: 2, kind: 'bipolar', calibration: calibration() },
      throttle: {
        source: 3,
        kind: 'unipolar',
        calibration: calibration({ min: -1, center: -1, max: 1, reverse: true }),
      },
    },
  };
}

describe('DeviceProfile', () => {
  it('ships the 美國手 Mode 2 default (verified stick layout)', () => {
    const profile = createMode2Profile('RadioMaster Pocket Joystick (Vendor: 1209 Product: 4f54)');

    expect(profile.id).toBe('RadioMaster Pocket Joystick (Vendor: 1209 Product: 4f54)');
    expect(profile.mode).toBe('mode2');
    // Live Gamepad-API probe 2026-10-20（非標準對應裝置）：
    // axis0=右搖桿左右、axis1=右搖桿上下、axis2=左搖桿上下（油門）、
    // axis3=左搖桿左右。舊草稿 yaw=2/throttle=3 是標準手把猜測，對本裝置全錯。
    expect(profile.axes.roll.source).toBe(0);
    expect(profile.axes.pitch.source).toBe(1);
    expect(profile.axes.yaw.source).toBe(3);
    expect(profile.axes.throttle.source).toBe(2);
    expect(profile.axes.roll.kind).toBe('bipolar');
    expect(profile.axes.throttle.kind).toBe('unipolar');
    // 方向：右推=roll+1（右移）；上推=pitch+1（前進）；右打=yaw+1（航向角增）；
    // 油門頂=+1。2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1 已不適用，
    // 因此 pitch 不再反轉（舊草稿的 reverse=true 會把前推變成後退）。
    expect(profile.axes.roll.calibration.reverse).toBe(false);
    expect(profile.axes.pitch.calibration.reverse).toBe(false);
    expect(profile.axes.yaw.calibration.reverse).toBe(false);
    expect(profile.axes.throttle.calibration.reverse).toBe(false);
  });

  it('treats every controller brand through the same Mode 2 contract without brand-specific branches', () => {
    const radioMaster = createMode2Profile('RadioMaster EdgeTX USB Joystick');
    const radioLink = createMode2Profile('RadioLink AT9S Simulator Dongle');
    const unknown = createMode2Profile('Unknown Teaching Dongle');

    for (const profile of [radioMaster, radioLink, unknown]) {
      expect(profile.axes.roll.source).toBe(radioMaster.axes.roll.source);
      expect(profile.axes.pitch.source).toBe(radioMaster.axes.pitch.source);
      expect(profile.axes.yaw.source).toBe(radioMaster.axes.yaw.source);
      expect(profile.axes.throttle.source).toBe(radioMaster.axes.throttle.source);
      expect(profile.axes.roll.kind).toBe(radioMaster.axes.roll.kind);
      expect(profile.axes.throttle.kind).toBe(radioMaster.axes.throttle.kind);
      expect(profile.unsupported).toBe(false);
    }
  });

  it('marks a device the Gamepad API could not interpret as unsupported instead of guessing', () => {
    const profile = createMode2Profile('Mystery device', { unsupported: true, reason: 'no standard mapping' });
    expect(profile.unsupported).toBe(true);
    expect(profile.unsupportedReason).toMatch(/no standard mapping/);
  });

  it('round-trips through the stored schema and rejects foreign payloads', () => {
    const profile = createMode2Profile('RadioLink AT9S');
    const stored = { schema: 'fde.device-profile/1' as const, profile, savedAtMs: 1 };

    expect(fromStoredDeviceProfile(stored)).toEqual(profile);
    expect(fromStoredDeviceProfile({ schema: 'something-else' })).toBeNull();
    expect(fromStoredDeviceProfile('nonsense')).toBeNull();
    expect(fromStoredDeviceProfile({ schema: 'fde.device-profile/1', profile: { id: 'x' } })).toBeNull();
  });
});

describe('ChannelMapper', () => {
  it('maps normalized channels straight through while the controller is connected', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const command = map(mapper, profile, raw([0.4, -0.6, 0.2, 0]), 5_000);

    expect(command.roll).toBeCloseTo(0.4, 6);
    expect(command.pitch).toBeCloseTo(-0.6, 6);
    expect(command.yaw).toBeCloseTo(0.2, 6);
    expect(command.throttle).toBeCloseTo(0.5, 6);
    expect(command.flightMode).toBe('manual');
  });

  it('keeps Roll, Pitch and Yaw inside [-1, 1] and Throttle inside [0, 1]', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const command = map(mapper, profile, raw([9, -9, 9, 9]), 5_000);

    expect(command.roll).toBe(1);
    expect(command.pitch).toBe(-1);
    expect(command.yaw).toBe(1);
    // The Mode 2 throttle axis is reversed, so a saturated raw value arrives
    // here as 0 rather than 1; the contract is the range, not the endpoint.
    expect(command.throttle).toBeGreaterThanOrEqual(0);
    expect(command.throttle).toBeLessThanOrEqual(1);
  });

  it('saturates a non-reversed throttle axis to full and idle', () => {
    const profile = explicitProfile();
    profile.axes.throttle.calibration = calibration({ reverse: false });
    const mapper = new ChannelMapper(profile);

    const full = map(mapper, profile, raw([0, 0, 0, 1]), 5_000);
    const idle = map(mapper, profile, raw([0, 0, 0, -1]), 5_001);
    expect(full.throttle).toBeCloseTo(1, 6);
    expect(idle.throttle).toBeCloseTo(0, 6);
  });

  it('applies a reversed axis exactly as the profile records it', () => {
    const profile = explicitProfile();
    profile.axes.roll.calibration = calibration({ reverse: true });

    const mapper = new ChannelMapper(profile);
    expect(map(mapper, profile, raw([0.5, 0, 0, 0]), 5_000).roll).toBeCloseTo(-0.5, 6);
  });

  it('enters hover and blocks input when the device reports itself disconnected', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const command = map(mapper, profile, raw([0.8, 0, 0, 0], { connected: false }), 5_000);

    expect(command.flightMode).toBe('hover');
    expect(command.roll).toBe(0);
    expect(command.pitch).toBe(0);
    expect(command.yaw).toBe(0);
  });

  it('holds the last known throttle instead of zeroing it on disconnect', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);

    map(mapper, profile, raw([0, 0, 0, 0]), 5_000);
    const afterDisconnect = map(mapper, profile, raw([0, 0, 0, 1], { connected: false }), 5_010);

    expect(afterDisconnect.flightMode).toBe('hover');
    expect(afterDisconnect.throttle).toBeCloseTo(0.5, 6);
  });

  it('enters hover once input goes stale past 250 ms and recovers with fresh input', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const sample = raw([0.1, 0, 0, 0], { timestampMs: 5_000 });

    map(mapper, profile, sample, 5_000);
    expect(map(mapper, profile, sample, 5_250).flightMode).toBe('manual');
    expect(map(mapper, profile, sample, 5_251).flightMode).toBe('hover');

    const recovered = map(mapper, profile, raw([0.1, 0, 0, 0], { timestampMs: 5_300 }), 5_300);
    expect(recovered.flightMode).toBe('manual');
    expect(recovered.throttle).toBeCloseTo(0.5, 6);
  });

  it('never produces random input before a real sample arrives', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const command = map(mapper, profile, raw([0, 0, 0, 0], { connected: false }), 5_001);

    expect(command).toMatchObject({
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
      flightMode: 'hover',
    });
  });

  it('keeps the gimbal neutral when no gimbal axis is bound', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const command = map(mapper, profile, raw([0, 0, 0, 0]), 5_000);
    expect(command.gimbalYaw).toBe(0);
    expect(command.gimbalPitch).toBe(0);
  });

  it('forwards gimbal axes when the profile binds them', () => {
    const base = explicitProfile();
    const profile: DeviceProfile = {
      ...base,
      gimbal: {
        yaw: { source: 4, kind: 'bipolar', calibration: calibration() },
        pitch: { source: 5, kind: 'bipolar', calibration: calibration() },
      },
    };

    const mapper = new ChannelMapper(profile);
    const command = map(mapper, profile, raw([0, 0, 0, 0, 0.3, -0.8]), 5_000);
    expect(command.gimbalYaw).toBeCloseTo(0.3, 6);
    expect(command.gimbalPitch).toBeCloseTo(-0.8, 6);
  });

  it('reports the pilot arm intent only while the mapped arm button is held', () => {
    const base = explicitProfile();
    const profile: DeviceProfile = { ...base, armButton: 0 };
    const mapper = new ChannelMapper(profile);

    expect(map(mapper, profile, raw([0, 0, 0, 0]), 5_000).arm).toBe(false);
    expect(map(mapper, profile, raw([0, 0, 0, 0], {}, [0]), 5_000).arm).toBe(true);
  });

  it('reports stale when the sample is older than 250 ms', () => {
    const profile = explicitProfile();
    const mapper = new ChannelMapper(profile);
    const sample = raw([0, 0, 0, 0], { timestampMs: 5_000 });

    expect(mapper.isStale({ raw: sample, normalized: normalizer.normalizeChannels(sample, profile.axes), profile, nowMs: 5_250 })).toBe(false);
    expect(mapper.isStale({ raw: sample, normalized: normalizer.normalizeChannels(sample, profile.axes), profile, nowMs: 5_251 })).toBe(true);
  });
});
