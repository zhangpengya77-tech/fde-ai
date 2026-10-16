import { describe, expect, it } from 'vitest';

import { createMode2Profile } from '../../src/input/device-profile';
import type { PilotInputAdapter, PilotInputType, RawPilotInput } from '../../src/input/PilotInputAdapter';
import type { DeviceProfile } from '../../src/input/device-profile';
import type { PilotCommand } from '../../src/flight/types';
import { PilotInputPipeline, type PilotInputSource } from '../../src/input/PilotInputPipeline';

const KEYBOARD_COMMAND: PilotCommand = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0.5,
  arm: true,
  flightMode: 'hover',
  gimbalYaw: 0,
  gimbalPitch: 0,
};

class FakeAdapter implements PilotInputAdapter {
  readonly type: PilotInputType = 'gamepad';
  lastError: string | null = null;
  isConnected = false;
  private raw: RawPilotInput = { timestampMs: 0, channels: [], buttons: [], connected: false };
  /** When set, poll() keeps this timestamp instead of the poll time - used to simulate a silent device. */
  private frozenTimestamp: number | null = null;

  constructor(readonly id: string) {}

  async connect(): Promise<void> {
    this.isConnected = this.raw.connected;
  }

  disconnect(): void {
    this.isConnected = false;
  }

  /** Installs the next sample the adapter will report. */
  emit(sample: Partial<RawPilotInput>, options: { frozenTimestamp?: number | null } = {}): void {
    this.raw = { timestampMs: 0, channels: [], buttons: [], connected: true, ...sample };
    this.isConnected = this.raw.connected;
    this.frozenTimestamp = options.frozenTimestamp ?? null;
  }

  poll(timestampMs: number): RawPilotInput {
    const timestamp = this.frozenTimestamp !== null ? this.frozenTimestamp : timestampMs;
    return { ...this.raw, timestampMs: timestamp };
  }
}

function neutralChannels(count = 6): number[] {
  return new Array(count).fill(0);
}

describe('PilotInputPipeline source priority', () => {
  it('prefers the radio controller when connected and fresh', () => {
    const adapter = new FakeAdapter('RadioMaster');
    adapter.emit({ channels: neutralChannels(), buttons: [], connected: true });
    const pipeline = new PilotInputPipeline({
      adapters: [adapter],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: (id) => createMode2Profile(id),
    });

    const result = pipeline.poll(5_000);
    expect(result.source).toMatchObject<PilotInputSource>({ kind: 'adapter', id: 'RadioMaster', label: 'RadioMaster', adapterId: 'RadioMaster' });
    // Neutral Mode 2 throttle yields 0.5; the RC drove the command.
    expect(result.command.throttle).toBeCloseTo(0.5, 6);
  });

  it('falls back to the keyboard when the controller is disconnected', () => {
    const adapter = new FakeAdapter('RadioMaster');
    adapter.emit({ channels: neutralChannels(), connected: false });
    const pipeline = new PilotInputPipeline({
      adapters: [adapter],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: (id) => createMode2Profile(id),
    });

    const result = pipeline.poll(5_000);
    expect(result.source.kind).toBe('keyboard');
    expect(result.command.throttle).toBe(0.5);
  });

  it('falls back to the keyboard when no adapter is configured', () => {
    const pipeline = new PilotInputPipeline({
      adapters: [],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: () => null,
    });
    expect(pipeline.poll(5_000).source.kind).toBe('keyboard');
  });

  it('deflecting a roll axis on the controller moves the aircraft command', () => {
    const adapter = new FakeAdapter('RadioMaster');
    const channels = neutralChannels();
    channels[0] = 0.5; // roll axis
    adapter.emit({ channels, connected: true });
    const profile = createMode2Profile('RadioMaster');
    const pipeline = new PilotInputPipeline({
      adapters: [adapter],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: () => profile,
    });

    const result = pipeline.poll(5_000);
    expect(result.command.roll).toBeCloseTo(0.5, 6);
    expect(result.command.flightMode).toBe('manual');
  });
});

describe('PilotInputPipeline stale / safety contract', () => {
  it('enters hover once the controller link is stale past 250 ms but keeps throttle', () => {
    const adapter = new FakeAdapter('RadioMaster');
    // Mode 2 throttle is reversed: raw -1 (stick forward) is full throttle.
    // Freeze the timestamp so the following poll reports a 300 ms-old sample.
    adapter.emit({ channels: [0, 0, 0, -1], connected: true }, { frozenTimestamp: 5_000 });
    const profile = createMode2Profile('RadioMaster');
    const pipeline = new PilotInputPipeline({
      adapters: [adapter],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: () => profile,
    });

    const fresh = pipeline.poll(5_000);
    expect(fresh.command.flightMode).toBe('manual');
    expect(fresh.command.throttle).toBeGreaterThan(0.5);

    // Advance the pipeline clock 300 ms; the device stayed silent so its sample is stale.
    const stale = pipeline.poll(5_300);
    expect(stale.command.flightMode).toBe('hover');
    // Throttle must be held, never snapped to zero.
    expect(stale.command.throttle).toBeGreaterThan(0.5);
  });

  it('recovers to manual the moment a fresh sample arrives', () => {
    const adapter = new FakeAdapter('RadioMaster');
    adapter.emit({ channels: [0, 0, 0, -1], connected: true }, { frozenTimestamp: 5_000 });
    const pipeline = new PilotInputPipeline({
      adapters: [adapter],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: (id) => createMode2Profile(id),
    });

    pipeline.poll(5_000);
    pipeline.poll(5_300); // stale -> hover
    adapter.emit({ channels: [0, 0, 0, -1], connected: true }); // device sends fresh data again
    const recovered = pipeline.poll(5_310); // fresh again
    expect(recovered.command.flightMode).toBe('manual');
  });
});

describe('PilotInputPipeline robustness', () => {
  it('surfaces an error and falls back to keyboard when a binding is out of range instead of throwing', () => {
    const adapter = new FakeAdapter('RadioMaster');
    // Profile binds axis 4 but the device only reports 2 axes.
    adapter.emit({ channels: [0, 0], connected: true });
    const profile: DeviceProfile = createMode2Profile('RadioMaster');
    profile.axes.yaw = { source: 4, kind: 'bipolar', calibration: { min: -1, center: 0, max: 1, reverse: false, deadzone: 0, expo: 0 } };
    const pipeline = new PilotInputPipeline({
      adapters: [adapter],
      keyboard: () => KEYBOARD_COMMAND,
      profileFor: () => profile,
    });

    const result = pipeline.poll(5_000);
    expect(result.source.kind).toBe('keyboard');
    expect(pipeline.getLastError()).toMatch(/axis 4|轴 4/);
  });
});
