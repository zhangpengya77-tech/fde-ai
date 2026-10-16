import { describe, expect, it } from 'vitest';

import { SimpleFlightController } from '../../src/flight/adapters/SimpleFlightController';
import type { PilotCommand } from '../../src/flight/types';

const hoverCommand: PilotCommand = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0.5,
  arm: true,
  flightMode: 'hover',
  gimbalYaw: 0,
  gimbalPitch: 0,
};

function stepFor(controller: SimpleFlightController, command: PilotCommand, seconds: number): void {
  const delta = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += delta) {
    controller.update(command, delta);
  }
}

describe('SimpleFlightController', () => {
  it('arms at the current home point and takes off to the requested altitude', () => {
    const controller = new SimpleFlightController();

    expect(controller.snapshot().state).toBe('disarmed');
    expect(controller.arm().ok).toBe(true);
    expect(controller.takeoff(5).ok).toBe(true);

    stepFor(controller, hoverCommand, 4);

    const snapshot = controller.snapshot();
    expect(snapshot.state).toBe('flying');
    expect(snapshot.position.y).toBeCloseTo(5, 1);
    expect(snapshot.homePoint).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('maps pitch, roll, yaw and throttle to bounded teaching-flight motion', () => {
    const controller = new SimpleFlightController();
    controller.arm();
    controller.takeoff(3);
    stepFor(controller, hoverCommand, 3);

    const command: PilotCommand = {
      ...hoverCommand,
      roll: 0.5,
      pitch: 1,
      yaw: 0.5,
      throttle: 0.75,
      flightMode: 'manual',
    };
    stepFor(controller, command, 1);

    const snapshot = controller.snapshot();
    expect(snapshot.position.x).toBeGreaterThan(0);
    expect(snapshot.position.z).toBeLessThan(0);
    expect(snapshot.position.y).toBeGreaterThan(3);
    expect(snapshot.rollDeg).toBeGreaterThan(0);
    expect(snapshot.pitchDeg).toBeGreaterThan(0);
    expect(snapshot.headingDeg).toBeGreaterThan(0);
    expect(snapshot.horizontalSpeedMps).toBeLessThanOrEqual(8);
  });

  it('holds position in hover mode and lands without going below ground', () => {
    const controller = new SimpleFlightController();
    controller.arm();
    controller.takeoff(2);
    stepFor(controller, hoverCommand, 2);

    const before = controller.snapshot().position;
    stepFor(controller, hoverCommand, 1);
    const after = controller.snapshot().position;

    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.z).toBeCloseTo(before.z, 5);

    expect(controller.land().ok).toBe(true);
    stepFor(controller, hoverCommand, 3);
    expect(controller.snapshot().state).toBe('armed');
    expect(controller.snapshot().position.y).toBe(0);
    expect(controller.disarm().ok).toBe(true);
  });

  it('rejects takeoff while disarmed and stops immediately on emergency', () => {
    const controller = new SimpleFlightController();

    expect(controller.takeoff(3).ok).toBe(false);
    controller.arm();
    controller.takeoff(3);
    stepFor(controller, hoverCommand, 1);
    expect(controller.emergencyStop().ok).toBe(true);

    const stopped = controller.update({ ...hoverCommand, pitch: 1, flightMode: 'manual' }, 1);
    expect(stopped.state).toBe('emergency');
    expect(stopped.horizontalSpeedMps).toBe(0);
    expect(stopped.verticalSpeedMps).toBe(0);
  });
});
