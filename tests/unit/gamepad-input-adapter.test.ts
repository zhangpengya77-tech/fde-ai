import { describe, expect, it } from 'vitest';

import { GamepadInputAdapter } from '../../src/input/adapters/GamepadInputAdapter';
import type { GamepadLike, GamepadSource } from '../../src/input/adapters/GamepadInputAdapter';

function pad(overrides: Partial<GamepadLike> = {}): GamepadLike {
  return {
    id: 'RadioMaster EdgeTX (Vendor: 0483 Product: 572b)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0, 0, 0],
    buttons: [],
    ...overrides,
  };
}

function source(pads: Array<GamepadLike | null>): GamepadSource {
  return { getGamepads: () => pads.map((entry) => entry ?? null) };
}

describe('GamepadInputAdapter', () => {
  it('resolves connect() once a controller is enumerated by the Gamepad API', async () => {
    const adapter = new GamepadInputAdapter(0, source([pad()]));
    await adapter.connect();
    expect(adapter.isConnected).toBe(true);
    expect(adapter.id).toBe('RadioMaster EdgeTX (Vendor: 0483 Product: 572b)');
  });

  it('exposes the physical axes and analog button values of the connected controller', async () => {
    const device = pad({
      axes: [0.4, -0.6, 0.2, 0.5, 0, 0],
      buttons: [
        { value: 0.75, pressed: true },
        { value: 0, pressed: false },
        { value: 1, pressed: true },
      ],
    });
    const adapter = new GamepadInputAdapter(0, source([device]));
    await adapter.connect();

    const sample = adapter.poll(1_000);
    expect(sample.connected).toBe(true);
    expect(sample.timestampMs).toBe(1_000);
    expect(Array.from(sample.channels)).toEqual([0.4, -0.6, 0.2, 0.5, 0, 0]);
    expect(Array.from(sample.buttons)).toEqual([0.75, 0, 1]);
  });

  it('reports a disconnected sample when the controller disappears, without inventing motion', async () => {
    const adapter = new GamepadInputAdapter(0, source([pad()]));
    await adapter.connect();

    const dropped = new GamepadInputAdapter(0, source([null]));
    const sample = dropped.poll(2_000);

    expect(sample.connected).toBe(false);
    expect(Array.from(sample.channels)).toEqual(new Array(6).fill(0));
    expect(Array.from(sample.buttons)).toEqual(new Array(0).fill(0));
    expect(adapter.isConnected).toBe(true);
  });

  it('keeps serving the last known snapshot while the controller is reported connected', async () => {
    const adapter = new GamepadInputAdapter(0, source([pad({ axes: [0.5, 0, 0, 0.25, 0, 0] })]));
    await adapter.connect();
    expect(adapter.poll(1_000).channels[0]).toBeCloseTo(0.5, 6);
  });

  it('selects the gamepad at its own index and ignores unrelated slots', async () => {
    const other = pad({ id: 'unrelated keyboard-ish device', index: 1, axes: [1, 1, 1, 1, 0, 0] });
    const target = pad({ id: 'RadioMaster EdgeTX', index: 0, axes: [0.25, 0, 0, 0.75, 0, 0] });
    const adapter = new GamepadInputAdapter(0, source([target, other]));
    await adapter.connect();

    const sample = adapter.poll(1_000);
    expect(sample.connected).toBe(true);
    expect(sample.channels[0]).toBeCloseTo(0.25, 6);
    expect(adapter.id).toBe('RadioMaster EdgeTX');
  });

  it('fails clearly when the browser has no Gamepad API at all', async () => {
    const missing: GamepadSource = { getGamepads: undefined as unknown as GamepadSource['getGamepads'] };
    const adapter = new GamepadInputAdapter(0, missing);
    await expect(adapter.connect()).rejects.toThrow(/Gamepad API/);
    expect(adapter.isConnected).toBe(false);
    expect(adapter.lastError).toMatch(/Gamepad API/);
  });

  it('stops sampling after disconnect()', async () => {
    const adapter = new GamepadInputAdapter(0, source([pad()]));
    await adapter.connect();
    expect(adapter.isConnected).toBe(true);

    adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
    const sample = adapter.poll(3_000);
    expect(sample.connected).toBe(false);
  });

  it('never binds a controller brand to the flight contract - only raw channels leave the adapter', async () => {
    const radioMaster = new GamepadInputAdapter(0, source([pad({ id: 'RadioMaster EdgeTX' })]));
    const radioLink = new GamepadInputAdapter(1, source([null, pad({ id: 'RadioLink AT9S Simulator', index: 1 })]));

    await radioMaster.connect();
    await radioLink.connect();

    const rm = radioMaster.poll(1_000);
    const rl = radioLink.poll(1_000);

    // Identical channel shape regardless of brand.
    expect(Object.keys(rm)).toEqual(Object.keys(rl));
    expect(rm).toEqual(rl);
  });
});
