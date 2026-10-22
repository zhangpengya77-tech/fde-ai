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

/** 繁體中文標籤（UI 直接顯示）。 */
export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  IDLE: '待開始',
  READY: '準備',
  TAKEOFF: '起飛',
  FLY_TO_TARGET: '前往巡檢點',
  POSITION_FOR_INSPECTION: '進入巡檢位置',
  AIM_CAMERA: '調整雲台',
  CAPTURE: '拍攝',
  VALIDATE_PHOTO: '照片檢查',
  AI_INSPECTION: 'AI 缺陷檢查',
  INSPECTION_COMPLETE: '巡檢完成',
  RETURN: '返航',
  LAND: '降落',
  COMPLETE: '任務完成',
  FAILED: '任務失敗',
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

/** 當前步驟的一行式教學提示。 */
export const MISSION_STEP_HINT: Record<MissionState, string> = {
  IDLE: '任務待開始。',
  READY: '請解鎖飛行器準備起飛。',
  TAKEOFF: '正在起飛，保持懸停姿態。',
  FLY_TO_TARGET: '請飛向輸電塔右側的絕緣子串巡檢點。',
  POSITION_FOR_INSPECTION: '請進入巡檢拍攝區並保持安全距離。',
  AIM_CAMERA: '請調整雲台使絕緣子串進入畫面並置中。',
  CAPTURE: '正在拍攝巡檢照片。',
  VALIDATE_PHOTO: '正在檢查照片品質。',
  AI_INSPECTION: '正在執行缺陷檢測。',
  INSPECTION_COMPLETE: '巡檢完成，請安全離開設備並返航。',
  RETURN: '正在返航至返航基準點。',
  LAND: '正在降落。',
  COMPLETE: '任務完成，感謝訓練。',
  FAILED: '任務失敗，請降落並重新開始。',
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
