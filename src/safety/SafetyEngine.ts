import type { InspectionGeometryResult, SafetyState, Vec3 } from '../inspection/types';
import {
  distance,
  pointToPolylineDistance,
  pointToSegmentDistance,
  type TransmissionLayout,
} from '../scenes/SceneDefinition';

export interface HazardRadii {
  /** Hard contact distance - a real collision with the structure. */
  collision: number;
  /** Imminent hazard; the pilot must react now. */
  danger: number;
  /** Approaching a hazard; begin planning. */
  warning: number;
}

export interface SafetyConfig {
  tower: HazardRadii;
  wire: HazardRadii;
  target: HazardRadii;
  obstacle: HazardRadii;
}

/**
 * Teaching-tuned defaults (metres). The inspection zone radius lives on the
 * layout; a pilot is expected to hold inside it without ramming the insulators,
 * so the target warning ring (3 m) sits just inside the zone (3.5 m).
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  tower: { collision: 1.5, danger: 4, warning: 8 },
  wire: { collision: 0.8, danger: 2, warning: 4 },
  target: { collision: 0.5, danger: 1.2, warning: 3 },
  obstacle: { collision: 1.0, danger: 2.5, warning: 5 },
};

const STATE_ORDER: SafetyState[] = ['SAFE', 'WARNING', 'DANGER', 'COLLISION'];

function worst(a: SafetyState, b: SafetyState): SafetyState {
  return STATE_ORDER.indexOf(a) >= STATE_ORDER.indexOf(b) ? a : b;
}

function classify(d: number, radii: HazardRadii): SafetyState {
  if (d <= radii.collision) return 'COLLISION';
  if (d <= radii.danger) return 'DANGER';
  if (d <= radii.warning) return 'WARNING';
  return 'SAFE';
}

/**
 * The real-distance safety authority for the inspection lesson.
 *
 * It only ever sees plain `Vec3` positions and the layout's resolved geometry -
 * Three.js is never imported here, so the hazard logic is fully unit-testable
 * and cannot drift from what the trainee sees.
 */
export class SafetyDistanceEngine {
  constructor(
    private readonly layout: TransmissionLayout,
    private readonly config: SafetyConfig = DEFAULT_SAFETY_CONFIG,
  ) {}

  evaluate(position: Vec3): InspectionGeometryResult {
    const distanceToTower = this.layout.towers.reduce(
      (minimum, tower) => Math.min(minimum, pointToSegmentDistance(position, tower.base, tower.top)),
      Number.POSITIVE_INFINITY,
    );

    const distanceToWire = this.layout.wireSamples.reduce(
      (minimum, samples) => Math.min(minimum, pointToPolylineDistance(position, samples)),
      Number.POSITIVE_INFINITY,
    );

    const distanceToTarget = distance(position, this.layout.target.position);

    let state: SafetyState = 'SAFE';
    state = worst(state, classify(distanceToTower, this.config.tower));
    state = worst(state, classify(distanceToWire, this.config.wire));
    state = worst(state, classify(distanceToTarget, this.config.target));
    for (const obstacle of this.layout.obstacles) {
      state = worst(state, classify(distance(position, obstacle.position), this.config.obstacle));
    }

    return {
      distanceToTarget,
      distanceToTower,
      distanceToWire,
      insideInspectionZone: distanceToTarget <= this.layout.inspectionZoneRadius,
      safetyState: state,
    };
  }

  /** Clearance from the aircraft to the nearest obstacle centroid, in metres. */
  nearestObstacleDistance(position: Vec3): number {
    if (this.layout.obstacles.length === 0) return Number.POSITIVE_INFINITY;
    return this.layout.obstacles.reduce(
      (minimum, obstacle) => Math.min(minimum, distance(position, obstacle.position)),
      Number.POSITIVE_INFINITY,
    );
  }
}
