import { describe, expect, it } from 'vitest';

import { buildTransmissionLayout } from '../../src/scenes/SceneDefinition';
import {
  DEFAULT_SAFETY_CONFIG,
  SafetyDistanceEngine,
  type SafetyConfig,
} from '../../src/safety/SafetyEngine';
import type { Vec3 } from '../../src/inspection/types';
import type { TransmissionLayout } from '../../src/scenes/SceneDefinition';

/** A layout with a single vertical tower at the origin and nothing else nearby. */
function towerOnlyLayout(): TransmissionLayout {
  return {
    towers: [{ id: 'T1', base: { x: 0, y: 0, z: 0 }, top: { x: 0, y: 10, z: 0 }, height: 10 }],
    wires: [],
    wireSamples: [],
    target: { id: 'TGT', position: { x: 1000, y: 1000, z: 1000 }, defectType: 'MISSING_INSULATOR_DISC', label: 't' },
    obstacles: [],
    inspectionZoneRadius: 3.5,
  };
}

/** A layout with a single straight wire (y=10) along x and nothing else nearby. */
function wireOnlyLayout(): TransmissionLayout {
  const samples: Vec3[] = [];
  for (let x = 0; x <= 10; x += 1) samples.push({ x, y: 10, z: 0 });
  return {
    towers: [],
    wires: [],
    wireSamples: [samples],
    target: { id: 'TGT', position: { x: 1000, y: 1000, z: 1000 }, defectType: 'MISSING_INSULATOR_DISC', label: 't' },
    obstacles: [],
    inspectionZoneRadius: 3.5,
  };
}

/** A layout with the target at the origin and nothing else nearby. */
function targetOnlyLayout(): TransmissionLayout {
  return {
    towers: [],
    wires: [],
    wireSamples: [],
    target: { id: 'TGT', position: { x: 0, y: 0, z: 0 }, defectType: 'MISSING_INSULATOR_DISC', label: 't' },
    obstacles: [],
    inspectionZoneRadius: 3.5,
  };
}

/** A layout with a single obstacle at the origin and nothing else nearby. */
function obstacleOnlyLayout(): TransmissionLayout {
  return {
    towers: [],
    wires: [],
    wireSamples: [],
    target: { id: 'TGT', position: { x: 1000, y: 1000, z: 1000 }, defectType: 'MISSING_INSULATOR_DISC', label: 't' },
    obstacles: [{ id: 'OBS', position: { x: 0, y: 0, z: 0 }, radius: 1.4 }],
    inspectionZoneRadius: 3.5,
  };
}

describe('SafetyDistanceEngine - tower distance bands', () => {
  const engine = new SafetyDistanceEngine(towerOnlyLayout());

  it('classifies SAFE far from the tower', () => {
    expect(engine.evaluate({ x: 10, y: 5, z: 0 }).safetyState).toBe('SAFE');
  });

  it('classifies WARNING inside the warning ring but outside danger', () => {
    const result = engine.evaluate({ x: 6, y: 5, z: 0 });
    expect(result.safetyState).toBe('WARNING');
    expect(result.distanceToTower).toBeCloseTo(6, 10);
  });

  it('classifies DANGER inside the danger ring but outside collision', () => {
    const result = engine.evaluate({ x: 3, y: 5, z: 0 });
    expect(result.safetyState).toBe('DANGER');
    expect(result.distanceToTower).toBeCloseTo(3, 10);
  });

  it('classifies COLLISION at the tower structure', () => {
    const result = engine.evaluate({ x: 1, y: 5, z: 0 });
    expect(result.safetyState).toBe('COLLISION');
    expect(result.distanceToTower).toBeCloseTo(1, 10);
  });
});

describe('SafetyDistanceEngine - wire distance bands', () => {
  const engine = new SafetyDistanceEngine(wireOnlyLayout());

  it('classifies SAFE far below the wire', () => {
    expect(engine.evaluate({ x: 0, y: 5, z: 0 }).safetyState).toBe('SAFE');
  });

  it('classifies WARNING near the wire', () => {
    const result = engine.evaluate({ x: 0, y: 7, z: 0 });
    expect(result.safetyState).toBe('WARNING');
    expect(result.distanceToWire).toBeCloseTo(3, 10);
  });

  it('classifies DANGER close to the wire', () => {
    const result = engine.evaluate({ x: 0, y: 9, z: 0 });
    expect(result.safetyState).toBe('DANGER');
    expect(result.distanceToWire).toBeCloseTo(1, 10);
  });

  it('classifies COLLISION at the wire', () => {
    const result = engine.evaluate({ x: 0, y: 9.5, z: 0 });
    expect(result.safetyState).toBe('COLLISION');
    expect(result.distanceToWire).toBeCloseTo(0.5, 10);
  });
});

