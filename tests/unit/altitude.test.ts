import { describe, expect, it } from 'vitest';
import { SimpleFlightController } from '../../src/flight/adapters/SimpleFlightController';
import type { PilotCommand } from '../../src/flight/types';

/**
 * Verifies the altitude source the HUD reads (snapshot.position.y / altitudeM)
 * actually tracks the aircraft's vertical position during a throttle climb.
 * If this passes, the "高度 0.0" report is a neutral-throttle-on-ground state,
 * not a wrong source — altitude and the scene share the same vertical field.
 */
const HOVER: PilotCommand = {
  roll: 0, pitch: 0, yaw: 0, throttle: 0.5, arm: true, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
};
const CLIMB: PilotCommand = {
  roll: 0, pitch: 0, yaw: 0, throttle: 1, arm: true, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
};

describe('altitude source consistency', () => {
  it('takeoff + climb raises altitudeM above 0', () => {
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    for (let i = 0; i < 60; i += 1) fc.update(HOVER, 0.05);
    for (let i = 0; i < 120; i += 1) fc.update(CLIMB, 0.05);
    const s = fc.snapshot();
    console.log(`[altitude] after takeoff+climb: position.y=${s.position.y.toFixed(2)} altitudeM=${s.altitudeM.toFixed(2)}`);
    expect(s.position.y).toBeGreaterThan(1);
    expect(s.altitudeM).toBeCloseTo(s.position.y, 5);
  });

  it('neutral throttle on the ground keeps altitude at 0 (forward only, no climb)', () => {
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    for (let i = 0; i < 60; i += 1) fc.update(HOVER, 0.05);
    // Pitch forward only — like the teacher's direction test — no throttle:
    const forward: PilotCommand = { ...HOVER, pitch: 1 };
    for (let i = 0; i < 120; i += 1) fc.update(forward, 0.05);
    const s = fc.snapshot();
    console.log(`[altitude] forward-only: position.y=${s.position.y.toFixed(2)} position.z=${s.position.z.toFixed(2)}`);
    // Altitude stays near the hover target (5 m here) — Z moves forward, Y does not drop to 0.
    expect(s.position.z).toBeLessThan(0);
    expect(s.position.y).toBeGreaterThan(1);
  });
});
