import { describe, expect, it } from 'vitest';
import { TrainingTelemetryAdapter } from '../../src/rea/training-telemetry-adapter';

const binding = { sessionId: 'session-a', simulationInstanceId: 'sim-a', systemId: 251, componentId: 1 };
const observation = (overrides: Partial<{
  sessionId: string; simulationInstanceId: string; systemId: number; componentId: number;
  sampleId: number; sourceTimestamp: number; receivedTimestamp: number; mode: string; armed: boolean;
}> = {}) => ({
  ...binding, sampleId: 1, sourceTimestamp: 1_000, receivedTimestamp: 1_010,
  positionEnu: [2, 3, 4] as [number, number, number],
  attitudeDeg: { roll: 1, pitch: 2, yaw: 3 }, mode: 'AUTO', armed: true,
  ...overrides,
});

describe('TrainingTelemetryAdapter', () => {
  it('maps one bound read-only observation without inventing a Gateway sample ID', () => {
    const adapter = new TrainingTelemetryAdapter(binding, 3_000);
    const result = adapter.accept(observation(), 'live', 1_100);

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.sample).toMatchObject({
      sessionId: 'session-a', simulationInstanceId: 'sim-a', systemId: 251, componentId: 1,
      source: 'SITL_GATEWAY', localSequence: 1, gatewaySampleId: undefined,
      sourceTimestampMs: 1_000, receivedAtMs: 1_010,
      position: { x: 2, y: 3, altitudeM: 4 },
    });
  });

  it('rejects a replayed local observation sequence', () => {
    const adapter = new TrainingTelemetryAdapter(binding, 3_000);
    expect(adapter.accept(observation(), 'live', 1_100).accepted).toBe(true);
    expect(adapter.accept(observation(), 'live', 1_200)).toMatchObject({ accepted: false, reason: 'LOCAL_SEQUENCE_NOT_MONOTONIC' });
  });

  it('rejects mismatched identity, stale and disconnected observations', () => {
    const adapter = new TrainingTelemetryAdapter(binding, 3_000);
    expect(adapter.accept(observation({ sessionId: 'other' }), 'live', 1_100)).toMatchObject({ accepted: false, reason: 'IDENTITY_MISMATCH' });
    expect(adapter.accept(observation(), 'stale', 5_000)).toMatchObject({ accepted: false, reason: 'LINK_STALE' });
    expect(adapter.accept(observation(), 'disconnected', 1_100)).toMatchObject({ accepted: false, reason: 'LINK_DISCONNECTED' });
  });
});
