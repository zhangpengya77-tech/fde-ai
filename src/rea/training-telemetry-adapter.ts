import type { TrainingEvidenceSample } from './training-evidence';

export interface ReadOnlyTelemetryBinding {
  sessionId: string;
  simulationInstanceId: string;
  systemId: number;
  componentId: number;
}

export interface ReadOnlyObservation extends ReadOnlyTelemetryBinding {
  /** Browser-local monotonic observation sequence, not a Gateway sample ID. */
  sampleId: number;
  sourceTimestamp: number;
  receivedTimestamp: number;
  positionEnu: [number, number, number];
  attitudeDeg: { roll: number; pitch: number; yaw: number };
  mode: string;
  armed: boolean;
}

export type ReadOnlyLinkStatus = 'live' | 'stale' | 'disconnected' | 'pending';
export type AdapterRejectReason = 'IDENTITY_MISMATCH' | 'LINK_STALE' | 'LINK_DISCONNECTED' | 'LINK_PENDING' | 'OBSERVATION_STALE' | 'LOCAL_SEQUENCE_NOT_MONOTONIC' | 'INVALID_TELEMETRY';
export type AdapterResult =
  | { accepted: true; sample: Omit<TrainingEvidenceSample, 'taskId' | 'scoringRuleVersion'> }
  | { accepted: false; reason: AdapterRejectReason };

/**
 * Converts only already-authorized, attach-mode telemetry into client-derived
 * training evidence. It deliberately does not mint a Gateway sample ID or
 * provide a command surface.
 */
export class TrainingTelemetryAdapter {
  private lastSequence = 0;

  constructor(private readonly binding: ReadOnlyTelemetryBinding, private readonly freshnessMs: number) {}

  accept(observation: ReadOnlyObservation, link: ReadOnlyLinkStatus, nowMs: number): AdapterResult {
    if (link === 'disconnected') return { accepted: false, reason: 'LINK_DISCONNECTED' };
    if (link === 'stale') return { accepted: false, reason: 'LINK_STALE' };
    if (link !== 'live') return { accepted: false, reason: 'LINK_PENDING' };
    if (!this.matchesBinding(observation)) return { accepted: false, reason: 'IDENTITY_MISMATCH' };
    if (!this.isFiniteObservation(observation)) return { accepted: false, reason: 'INVALID_TELEMETRY' };
    if (nowMs - observation.receivedTimestamp > this.freshnessMs) return { accepted: false, reason: 'OBSERVATION_STALE' };
    if (observation.sampleId <= this.lastSequence) return { accepted: false, reason: 'LOCAL_SEQUENCE_NOT_MONOTONIC' };

    this.lastSequence = observation.sampleId;
    const [x, y, altitudeM] = observation.positionEnu;
    return {
      accepted: true,
      sample: {
        sessionId: observation.sessionId,
        simulationInstanceId: observation.simulationInstanceId,
        systemId: observation.systemId,
        componentId: observation.componentId,
        source: 'SITL_GATEWAY',
        sampleId: observation.sampleId,
        localSequence: observation.sampleId,
        gatewaySampleId: undefined,
        timestampMs: observation.sourceTimestamp,
        sourceTimestampMs: observation.sourceTimestamp,
        receivedAtMs: observation.receivedTimestamp,
        position: { x, y, altitudeM },
        attitudeDeg: { ...observation.attitudeDeg },
        missionState: observation.mode,
        safetyEvents: [],
        validity: 'VALID',
      },
    };
  }

  reset(): void { this.lastSequence = 0; }

  private matchesBinding(sample: ReadOnlyObservation): boolean {
    return sample.sessionId === this.binding.sessionId
      && sample.simulationInstanceId === this.binding.simulationInstanceId
      && sample.systemId === this.binding.systemId
      && sample.componentId === this.binding.componentId;
  }

  private isFiniteObservation(sample: ReadOnlyObservation): boolean {
    return Number.isInteger(sample.sampleId) && sample.sampleId > 0
      && Number.isFinite(sample.sourceTimestamp) && Number.isFinite(sample.receivedTimestamp)
      && sample.positionEnu.every(Number.isFinite)
      && Number.isFinite(sample.attitudeDeg.roll) && Number.isFinite(sample.attitudeDeg.pitch) && Number.isFinite(sample.attitudeDeg.yaw);
  }
}
