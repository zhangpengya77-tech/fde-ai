import { describe, expect, it } from 'vitest';

import { MissionEngine } from '../../src/mission/MissionEngine';
import {
  DEFAULT_MISSION_CONFIG as CFG,
  MISSION_STATE_LABEL,
  MISSION_STEP_ORDER,
  type MissionTelemetry,
} from '../../src/mission/types';
import type { PhotoValidationResult } from '../../src/inspection/types';

function telemetry(overrides: Partial<MissionTelemetry> = {}): MissionTelemetry {
  return {
    flightState: 'disarmed',
    altitude: 0,
    position: { x: 0, y: 0, z: 0 },
    homePoint: { x: 0, y: 0, z: 0 },
    insideInspectionZone: false,
    safetyState: 'SAFE',
    distanceToTarget: 999,
    distanceToHome: 999,
    gimbalAimed: false,
    ...overrides,
  };
}

/** Drives arm → takeoff → up to FLY_TO_TARGET (still outside the zone). */
function armToFlyTarget(engine: MissionEngine): void {
  engine.update(telemetry({ flightState: 'armed' }));
  engine.update(telemetry({ flightState: 'taking-off' }));
  engine.update(
    telemetry({ flightState: 'flying', altitude: CFG.takeoffAltitudeM + 1, distanceToTarget: 20 }),
  );
}

/** Drives the engine all the way to AIM_CAMERA (inside the safe zone). */
function inspectReady(engine: MissionEngine): void {
  armToFlyTarget(engine);
  const positioned: MissionTelemetry = {
    flightState: 'flying',
    altitude: 8,
    position: { x: -5.4, y: 8, z: 4 },
    homePoint: { x: 0, y: 0, z: 0 },
    insideInspectionZone: true,
    safetyState: 'WARNING',
    distanceToTarget: 3,
    distanceToHome: 12,
    gimbalAimed: false,
  };
  // Inside the zone → POSITION_FOR_INSPECTION.
  engine.update(positioned);
  // One more frame: positioned & safe → AIM_CAMERA.
  engine.update({ ...positioned, gimbalAimed: true });
}

function validPhoto(overrides: Partial<PhotoValidationResult> = {}): PhotoValidationResult {
  return {
    targetVisible: true,
    coverageRatio: 0.2,
    distanceToTarget: 2.5,
    angleErrorDeg: 3,
    insideInspectionZone: true,
    safetyState: 'WARNING',
    valid: true,
    reasons: [],
    ...overrides,
  };
}

describe('MissionEngine - normal transitions', () => {
  it('starts in IDLE and advances to READY once the aircraft is armed', () => {
    const engine = new MissionEngine();
    expect(engine.currentState).toBe('IDLE');
    engine.update(telemetry({ flightState: 'armed' }));
    expect(engine.currentState).toBe('READY');
  });

  it('walks READY → TAKEOFF → FLY_TO_TARGET on real flight conditions', () => {
    const engine = new MissionEngine();
    engine.update(telemetry({ flightState: 'armed' }));
    expect(engine.currentState).toBe('READY');

    engine.update(telemetry({ flightState: 'taking-off', altitude: 0.4 }));
    expect(engine.currentState).toBe('TAKEOFF');

    // Altitude below the threshold must not advance.
    engine.update(telemetry({ flightState: 'flying', altitude: 1 }));
    expect(engine.currentState).toBe('TAKEOFF');

    engine.update(telemetry({ flightState: 'flying', altitude: CFG.takeoffAltitudeM + 0.5 }));
    expect(engine.currentState).toBe('FLY_TO_TARGET');
  });

  it('only steps into the inspection position once inside the zone', () => {
    const engine = new MissionEngine();
    armToFlyTarget(engine);
    expect(engine.currentState).toBe('FLY_TO_TARGET');

    // Still outside the zone.
    engine.update(telemetry({ flightState: 'flying', altitude: 8, distanceToTarget: 10, insideInspectionZone: false }));
    expect(engine.currentState).toBe('FLY_TO_TARGET');

    // Inside the zone but still far → becomes positioned.
    engine.update(
      telemetry({ flightState: 'flying', altitude: 8, distanceToTarget: 3, insideInspectionZone: true, safetyState: 'WARNING' }),
    );
    expect(engine.currentState).toBe('POSITION_FOR_INSPECTION');

    // Safe & inside → move to aiming (capture wait).
    engine.update(
      telemetry({
        flightState: 'flying',
        altitude: 8,
        distanceToTarget: 2.5,
        insideInspectionZone: true,
        safetyState: 'WARNING',
        gimbalAimed: true,
      }),
    );
    expect(engine.currentState).toBe('AIM_CAMERA');
  });

  it('completes the full happy-path loop end to end', () => {
    const engine = new MissionEngine();
    inspectReady(engine);
    expect(engine.currentState).toBe('AIM_CAMERA');

    const permission = engine.requestCapture();
    expect(permission.ok).toBe(true);
    expect(engine.currentState).toBe('CAPTURE');

    engine.submitPhoto(validPhoto());
    expect(engine.currentState).toBe('AI_INSPECTION');

    engine.submitAI({ defectDetected: true, defectType: 'MISSING_INSULATOR_DISC', confidence: 0.92, source: 'mock' });
    expect(engine.currentState).toBe('INSPECTION_COMPLETE');
    expect(engine.aiResult?.defectDetected).toBe(true);

    expect(engine.requestReturn().ok).toBe(true);
    expect(engine.currentState).toBe('RETURN');

    // Not home yet.
    engine.update(telemetry({ flightState: 'flying', altitude: 8, distanceToHome: 10 }));
    expect(engine.currentState).toBe('RETURN');
    // Arrived home → land.
    engine.update(telemetry({ flightState: 'flying', altitude: 8, distanceToHome: 1 }));
    expect(engine.currentState).toBe('LAND');
    // Landing completes once back on the ground.
    engine.update(telemetry({ flightState: 'armed', altitude: 0 }));
    expect(engine.currentState).toBe('COMPLETE');
  });
});

