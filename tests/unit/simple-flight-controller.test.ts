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

/** 手動模式、四軸歸一化全在死區內（= 0）時的指令。 */
const neutralManualCommand: PilotCommand = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0,
  arm: true,
  flightMode: 'manual',
  gimbalYaw: 0,
  gimbalPitch: 0,
};

describe('SimpleFlightController — 無輸入速度衰減（靜止漂移防護）', () => {
  function flyingController(): SimpleFlightController {
    const controller = new SimpleFlightController();
    controller.arm();
    controller.takeoff(3);
    stepFor(controller, hoverCommand, 3);
    return controller;
  }

  it('無輸入時速度指數衰減到 0，位置不再被積分', () => {
    const controller = flyingController();
    // 先全舵衝一下留下速度（油門置中，避免垂直方向也留下速度）
    stepFor(controller, { ...neutralManualCommand, pitch: 1, throttle: 0.5 }, 1);
    const moving = controller.snapshot();
    expect(moving.horizontalSpeedMps).toBeGreaterThan(5);
    expect(Math.abs(moving.velocity.y)).toBeLessThan(0.01);

    const before = controller.snapshot().position;
    stepFor(controller, neutralManualCommand, 10);
    const after = controller.snapshot();

    // 10 秒無輸入：水平位移趨近 0（衰減時間常數 0.3s，理論積分上限 ≈ 8×0.3 = 2.4m）
    expect(after.horizontalSpeedMps).toBeLessThan(0.01);
    expect(Math.hypot(after.position.x - before.x, after.position.z - before.z)).toBeLessThan(2.5);
    // 高度也保持：不再把「油門在底部」当成下降指令
    expect(after.position.y).toBeCloseTo(before.y, 2);
  });

  it('放開搖桿後滑行距離明顯短於舊的線性減速', () => {
    const controller = flyingController();
    stepFor(controller, { ...neutralManualCommand, pitch: 1 }, 2);
    const atRelease = controller.snapshot();
    expect(atRelease.horizontalSpeedMps).toBeCloseTo(8, 1);

    const from = atRelease.position;
    stepFor(controller, neutralManualCommand, 2);
    const after = controller.snapshot();
    const glide = Math.hypot(after.position.x - from.x, after.position.z - from.z);

    // 舊行為（approach 7 m/s² 線性減速）理論滑行 = v²/2a = 8²/14 ≈ 4.57m
    expect(glide).toBeLessThan(3);
    expect(after.horizontalSpeedMps).toBeLessThan(0.05);
  });

  it('有任何有效輸入就不衰減，飛行物理不變', () => {
    const controller = flyingController();
    const before = controller.snapshot().position;
    // 小舵量（0.05）仍是有效輸入：必須持續前進
    stepFor(controller, { ...neutralManualCommand, pitch: 0.05 }, 3);
    const after = controller.snapshot();
    expect(after.position.z).toBeLessThan(before.z - 0.5);
    expect(after.horizontalSpeedMps).toBeGreaterThan(0.2);
  });
});
