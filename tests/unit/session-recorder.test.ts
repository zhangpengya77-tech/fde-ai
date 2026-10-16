import { describe, expect, it } from 'vitest';
import { SessionRecorder } from '../../src/scoring/SessionRecorder';
import { MISSION_STEP_ORDER } from '../../src/mission/types';
import type { FlightState } from '../../src/flight/types';
import type { SafetyState } from '../../src/inspection/types';

/**
 * The recorder turns live app telemetry into the ScoreSession the pure
 * ScoringEngine consumes. It is deterministic: every value comes from the
 * samples the app actually feeds it.
 */

interface SampleInput {
  position: { x: number; y: number; z: number };
  safetyState: SafetyState;
  insideInspectionZone?: boolean;
  flightState?: FlightState;
  horizontalSpeedMps?: number;
  command?: { roll?: number; pitch?: number; yaw?: number; throttle?: number };
}

function sample(recorder: SessionRecorder, now: number, input: SampleInput): void {
  recorder.sample({
    position: input.position,
    safetyState: input.safetyState,
    insideInspectionZone: input.insideInspectionZone ?? false,
    flightState: input.flightState ?? 'flying',
    horizontalSpeedMps: input.horizontalSpeedMps ?? 0,
    command: {
      roll: input.command?.roll ?? 0,
      pitch: input.command?.pitch ?? 0,
      yaw: input.command?.yaw ?? 0,
      throttle: input.command?.throttle ?? 0,
    },
    now,
  });
}

