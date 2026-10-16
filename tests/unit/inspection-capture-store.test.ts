import { describe, expect, it } from 'vitest';

import { createMemoryKeyValueStore } from '../../src/ui/profile-store';
import { createInspectionCaptureStore } from '../../src/persistence/inspection-capture-store';
import type { InspectionAIResult, InspectionCaptureRecord, PhotoValidationResult } from '../../src/inspection/types';

const photo: PhotoValidationResult = {
  targetVisible: true,
  coverageRatio: 0.4,
  distanceToTarget: 2.4,
  angleErrorDeg: 3,
  insideInspectionZone: true,
  safetyState: 'WARNING',
  valid: true,
  reasons: [],
};

const ai: InspectionAIResult = {
  defectDetected: true,
  defectType: 'MISSING_INSULATOR_DISC',
  confidence: 0.93,
  source: 'mock',
};

function record(id: string): InspectionCaptureRecord {
  return {
    id,
    missionId: 'mission-1',
    timestamp: 1_700_000_000_000,
    targetId: 'INS-T1-RIGHT',
    aircraftPosition: { x: -5.4, y: 8, z: 4 },
    altitude: 8,
    attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 30 },
    gimbalPitchDeg: -2,
    gimbalYawDeg: 4,
    distanceToTarget: photo.distanceToTarget,
    distanceToWire: 6,
    distanceToTower: 3.6,
    safetyState: photo.safetyState,
    photoValidation: photo,
    aiResult: ai,
    photoDataUrl: 'data:image/png;base64,AAAA',
  };
}

describe('InspectionCaptureStore', () => {
  it('saves and lists capture records round-trip', async () => {
    const store = createInspectionCaptureStore(createMemoryKeyValueStore());
    await store.save(record('cap-1'));
    await store.save(record('cap-2'));

    const list = await store.list();
    expect(list).toHaveLength(2);
    const ids = list.map((r) => r.id).sort();
    expect(ids).toEqual(['cap-1', 'cap-2']);

    const first = list.find((r) => r.id === 'cap-1')!;
    expect(first.photoValidation.valid).toBe(true);
    expect(first.aiResult?.defectType).toBe('MISSING_INSULATOR_DISC');
    expect(first.aircraftPosition).toEqual({ x: -5.4, y: 8, z: 4 });
    expect(first.photoDataUrl).toMatch(/^data:image\/png/);
  });
});
