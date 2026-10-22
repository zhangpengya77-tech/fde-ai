/**
 * CAA 專業基本級術科考場模擬 — 型別定義。
 *
 * 定位：練習／評量工具。畫面與成績單固定顯示「模擬判定，非官方測驗結果」，
 * 頂層標示「非官方測驗，僅供練習」。官方數值一律來自 config/caa-exam.json
 * （民航通告 AC 107-005D 附錄，附頁碼）；讀不到的留 null 並回報，不估算。
 * 模擬器自設輔助閾值集中在 simAssist（每項標「模擬假設，非官方」）。
 *
 * 本模組為獨立疊加：不改既有巡檢任務、搖桿映射、標定檔、飛控航向旋轉修正。
 */

import type { Vector3Like } from '../flight/types';

/** 考試操作模式（AC 107-005D p3 定義，見 config general.modes）。 */
export type ExamFlightMode = 'manual' | 'attitude' | 'position';

/** 任務模式（地面站自主）不在術科飛行科目範圍，僅在設定檔留定義。 */
export type ExamState = 'idle' | 'armed' | 'flying' | 'landed';

/** 歸一化搖桿指令（與既有 PilotInputPipeline 輸出同範圍）。 */
export interface ExamStickCommand {
  /** 右打為正（右移）。 */
  roll: number;
  /** 前推為正（前進）。 */
  pitch: number;
  /** 右轉為正（航向角增）。 */
  yaw: number;
  /** 0..1，底部休止 0、推到頂 1。 */
  throttle: number;
}

export interface ExamFlightSnapshot {
  state: ExamState;
  mode: ExamFlightMode;
  position: Vector3Like;
  velocity: Vector3Like;
  rollDeg: number;
  pitchDeg: number;
  headingDeg: number;
  altitudeM: number;
  horizontalSpeedMps: number;
  verticalSpeedMps: number;
  /** 本帧作用於機體的風速向量（m/s，世界座標）。 */
  windVector: Vector3Like;
  /** 定位保持是否正在補償風飄（僅 position 模式）。 */
  positionHoldCompensating: boolean;
}

/** 考試機參數（config/exam-aircraft.json 的執行期取值）。 */
export interface ExamAircraftParams {
  massKg: number;
  maxTiltDeg: number;
  maxHorizontalSpeedMps: number;
  accelerationMps2: number;
  dragCoefficient: number;
  horizontalVelocityTimeConstantS: number;
  attitudeTimeConstantS: number;
  attitudeRateLimitDegPerS: number;
}

/** 風場狀態。 */
export interface WindState {
  /** 平均風向量（m/s）。 */
  mean: Vector3Like;
  /** 陣風向量（m/s，隨時間擾動）。 */
  gust: Vector3Like;
  /** 合成風速大小（m/s）。 */
  speedMps: number;
  /** 平均風速大小（m/s）。 */
  meanSpeedMps: number;
  /** 陣風風速大小（m/s）。 */
  gustSpeedMps: number;
}