describe('SessionRecorder', () => {
  it('starts empty', () => {
    const recorder = new SessionRecorder();
    const session = recorder.session();
    expect(session.pathLengthM).toBe(0);
    expect(session.hazardEpisodes).toEqual([]);
    expect(session.captureAttempts).toEqual([]);
    expect(session.missionBestStepIndex).toBe(0);
    expect(session.reachedInspectionComplete).toBe(false);
    expect(session.durationMs).toBe(0);
  });

  it('accumulates path length from real movement', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 0, z: 0 }, safetyState: 'SAFE', flightState: 'disarmed' });
    sample(recorder, 100, { position: { x: 0, y: 3, z: 0 }, safetyState: 'SAFE' });
    sample(recorder, 200, { position: { x: 0, y: 3, z: 5 }, safetyState: 'SAFE' });
    expect(recorder.session().pathLengthM).toBeCloseTo(8, 5);
  });

  it('excludes teleports (test-harness jumps) from the flown path', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 0, z: 0 }, safetyState: 'SAFE' });
    recorder.noteTeleport();
    sample(recorder, 100, { position: { x: 20, y: 8, z: 0 }, safetyState: 'SAFE' });
    sample(recorder, 200, { position: { x: 20, y: 8, z: 2 }, safetyState: 'SAFE' });
    expect(recorder.session().pathLengthM).toBeCloseTo(2, 5);
  });

  it('tracks the highest altitude and zone entry', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 2, z: 0 }, safetyState: 'SAFE' });
    sample(recorder, 100, { position: { x: 0, y: 7, z: 0 }, safetyState: 'SAFE' });
    sample(recorder, 200, { position: { x: 0, y: 4, z: 0 }, safetyState: 'SAFE', insideInspectionZone: true });
    sample(recorder, 300, { position: { x: 0, y: 4, z: 0 }, safetyState: 'SAFE', insideInspectionZone: false });
    const session = recorder.session();
    expect(session.maxAltitudeM).toBe(7);
    expect(session.enteredInspectionZone).toBe(true);
  });

  it('groups hazard time into episodes with durations', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 5, z: 0 }, safetyState: 'WARNING' });
    sample(recorder, 1000, { position: { x: 0, y: 5, z: 0 }, safetyState: 'WARNING' });
    sample(recorder, 1500, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE' });
    sample(recorder, 2000, { position: { x: 0, y: 5, z: 0 }, safetyState: 'DANGER' });
    sample(recorder, 4000, { position: { x: 0, y: 5, z: 0 }, safetyState: 'DANGER' });
    const episodes = recorder.session().hazardEpisodes;
    expect(episodes).toEqual([
      { state: 'WARNING', durationMs: 1000 },
      { state: 'DANGER', durationMs: 2000 },
    ]);
  });

  it('closes a still-open hazard episode when the session ends', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 5, z: 0 }, safetyState: 'COLLISION' });
    sample(recorder, 500, { position: { x: 0, y: 5, z: 0 }, safetyState: 'COLLISION' });
    const episodes = recorder.session().hazardEpisodes;
    expect(episodes).toEqual([{ state: 'COLLISION', durationMs: 500 }]);
  });

  it('merges consecutive samples of the same hazard into one episode', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 5, z: 0 }, safetyState: 'WARNING' });
    sample(recorder, 500, { position: { x: 0, y: 5, z: 0 }, safetyState: 'WARNING' });
    sample(recorder, 900, { position: { x: 0, y: 5, z: 0 }, safetyState: 'WARNING' });
    expect(recorder.session().hazardEpisodes).toHaveLength(1);
  });

  it('observes mission progress, completion and failure (sticky)', () => {
    const recorder = new SessionRecorder();
    const steps = ['IDLE', 'READY', 'TAKEOFF', 'FLY_TO_TARGET', 'POSITION_FOR_INSPECTION', 'AIM_CAMERA'] as const;
    steps.forEach((state, index) => recorder.observeMission(state, index * 100));
    let session = recorder.session();
    expect(session.missionBestStepIndex).toBe(MISSION_STEP_ORDER.indexOf('AIM_CAMERA'));
    expect(session.missionFinalState).toBe('AIM_CAMERA');
    expect(session.reachedInspectionComplete).toBe(false);
    expect(session.missionFailed).toBe(false);

    recorder.observeMission('INSPECTION_COMPLETE', 600);
    session = recorder.session();
    expect(session.reachedInspectionComplete).toBe(true);

    recorder.observeMission('FAILED', 700);
    session = recorder.session();
    expect(session.missionFailed).toBe(true);
    // best step stays at the furthest point reached
    expect(session.missionBestStepIndex).toBe(MISSION_STEP_ORDER.indexOf('INSPECTION_COMPLETE'));
  });

  it('counts one full-stick episode per continuous hold', () => {
    const recorder = new SessionRecorder();
    for (let now = 0; now < 600; now += 100) {
      sample(recorder, now, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', command: { roll: 1 } });
    }
    expect(recorder.session().fullStickCount).toBe(1);

    // release, then engage again => a second episode
    sample(recorder, 600, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', command: { roll: 0 } });
    sample(recorder, 700, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', command: { roll: -1 } });
    expect(recorder.session().fullStickCount).toBe(2);
  });

  it('filters reversal noise with a cooldown', () => {
    const recorder = new SessionRecorder();
    // Fast flapping inside the cooldown window counts once.
    let now = 0;
    for (const value of [1, -1, 1, -1, 1, -1]) {
      sample(recorder, now, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', command: { roll: value } });
      now += 20;
    }
    expect(recorder.session().inputReversalCount).toBe(1);

    // Flips spaced beyond the cooldown each count.
    for (const value of [1, -1]) {
      sample(recorder, now, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', command: { roll: value } });
      now += 400;
    }
    expect(recorder.session().inputReversalCount).toBeGreaterThanOrEqual(2);
  });

  it('averages stick deviation while hovering only', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', horizontalSpeedMps: 0, command: { roll: 0.2, pitch: 0.1, yaw: 0 } });
    sample(recorder, 100, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', horizontalSpeedMps: 0, command: { roll: 0.1, pitch: 0.2, yaw: 0 } });
    // Moving fast: not a hover sample, ignored by the deviation average.
    sample(recorder, 200, { position: { x: 0, y: 5, z: 0 }, safetyState: 'SAFE', horizontalSpeedMps: 6, command: { roll: 1, pitch: 1, yaw: 1 } });
    const session = recorder.session();
    expect(session.hoverSampleCount).toBe(2);
    // mean(|roll|+|pitch|+|yaw|)/3 = ((0.2+0.1+0) + (0.1+0.2+0)) / 2 / 3 = 0.1
    expect(session.hoverInputDeviation).toBeCloseTo(0.1, 5);
  });

  it('measures duration from the first non-disarmed sample', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 0, z: 0 }, safetyState: 'SAFE', flightState: 'disarmed' });
    sample(recorder, 1000, { position: { x: 0, y: 0, z: 0 }, safetyState: 'SAFE', flightState: 'armed' });
    sample(recorder, 4000, { position: { x: 0, y: 3, z: 0 }, safetyState: 'SAFE' });
    expect(recorder.session().durationMs).toBe(3000);
  });

  it('indexes capture attempts in order and copies their real validation', () => {
    const recorder = new SessionRecorder();
    const attempt = (valid: boolean) =>
      ({
        id: `cap-${valid}`,
        photoValidation: { valid, reasons: valid ? [] : ['云台方向偏差过大'] },
        safetyState: 'WARNING',
      }) as unknown as Parameters<SessionRecorder['recordCapture']>[0];
    recorder.recordCapture(attempt(false));
    recorder.recordCapture(attempt(true));
    const attempts = recorder.session().captureAttempts;
    expect(attempts.map((entry) => entry.index)).toEqual([1, 2]);
    expect(attempts[0].photoValidation.valid).toBe(false);
    expect(attempts[0].photoValidation.reasons).toEqual(['云台方向偏差过大']);
    expect(attempts[1].photoValidation.valid).toBe(true);
  });

  it('reset() clears everything for a new run', () => {
    const recorder = new SessionRecorder();
    sample(recorder, 0, { position: { x: 0, y: 5, z: 0 }, safetyState: 'DANGER' });
    recorder.observeMission('AIM_CAMERA', 100);
    recorder.reset('mission-2');
    const session = recorder.session();
    expect(session.missionId).toBe('mission-2');
    expect(session.pathLengthM).toBe(0);
    expect(session.hazardEpisodes).toEqual([]);
    expect(session.missionBestStepIndex).toBe(0);
    expect(session.durationMs).toBe(0);
  });
});
