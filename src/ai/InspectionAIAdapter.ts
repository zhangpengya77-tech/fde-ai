import type { InspectionAIInput, InspectionAIResult } from '../inspection/types';

/**
 * Replaceable inspection AI contract. Phase 1 ships a deterministic mock; a
 * future real model (e.g. a YOLO `.pt`) implements this same interface so the
 * mission loop does not change.
 */
export interface InspectionAIAdapter {
  inspect(input: InspectionAIInput): Promise<InspectionAIResult>;
}