describe('SafetyDistanceEngine - target distance bands', () => {
  const engine = new SafetyDistanceEngine(targetOnlyLayout());

  it('classifies SAFE far from the target', () => {
    expect(engine.evaluate({ x: 4, y: 0, z: 0 }).safetyState).toBe('SAFE');
  });

  it('classifies WARNING inside the target warning ring', () => {
    const result = engine.evaluate({ x: 2, y: 0, z: 0 });
    expect(result.safetyState).toBe('WARNING');
    expect(result.distanceToTarget).toBeCloseTo(2, 10);
  });

  it('classifies DANGER close to the target', () => {
    const result = engine.evaluate({ x: 1, y: 0, z: 0 });
    expect(result.safetyState).toBe('DANGER');
    expect(result.distanceToTarget).toBeCloseTo(1, 10);
  });

  it('classifies COLLISION at the target (insulator contact)', () => {
    const result = engine.evaluate({ x: 0.3, y: 0, z: 0 });
    expect(result.safetyState).toBe('COLLISION');
    expect(result.distanceToTarget).toBeCloseTo(0.3, 10);
  });
});

describe('SafetyDistanceEngine - obstacle distance bands', () => {
  const engine = new SafetyDistanceEngine(obstacleOnlyLayout());

  it('classifies SAFE far from the obstacle', () => {
    expect(engine.evaluate({ x: 6, y: 0, z: 0 }).safetyState).toBe('SAFE');
  });

  it('classifies WARNING inside the obstacle warning ring', () => {
    expect(engine.evaluate({ x: 4, y: 0, z: 0 }).safetyState).toBe('WARNING');
  });

  it('classifies DANGER close to the obstacle', () => {
    expect(engine.evaluate({ x: 2, y: 0, z: 0 }).safetyState).toBe('DANGER');
  });

  it('classifies COLLISION at the obstacle', () => {
    expect(engine.evaluate({ x: 0.5, y: 0, z: 0 }).safetyState).toBe('COLLISION');
  });

  it('reports the nearest obstacle clearance', () => {
    const result = engine.evaluate({ x: 4, y: 0, z: 0 });
    expect(result.safetyState).toBe('WARNING');
    expect(new SafetyDistanceEngine(obstacleOnlyLayout()).nearestObstacleDistance({ x: 4, y: 0, z: 0 })).toBeCloseTo(4, 10);
  });
});

describe('SafetyDistanceEngine - worst-case precedence', () => {
  it('escalates to COLLISION when the worst hazard is a collision', () => {
    // Target-only layout, collision at target.
    const engine = new SafetyDistanceEngine(targetOnlyLayout());
    expect(engine.evaluate({ x: 0.3, y: 0, z: 0 }).safetyState).toBe('COLLISION');
  });

  it('never reports worse than the worst single hazard', () => {
    const result = new SafetyDistanceEngine(towerOnlyLayout()).evaluate({ x: 3, y: 5, z: 0 });
    // DANGER from tower, everything else SAFE -> stays DANGER, not COLLISION.
    expect(result.safetyState).toBe('DANGER');
  });
});

describe('SafetyDistanceEngine - inspection zone (real layout)', () => {
  const layout = buildTransmissionLayout();
  const engine = new SafetyDistanceEngine(layout);

  it('recognizes a point at the target as inside the zone', () => {
    const result = engine.evaluate({ ...layout.target.position });
    expect(result.insideInspectionZone).toBe(true);
    expect(result.distanceToTarget).toBeCloseTo(0, 10);
  });

  it('recognizes a point within the zone radius as inside', () => {
    const position: Vec3 = {
      x: layout.target.position.x + 2,
      y: layout.target.position.y,
      z: layout.target.position.z,
    };
    const result = engine.evaluate(position);
    expect(result.distanceToTarget).toBeCloseTo(2, 10);
    expect(result.insideInspectionZone).toBe(true);
  });

  it('recognizes a point outside the zone radius as outside', () => {
    const position: Vec3 = {
      x: layout.target.position.x + 5,
      y: layout.target.position.y,
      z: layout.target.position.z,
    };
    const result = engine.evaluate(position);
    expect(result.distanceToTarget).toBeCloseTo(5, 10);
    expect(result.insideInspectionZone).toBe(false);
  });
});

describe('SafetyDistanceEngine - SAFE on the real layout', () => {
  const layout = buildTransmissionLayout();
  const engine = new SafetyDistanceEngine(layout);

  it('reports SAFE and measurable distances when parked far from every hazard', () => {
    const result = engine.evaluate({ x: 50, y: 30, z: 30 });
    expect(result.safetyState).toBe('SAFE');
    expect(result.distanceToTower).toBeGreaterThan(DEFAULT_SAFETY_CONFIG.tower.warning);
    expect(result.distanceToWire).toBeGreaterThan(DEFAULT_SAFETY_CONFIG.wire.warning);
    expect(result.distanceToTarget).toBeGreaterThan(DEFAULT_SAFETY_CONFIG.target.warning);
    expect(result.insideInspectionZone).toBe(false);
  });
});

describe('SafetyDistanceEngine - default config sanity', () => {
  it('uses the documented teaching radii', () => {
    const config: SafetyConfig = DEFAULT_SAFETY_CONFIG;
    expect(config.tower).toEqual({ collision: 1.5, danger: 4, warning: 8 });
    expect(config.wire).toEqual({ collision: 0.8, danger: 2, warning: 4 });
    expect(config.target).toEqual({ collision: 0.5, danger: 1.2, warning: 3 });
    expect(config.obstacle).toEqual({ collision: 1.0, danger: 2.5, warning: 5 });
  });
});
