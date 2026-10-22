/**
 * 考試模擬的設定載入層。
 *
 * 兩個 JSON 都是「資料」不是「程式邏輯」：
 *  - config/caa-exam.json      官方數值權威檔（AC 107-005D 附錄，附頁碼）
 *  - config/exam-aircraft.json 考試機型獨立疊加參數（附件十二樣機規格 +
 *                               模擬假設，非官方）
 *
 * 讀取端只做型別收窄與預設值，不改寫數值；任何「讀不到」的官方數值在上游
 * JSON 就是 null，這裡如實傳遞（nullsReport 由 JSON 自帶）。
 */

import caaExamJson from '../../config/caa-exam.json';
import examAircraftJson from '../../config/exam-aircraft.json';
import type { ExamAircraftParams, ExamFlightMode } from './types';

/** 官方模式定義（AC 107-005D p3）。 */
export interface OfficialModeDef {
  name: string;
  definition: string;
  holdsHorizontalPosition: boolean;
  page: number | null;
}

export interface ExamConfig {
  meta: {
    disclaimer: string;
    authority: string;
    vehicleType: string;
    level: string;
    sourceDocument: string;
  };
  modes: Record<ExamFlightMode, OfficialModeDef> & { defaultForExam: ExamFlightMode };
  wind: {
    meanWindKnots: number;
    meanWindMps: number;
    gustKnots: number;
    gustMps: number;
    declarationText: string;
    page: number | null;
  };
  timeLimit: {
    totalMinutes: number;
    page: number | null;
  };
  field: {
    operationArea: { lengthM: number; widthM: number; sideMarginM: number; page: number };
    figure8: {
      circleDiameterM: number;
      circleRadiusM: number;
      sharedCrossingPoint: string;
      cones: string[];
      leftArcOrder: string[];
      leftArcDirection: string;
      rightArcOrder: string[];
      rightArcDirection: string;
      page: number;
    };
    landingPointH: {
      markingCircleDiameterM: number | null;
      observedInFigure: { outerMarkingM: number; innerTargetM: number } | null;
      page: number | null;
    };
    safetyLine: { present: boolean | null };
    examinerPosition: {
      observedInFigure: { stationToCenterM: number; stationMarkingsM: number[] } | null;
      examinerDistanceM: number | null;
      page: number | null;
    };
    coneToEdgeMarginM: number | null;
  };
  subjects: {
    B: {
      name: string;
      criteria: string[];
      params: {
        takeoffHeightM: [number, number];
        hoverSecondsMin: number;
        rotationStepDeg: number;
        fourSideOrder: string[];
        landWithinMarking: boolean;
      };
      page: number;
    };
    C: {
      name: string;
      criteria: string[];
      params: {
        heightM: [number, number];
        hoverSecondsMin: number;
        equalAltitude: boolean;
        equalSpeed: boolean;
        mustNotPauseAtTurns: boolean;
        mustNotExitFigure8Marking: boolean;
        circleDiameterM: number;
      };
      page: number;
    };
  };
  majorFailures: { rule: string; items: string[]; page: number | null };
  reportForm: {
    source: string;
    headerFields: string[];
    items: string[];
    itemColumns: string[];
    testNote: string;
    testTimeFields: string[];
    signatures: string[];
    page: number;
  };
  scoring: {
    judgmentLabel: string;
    ratings: Record<'S' | 'U' | 'N', string>;
    passStandard: string;
    page: number;
  };
  simAssist: {
    disclaimer: string;
    source: string;
    subjectB: {
      hoverHeightTargetM: number;
      hoverHeightToleranceM: number;
      hoverTimeRequiredS: number;
      hoverTimeToleranceS: number;
      headingStepDeg: number;
      headingStepToleranceDeg: number;
      landingPositionToleranceM: number;
      positionHoldDriftToleranceM: number;
      mustNotFullyExitHMarking: boolean;
    };
    subjectC: {
      circleDiameterM: number;
      pathDeviationToleranceM: number;
      altitudeTargetM: number;
      altitudeToleranceM: number;
      maxTurnPauseS: number;
      mustNotExitFigure8Marking: boolean;
    };
    recordRawMeasurements: boolean;
    rawMeasurementFields: string[];
  };
  nullsReport: string[];
}

