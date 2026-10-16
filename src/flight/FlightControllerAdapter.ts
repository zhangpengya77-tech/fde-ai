import type { FlightSnapshot, OperationResult, PilotCommand, Vector3Like } from './types';

export interface FlightControllerAdapter {
  arm(): OperationResult;
  disarm(): OperationResult;
  takeoff(altitudeM: number): OperationResult;
  land(): OperationResult;
  goto(position: Vector3Like): OperationResult;
  setSpeed(speedMps: number): OperationResult;
  setAltitude(altitudeM: number): OperationResult;
  setYaw(yawDeg: number): OperationResult;
  rtl(): OperationResult;
  pause(): OperationResult;
  resume(): OperationResult;
  emergencyStop(): OperationResult;
  update(command: PilotCommand, deltaSeconds: number): FlightSnapshot;
  snapshot(): FlightSnapshot;
}