describe('MissionEngine - gated actions / no fake completion', () => {
  it('refuses capture before AIM_CAMERA', () => {
    const engine = new MissionEngine();
    armToFlyTarget(engine);
    expect(engine.currentState).toBe('FLY_TO_TARGET');
    const permission = engine.requestCapture();
    expect(permission.ok).toBe(false);
    expect(engine.currentState).toBe('FLY_TO_TARGET');
  });

  it('allows a capture from AIM_CAMERA regardless of aim (quality is the validator job)', () => {
    const engine = new MissionEngine();
    inspectReady(engine);
    expect(engine.currentState).toBe('AIM_CAMERA');
    // Capture is allowed even with the gimbal not aimed; ProjectionPhotoValidator
    // later decides whether the photo is usable, so a bad shot can be retried.
    const permission = engine.requestCapture();
    expect(permission.ok).toBe(true);
    expect(engine.currentState).toBe('CAPTURE');
  });
});

describe('MissionEngine - retry loop and failure', () => {
  it('does not complete on an invalid photo; returns to aiming with reasons', () => {
    const engine = new MissionEngine();
    inspectReady(engine);
    engine.requestCapture();

    engine.submitPhoto(
      validPhoto({ valid: false, targetVisible: false, coverageRatio: 0, reasons: ['巡检目标未进入画面'] }),
    );
    expect(engine.currentState).toBe('AIM_CAMERA');
    expect(engine.photoResult?.valid).toBe(false);
    expect(engine.rejectionReasons).toContain('巡检目标未进入画面');

    // The trainee re-aims and shoots again → now it advances to AI.
    engine.requestCapture();
    engine.submitPhoto(validPhoto());
    expect(engine.currentState).toBe('AI_INSPECTION');
  });

  it('fails the mission on COLLISION while airborne', () => {
    const engine = new MissionEngine();
    inspectReady(engine);
    engine.update(
      telemetry({ flightState: 'flying', altitude: 8, insideInspectionZone: true, safetyState: 'COLLISION' }),
    );
    expect(engine.currentState).toBe('FAILED');
  });

  it('refuses return before the inspection completes', () => {
    const engine = new MissionEngine();
    inspectReady(engine);
    expect(engine.requestReturn().ok).toBe(false);
    expect(engine.currentState).toBe('AIM_CAMERA');
  });

  it('ignores submitPhoto/submitAI from the wrong state', () => {
    const engine = new MissionEngine();
    engine.submitPhoto(validPhoto());
    expect(engine.currentState).toBe('IDLE');
    engine.submitAI({ defectDetected: true, defectType: 'MISSING_INSULATOR_DISC', confidence: 0.9, source: 'mock' });
    expect(engine.currentState).toBe('IDLE');
  });
});

describe('MissionEngine - display helpers', () => {
  it('exposes ordered progress and Chinese labels', () => {
    const engine = new MissionEngine();
    expect(engine.stepInfo().label).toBe('待开始');
    inspectReady(engine);
    expect(engine.currentState).toBe('AIM_CAMERA');
    const info = engine.stepInfo();
    expect(info.label).toBe(MISSION_STATE_LABEL.AIM_CAMERA);
    expect(info.progress).toBe('5 / 12');
    expect(MISSION_STEP_ORDER.indexOf('AIM_CAMERA') + 1).toBe(5);
    expect(CFG.takeoffAltitudeM).toBeGreaterThan(0);
  });

  it('start() placeholder: IDLE has empty progress until begun', () => {
    const engine = new MissionEngine();
    expect(engine.progress).toBe('');
  });
});
