import type { FlightState } from '../flight/types';
import type { SafetyState, Vec3 } from '../inspection/types';

/** The ordered teaching states for one inspection mission. */
export type MissionState =
  | 'IDLE'
  | 'READY'
  | 'TAKEOFF'
  | 'FLY_TO_TARGET'
  | 'POSITION_FOR_INSPECTION'
  | 'AIM_CAMERA'
  | 'CAPTURE'
  | 'VALIDATE_PHOTO'
  | 'AI_INSPECTION'
  | 'INSPECTION_COMPLETE'
  | 'RETURN'
  | 'LAND'
  | 'COMPLETE'
  | 'FAILED';

/** Chinese labels for every state (used directly by the UI). */
export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  IDLE: '待开始',
  READY: '准备',
  TAKEOFF: '起飞',
  FLY_TO_TARGET: '前往巡检点',
  POSITION_FOR_INSPECTION: '进入巡检位置',
  AIM_CAMERA: '调整云台',
  CAPTURE: '拍摄',
  VALIDATE_PHOTO: '照片检查',
  AI_INSPECTION: 'AI 缺陷检查',
  INSPECTION_COMPLETE: '巡检完成',
  RETURN: '返航',
  LAND: '降落',
  COMPLETE: '任务完成',
  FAILED: '任务失败',
};

/**
 * The display order used for the "step X / N" progress readout. IDLE (not
 * started) and FAILED (terminal) are excluded from the total.
 */
export const MISSION_STEP_ORDER: MissionState[] = [
  'READY',
  'TAKEOFF',
  'FLY_TO_TARGET',
  'POSITION_FOR_INSPECTION',
  'AIM_CAMERA',
  'CAPTURE',
  'VALIDATE_PHOTO',
  'AI_INSPECTION',
  'INSPECTION_COMPLETE',
  'RETURN',
  'LAND',
  'COMPLETE',
];

/** One-line teaching instruction for the current step. */
export const MISSION_STEP_HINT: Record<MissionState, string> = {
  IDLE: '任务待开始。',
  READY: '请解锁飞行器准备起飞。',
  TAKEOFF: '正在起飞，保持悬停姿态。',
  FLY_TO_TARGET: '请飞向输电塔右侧的绝缘子串巡检点。',
  POSITION_FOR_INSPECTION: '请进入巡检拍摄区并保持安全距离。',
  AIM_CAMERA: '请调整云台使绝缘子串进入画面并居中。',
  CAPTURE: '正在拍摄巡检照片。',
  VALIDATE_PHOTO: '正在检查照片质量。',
  AI_INSPECTION: '正在执行缺陷检测。',
  INSPECTION_COMPLETE: '巡检完成，请安全离开设备并返航。',
  RETURN: '正在返航至返航基准点。',
  LAND: '正在降落。',
  COMPLETE: '任务完成，感谢训练。',
  FAILED: '任务失败，请降落并重新开始。',
};

/** Real telemetry fed to the engine every frame. */
export interface MissionTelemetry {
  flightState: FlightState;
  altitude: number;
  position: Vec3;
  homePoint: Vec3;
  insideInspectionZone: boolean;
  safetyState: SafetyState;
  distanceToTarget: number;
  distanceToHome: number;
  /** True when the gimbal aim is within the aim tolerance of the target. */
  gimbalAimed: boolean;
}

export interface MissionConfig {
  /** Altitude (m) above which the takeoff step is considered complete. */
  takeoffAltitudeM: number;
  /** Gimbal aim tolerance (deg) before capture is allowed. */
  aimToleranceDeg: number;
  /** Distance to Home Point (m) that counts as "arrived" for Return. */
  homeArriveRadiusM: number;
}

export const DEFAULT_MISSION_CONFIG: MissionConfig = {
  takeoffAltitudeM: 2.5,
  aimToleranceDeg: 12,
  homeArriveRadiusM: 1.5,
};

export interface CapturePermission {
  ok: boolean;
  reason?: string;
}

export interface MissionStepInfo {
  state: MissionState;
  label: string;
  hint: string;
  /** "x / n" progress string; empty while terminal/not started. */
  progress: string;
}
