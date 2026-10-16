import type { InspectionDefectType } from '../inspection/types';
import type { InspectionAIAdapter } from './InspectionAIAdapter';
import type { InspectionAIInput, InspectionAIResult } from '../inspection/types';

export interface MockAIConfig {
  /** The single teaching target this scene teaches. */
  targetId: string;
  /** The one defect that is planted at that target. */
  defectType: InspectionDefectType;
  /** Nominal inspection distance (m) used to shape the stable confidence. */
  idealDistanceM: number;
  /** Gimbal aim tolerance (deg) used to shape the stable confidence. */
  maxAngleErrorDeg: number;
}

const DEFAULT_CONFIG: MockAIConfig = {
  targetId: 'INS-T1-RIGHT',
  defectType: 'MISSING_INSULATOR_DISC',
  idealDistanceM: 2.4,
  maxAngleErrorDeg: 15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Deterministic simulated inspection AI.
 *
 * It is NOT a YOLO model and loads no `.pt`. It returns a *stable* result for
 * the scene's planted teaching defect, with a confidence derived purely from
 * the (deterministic) capture geometry - never Math.random - so the same scene
 * and the same input always yield the same detection.
 */
export class MockInspectionAI implements InspectionAIAdapter {
  constructor(private readonly config: MockAIConfig = DEFAULT_CONFIG) {}

  async inspect(input: InspectionAIInput): Promise<InspectionAIResult> {
    const matchesTarget =
      input.targetId === this.config.targetId && input.defectType === this.config.defectType;

    if (!matchesTarget) {
      return { defectDetected: false, defectType: null, confidence: 0, source: 'mock' };
    }

    const confidence = this.deterministicConfidence(input);
    return {
      defectDetected: true,
      defectType: this.config.defectType,
      confidence,
      source: 'mock',
    };
  }

  private deterministicConfidence(input: InspectionAIInput): number {
    const distancePenalty = Math.min(
      0.15,
      (Math.abs(input.distanceToTarget - this.config.idealDistanceM) / this.config.idealDistanceM) * 0.1,
    );
    const anglePenalty = Math.min(0.1, (input.angleErrorDeg / this.config.maxAngleErrorDeg) * 0.08);
    const coverageBonus = Math.min(0.04, input.coverageRatio * 0.08);
    return clamp(0.92 - distancePenalty - anglePenalty + coverageBonus, 0.5, 0.99);
  }
}