/** 附錄5 報告表項目（七項）—— 依官方順序。 */
export const REPORT_ITEMS = [
  '飛行前檢查',
  '定點起降及四面停懸',
  '8字水平圓',
  '側面停懸及前進、後退',
  '高度保持五邊飛行',
  '緊急處置程序',
  '飛行後檢查',
] as const;

export type ReportItemName = (typeof REPORT_ITEMS)[number];

/** S/U/N（附錄5 p220）。非百分制、非扣分制。 */
export type ExamRating = 'S' | 'U' | 'N';

function pickMode(def: { name: string; definition: string; holdsHorizontalPosition?: boolean; page?: number }): OfficialModeDef {
  return {
    name: def.name,
    definition: def.definition,
    holdsHorizontalPosition: def.holdsHorizontalPosition === true,
    page: def.page ?? null,
  };
}

/**
 * JSON 的 general.modes 鍵為 `positioning`（AC 107-005D p3 原文用詞），
 * 但執行期列舉 ExamFlightMode 用 `position`（與既有飛控代碼一致）。
 * 這裡做單一映射，避免執行期拿到非法列舉值。
 */
function mapExamMode(mode: string): ExamFlightMode {
  if (mode === 'positioning') return 'position';
  if (mode === 'manual' || mode === 'attitude') return mode;
  return 'position';
}

/**
 * 載入並收窄官方設定。JSON 由 Vite/TS 靜態匯入（resolveJsonModule），
 * 數值不經過任何換算；節換算僅在風場門檻比較時用（1 節 = 0.514444 m/s，
 * 官方同時給出兩種單位，此處以 m/s 欄位為準）。
 */
export function loadExamConfig(): ExamConfig {
  const raw = caaExamJson as unknown as {
    meta: ExamConfig['meta'];
    general: {
      modes: Record<string, { name: string; definition: string; holdsHorizontalPosition?: boolean; page?: number }> & {
        defaultForExam: ExamFlightMode;
      };
      wind: ExamConfig['wind'];
      timeLimit: { totalMinutes: number; page?: number };
    };
    field: ExamConfig['field'];
    subjects: { B_takeoff_four_side_hover: ExamConfig['subjects']['B']; C_figure8: ExamConfig['subjects']['C'] };
    majorFailures: ExamConfig['majorFailures'];
    reportForm: ExamConfig['reportForm'];
    scoring: ExamConfig['scoring'];
    simAssist: ExamConfig['simAssist'];
    nullsReport: string[];
  };

  return {
    meta: raw.meta,
    modes: {
      manual: pickMode(raw.general.modes.manual),
      attitude: pickMode(raw.general.modes.attitude),
      position: pickMode(raw.general.modes.positioning),
      defaultForExam: mapExamMode(raw.general.modes.defaultForExam),
    },
    wind: raw.general.wind,
    timeLimit: { totalMinutes: raw.general.timeLimit.totalMinutes, page: raw.general.timeLimit.page ?? null },
    field: raw.field,
    subjects: { B: raw.subjects.B_takeoff_four_side_hover, C: raw.subjects.C_figure8 },
    majorFailures: raw.majorFailures,
    reportForm: raw.reportForm,
    scoring: raw.scoring,
    simAssist: raw.simAssist,
    nullsReport: raw.nullsReport,
  };
}

/** 考試機參數（含慣性）。來源標註見 exam-aircraft.json。 */
export function loadExamAircraftParams(): ExamAircraftParams {
  const raw = examAircraftJson as unknown as {
    sampleAircraft: {
      massKg: { value: number };
      maxTiltDeg: { value: number };
      maxHorizontalSpeedMps: { value: number };
      accelerationMps2: { value: number };
      dragCoefficient: { value: number };
      inertia: {
        horizontalVelocityTimeConstantS: { value: number };
        attitudeTimeConstantS: { value: number };
        attitudeRateLimitDegPerS: { value: number };
      };
    };
  };
  const a = raw.sampleAircraft;
  return {
    massKg: a.massKg.value,
    maxTiltDeg: a.maxTiltDeg.value,
    maxHorizontalSpeedMps: a.maxHorizontalSpeedMps.value,
    accelerationMps2: a.accelerationMps2.value,
    dragCoefficient: a.dragCoefficient.value,
    horizontalVelocityTimeConstantS: a.inertia.horizontalVelocityTimeConstantS.value,
    attitudeTimeConstantS: a.inertia.attitudeTimeConstantS.value,
    attitudeRateLimitDegPerS: a.inertia.attitudeRateLimitDegPerS.value,
  };
}
