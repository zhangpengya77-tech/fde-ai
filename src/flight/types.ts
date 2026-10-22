export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface OperationResult {
  ok: boolean;
  message: string;
}

export type FlightMode = 'manual' | 'hover' | 'mission';

export type FlightState =
  | 'disarmed'
  | 'armed'
  | 'taking-off'
  | 'flying'
  | 'landing'
  | 'paused'
  | 'emergency';

export interface PilotCommand {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  arm: boolean;
  flightMode: FlightMode;
  gimbalYaw: number;
  gimbalPitch: number;
}

export interface FlightSnapshot {
  state: FlightState;
  mode: FlightMode;
  position: Vector3Like;
  homePoint: Vector3Like;
  /** Current velocity (m/s); world axes, `y` is altitude. */
  velocity: Vector3Like;
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  altitudeM: number;
  horizontalSpeedMps: number;
  verticalSpeedMps: number;
  headingDeg: number;
}
