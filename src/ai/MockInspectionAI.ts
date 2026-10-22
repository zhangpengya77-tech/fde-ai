import type { InspectionDefectType } from '../inspection/types';
import type { InspectionAIAdapter } from './InspectionAIAdapter';
import type { InspectionAIInput, InspectionAIResult } from '../inspection/types';

export interface MockAIConfig {
  /** The single teaching target this scene teaches. */
  targetId: string;
  /**
   * The defect this simulation scripts for that target.
   *
   * Optional on purpose: the app never passes the scene's planted defect here,
   * so the answer cannot reach the detector even through construction. When
   * omitted, the mock falls back to its own built-in teaching script
   * (`SCRIPTED_DEFECT`), which is the mock's declared limitation - not a
   * vision capability.
   */
  defectType?: InspectionDefectType;
  /** Nominal inspection distance (m) used to shape the stable confidence. */
  idealDistanceM: number;
  /** Gimbal aim tolerance (deg) used to shape the stable confidence. */
  maxAngleErrorDeg: number;
}

/**
 * The one defect this mock can ever report. It is the mock's own script, not a
 * value read from the scene or the request.
 */
const SCRIPTED_DEFECT: InspectionDefectType = 'MISSING_INSULATOR_DISC';

const DEFAULT_CONFIG: MockAIConfig = {
  targetId: 'INS-T1-RIGHT',
  defectType: SCRIPTED_DEFECT,
  idealDistanceM: 2.4,
  maxAngleErrorDeg: 15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Deterministic simulated inspection AI.
 *
 * It is NOT a YOLO model and loads no `.pt`. It performs **no image analysis**:
 * its verdict comes from its own scenario script (`config.defectType`) for the
 * one target it was configured with, and it always labels itself
 * `source: 'mock'`. This is a declared simulation boundary, not a claim of
 * vision capability.
 *
 * Confidence is derived purely from the (deterministic) capture geometry -
 * never Math.random - so the same scene and the same input always yield the
 * same detection.
 *
 * A missing image is reported as `unavailable`, never as "no defect".
 */
export class MockInspectionAI implements InspectionAIAdapter {
  constructor(private readonly config: MockAIConfig = DEFAULT_CONFIG) {}

  async inspect(input: InspectionAIInput): Promise<InspectionAIResult> {
    // No evidence -> no verdict. Returning `defectDetected: false` here would
    // silently turn a missing frame into "the equipment is fine".
    if (!input.image || input.image.dataUrl.trim().length === 0) {
      return {
        defectDetected: false,
        defectType: null,
        confidence: 0,
        source: 'unavailable',
        reason: '圖像缺失：未取得可供判定的巡檢照片',
      };
    }

    // The request carries no answer, so the only thing left to match is which
    // target was photographed. Anything outside this mock's script is "clear"
    // as a simulation, still labelled `mock`.
    if (input.targetId !== this.config.targetId) {
      return { defectDetected: false, defectType: null, confidence: 0, source: 'mock', reason: null };
    }

    return {
      defectDetected: true,
      defectType: this.config.defectType ?? SCRIPTED_DEFECT,
      confidence: this.deterministicConfidence(input),
      source: 'mock',
      reason: null,
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
