import type { InspectionDefectType, Vec3 } from '../inspection/types';

/**
 * Pure, render-agnostic scene definition for the first transmission-line
 * inspection lesson. This module owns the *coordinates* and the *math* (sagging
 * wire, distance helpers) but never touches Three.js, so the safety engine and
 * the unit tests can consume it in plain Node.
 */

export interface TowerSpec {
  id: string;
  /** Base (ground) anchor of the tower column. */
  base: Vec3;
  /** Top anchor of the tower column. */
  top: Vec3;
  height: number;
}

export interface WireSpec {
  id: string;
  /** Attachment point on the first tower (cross-arm). */
  from: Vec3;
  /** Attachment point on the second tower (cross-arm). */
  to: Vec3;
  /** Maximum vertical dip at the span midpoint, in metres. */
  sag: number;
}

export interface TargetSpec {
  id: string;
  /** The point the pilot must approach to inspect. */
  position: Vec3;
  defectType: InspectionDefectType;
  label: string;
}

export interface ObstacleSpec {
  id: string;
  /** Centroid of the obstacle volume. */
  position: Vec3;
  /** Effective clearance radius used for the safety evaluation. */
  radius: number;
}

export interface TransmissionLayout {
  towers: TowerSpec[];
  wires: WireSpec[];
  target: TargetSpec;
  obstacles: ObstacleSpec[];
  /** Radius of the inspection zone around the target. */
  inspectionZoneRadius: number;
  /** Resolved, sampled poly-lines for every wire (used by distance math + render). */
  wireSamples: Vec3[][];
}

export const TOWER_HEIGHT = 12;

export const TOWER_1_BASE: Vec3 = { x: -9, y: 0, z: 4 };
export const TOWER_2_BASE: Vec3 = { x: 11, y: 0, z: 3 };

/** Cross-arm attachment height (just below the tower top). */
export const CROSS_ARM_Y = 11;

/**
 * Builds a sagging conductor between two attachment points.
 *
 * The span follows a parabola: the midpoint dips by exactly `sag` metres below
 * the straight line, because `4 * t * (1 - t)` is 1 at t = 0.5 and 0 at the
 * ends. This is the same curve the 3D tube and the distance engine both sample,
 * so what you see is what the safety layer measures.
 */
export function createSaggingWire(start: Vec3, end: Vec3, sag: number, segments = 28): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const dip = sag * 4 * t * (1 - t);
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t - dip,
      z: start.z + (end.z - start.z) * t,
    });
  }
  return points;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Shortest distance from a point to a line segment [a, b]. */
export function pointToSegmentDistance(point: Vec3, a: Vec3, b: Vec3): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const abZ = b.z - a.z;
  const lenSquared = abX * abX + abY * abY + abZ * abZ;
  const t =
    lenSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY + (point.z - a.z) * abZ) / lenSquared));
  const closestX = a.x + abX * t;
  const closestY = a.y + abY * t;
  const closestZ = a.z + abZ * t;
  return Math.hypot(point.x - closestX, point.y - closestY, point.z - closestZ);
}

/** Shortest distance from a point to a poly-line (sequence of connected segments). */
export function pointToPolylineDistance(point: Vec3, points: Vec3[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return distance(point, points[0]);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentDistance = pointToSegmentDistance(point, points[index], points[index + 1]);
    if (segmentDistance < minimum) minimum = segmentDistance;
  }
  return minimum;
}

/**
 * The first transmission-line lesson: two towers, two sagging conductors, one
 * inspection target (missing insulator disc on the right insulator string of
 * tower 1) and one obstacle. Coordinates are in metres and share the same frame
 * as the flight controller's `FlightSnapshot.position`.
 */
export function buildTransmissionLayout(): TransmissionLayout {
  const towers: TowerSpec[] = [
    {
      id: 'T1',
      base: { ...TOWER_1_BASE },
      top: { x: TOWER_1_BASE.x, y: TOWER_HEIGHT, z: TOWER_1_BASE.z },
      height: TOWER_HEIGHT,
    },
    {
      id: 'T2',
      base: { ...TOWER_2_BASE },
      top: { x: TOWER_2_BASE.x, y: TOWER_HEIGHT, z: TOWER_2_BASE.z },
      height: TOWER_HEIGHT,
    },
  ];

  const attach1: Vec3 = { x: TOWER_1_BASE.x, y: CROSS_ARM_Y, z: TOWER_1_BASE.z };
  const attach2: Vec3 = { x: TOWER_2_BASE.x, y: CROSS_ARM_Y, z: TOWER_2_BASE.z };
  const wires: WireSpec[] = [
    { id: 'W1', from: { ...attach1 }, to: { ...attach2 }, sag: 2.4 },
    { id: 'W2', from: { x: attach1.x, y: CROSS_ARM_Y - 0.7, z: attach1.z + 0.7 }, to: { x: attach2.x, y: CROSS_ARM_Y - 0.7, z: attach2.z + 0.7 }, sag: 2.4 },
  ];

  // Inspector string hangs off the right side of tower 1 (local +x), mid height.
  const target: TargetSpec = {
    id: 'INS-T1-RIGHT',
    position: { x: TOWER_1_BASE.x + 1.6, y: 8, z: TOWER_1_BASE.z },
    defectType: 'MISSING_INSULATOR_DISC',
    label: '輸電塔右側絕緣子串（缺片）',
  };

  const obstacles: ObstacleSpec[] = [{ id: 'OBS-TREE', position: { x: 2, y: 0, z: -7 }, radius: 1.4 }];

  const wireSamples = wires.map((wire) => createSaggingWire(wire.from, wire.to, wire.sag, 28));

  return {
    towers,
    wires,
    target,
    obstacles,
    inspectionZoneRadius: 3.5,
    wireSamples,
  };
}
