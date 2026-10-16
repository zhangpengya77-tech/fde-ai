import { describe, expect, it } from 'vitest';

import {
  buildTransmissionLayout,
  createSaggingWire,
  distance,
  pointToPolylineDistance,
  pointToSegmentDistance,
  TOWER_1_BASE,
  TOWER_2_BASE,
  TOWER_HEIGHT,
} from '../../src/scenes/SceneDefinition';

describe('buildTransmissionLayout - tower generation', () => {
  it('produces exactly two towers with the documented bases and height', () => {
    const layout = buildTransmissionLayout();

    expect(layout.towers).toHaveLength(2);

    const [tower1, tower2] = layout.towers;
    expect(tower1.id).toBe('T1');
    expect(tower1.base).toEqual(TOWER_1_BASE);
    expect(tower1.top).toEqual({ x: TOWER_1_BASE.x, y: TOWER_HEIGHT, z: TOWER_1_BASE.z });
    expect(tower1.height).toBe(TOWER_HEIGHT);

    expect(tower2.id).toBe('T2');
    expect(tower2.base).toEqual(TOWER_2_BASE);
    expect(tower2.top).toEqual({ x: TOWER_2_BASE.x, y: TOWER_HEIGHT, z: TOWER_2_BASE.z });
    expect(tower2.height).toBe(TOWER_HEIGHT);
  });

  it('keeps both tower columns vertical (base.x/z === top.x/z)', () => {
    const layout = buildTransmissionLayout();
    for (const tower of layout.towers) {
      expect(tower.top.x).toBe(tower.base.x);
      expect(tower.top.z).toBe(tower.base.z);
      expect(tower.top.y).toBeGreaterThan(tower.base.y);
    }
  });
});

describe('buildTransmissionLayout - power lines', () => {
  it('produces two sagging conductors', () => {
    const layout = buildTransmissionLayout();
    expect(layout.wires).toHaveLength(2);
    expect(layout.wires.every((wire) => wire.sag > 0)).toBe(true);
    expect(layout.wireSamples).toHaveLength(2);
  });

  it('resolves every wire to a sampled poly-line pinned to its own ends', () => {
    const layout = buildTransmissionLayout();
    layout.wires.forEach((wire, index) => {
      const samples = layout.wireSamples[index];
      expect(samples.length).toBeGreaterThan(2);
      // First and last samples sit on each wire's attachment points (zero sag at ends).
      expect(samples[0]).toEqual(wire.from);
      expect(samples[samples.length - 1]).toEqual(wire.to);
    });
  });
});

describe('buildTransmissionLayout - inspection target', () => {
  it('fixes the first target to the right insulator string of tower 1 (missing disc)', () => {
    const layout = buildTransmissionLayout();

    expect(layout.target.id).toBe('INS-T1-RIGHT');
    expect(layout.target.position).toEqual({ x: TOWER_1_BASE.x + 1.6, y: 8, z: TOWER_1_BASE.z });
    expect(layout.target.defectType).toBe('MISSING_INSULATOR_DISC');
    expect(layout.target.label).toContain('绝缘子');
  });
});

describe('buildTransmissionLayout - inspection zone', () => {
  it('exposes a positive inspection zone radius around the target', () => {
    const layout = buildTransmissionLayout();
    expect(layout.inspectionZoneRadius).toBeGreaterThan(0);
    expect(layout.inspectionZoneRadius).toBe(3.5);
  });

  it('places at least one obstacle in the scene', () => {
    const layout = buildTransmissionLayout();
    expect(layout.obstacles.length).toBeGreaterThanOrEqual(1);
    expect(layout.obstacles[0].radius).toBeGreaterThan(0);
  });
});

describe('createSaggingWire - catenary-like sag', () => {
  it('pinns both ends to the attachment points (no sag at the ends)', () => {
    const start = { x: -9, y: 11, z: 4 };
    const end = { x: 11, y: 11, z: 3 };
    const samples = createSaggingWire(start, end, 2.4, 28);

    expect(samples[0]).toEqual(start);
    expect(samples[samples.length - 1]).toEqual(end);
  });

  it('dips the midpoint by approximately the full sag below the straight line', () => {
    const start = { x: 0, y: 10, z: 0 };
    const end = { x: 10, y: 10, z: 0 };
    const sag = 2.4;
    const samples = createSaggingWire(start, end, sag, 28);

    const midpoint = samples[Math.floor(samples.length / 2)];
    // Straight-line midpoint would be y = 10; the conductor drops by ~sag.
    expect(10 - midpoint.y).toBeCloseTo(sag, 5);
    expect(midpoint.x).toBeCloseTo(5, 5);
  });

  it('stays within the sag envelope along the whole span', () => {
    const start = { x: 0, y: 10, z: 0 };
    const end = { x: 10, y: 10, z: 0 };
    const sag = 2.4;
    const samples = createSaggingWire(start, end, sag, 64);

    for (const point of samples) {
      const dip = 10 - point.y;
      expect(dip).toBeGreaterThanOrEqual(-1e-9);
      expect(dip).toBeLessThanOrEqual(sag + 1e-9);
    }
  });
});

describe('distance primitives', () => {
  it('distance computes the 3D euclidean norm', () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5, 10);
  });

  it('pointToSegmentDistance is zero on the segment and perpendicular off it', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 10, y: 0, z: 0 };
    // Point exactly on the segment.
    expect(pointToSegmentDistance({ x: 4, y: 0, z: 0 }, a, b)).toBeCloseTo(0, 10);
    // Perpendicular point: closest is (5,0,0) -> distance 3.
    expect(pointToSegmentDistance({ x: 5, y: 3, z: 0 }, a, b)).toBeCloseTo(3, 10);
    // Beyond the end: closest is (10,0,0) -> distance 2.
    expect(pointToSegmentDistance({ x: 12, y: 0, z: 0 }, a, b)).toBeCloseTo(2, 10);
  });

  it('pointToPolylineDistance finds the nearest span', () => {
    const points = [
      { x: 0, y: 10, z: 0 },
      { x: 5, y: 10, z: 0 },
      { x: 10, y: 10, z: 0 },
    ];
    // Point below the middle vertex -> distance 4 to the (5,10,0) vertex.
    expect(pointToPolylineDistance({ x: 5, y: 6, z: 0 }, points)).toBeCloseTo(4, 10);
    // Point far away -> large but finite.
    expect(pointToPolylineDistance({ x: 5, y: 6, z: 0 }, points)).toBeLessThan(10);
  });

  it('pointToPolylineDistance handles degenerate inputs', () => {
    expect(pointToPolylineDistance({ x: 0, y: 0, z: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
    expect(pointToPolylineDistance({ x: 0, y: 0, z: 0 }, [{ x: 1, y: 0, z: 0 }])).toBeCloseTo(1, 10);
  });
});
