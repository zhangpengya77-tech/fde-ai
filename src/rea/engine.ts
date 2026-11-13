/**
 * 飛行引擎介面：WEB LITE（瀏覽器簡化物理）與 PHYSICS PRO（ArduPilot SITL）共用。
 * 評分器（CourseRunner）、回放、3D 場景與五種連線方式都只依賴這個介面。
 *
 * 保真度標示（Phase 0 規定）：每個引擎都必須提供 simulator_type、physics_model_version、firmware_version，
 * WEB LITE 不得標示為高精度飛行物理。
 */

import type { Vec2 } from './courses';
import type { Command, DroneState } from './physics';
import type { CourseResult, CourseRunner } from './runner';
import type { Sample, SessionOptions } from './session';

export interface EngineLabels {
  simulator_type: string;
  physics_model_version: string;
  firmware_version: string;
  /** 畫面上顯示的說明文字 */
  display: string;
}

export const WEB_LITE_LABELS: EngineLabels = {
  simulator_type: 'web_lite',
  physics_model_version: 'rea-lite-1',
  firmware_version: 'none',
  display: 'WEB LITE・瀏覽器簡化物理（非高精度）',
};

export interface FlightEngine {
  readonly labels: EngineLabels;
  readonly runner: CourseRunner;
  readonly samples: Sample[];
  readonly opts: SessionOptions;
  state: DroneState;
  t: number;
  lastCmd: Command;
  /** 可以開始飛（WEB LITE 立即為真；PHYSICS PRO 需等 SITL 驗證、解鎖） */
  readonly ready: boolean;
  /** 準備中的狀態說明（給畫面顯示） */
  readonly statusText: string;
  /** 無法使用時的原因；null 代表正常 */
  readonly failed: string | null;
  readonly done: boolean;
  advance(dt: number, pilot: (e: FlightEngine) => Command): void;
  windAt(t: number): Vec2;
  result(): CourseResult;
  dispose(): void;
}
