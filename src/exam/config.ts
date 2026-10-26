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
import type { ExamCameraView } from './flow';

/** 官方模式定義（AC 107-005D p3）。 */
export interface OfficialModeDef {
  name: string;
  definition: string;
  holdsHorizontalPosition: boolean;
  page: number | null;
}

/** 科目 A／G（飛行前／後檢查）的官方條文（p161／p167）。 */
export interface SubjectChecklist {
  name: string;
  criteria: string[];
  page: number;
}

/** 科目 E：高度保持五邊飛行（p165）。官方質性條件＋級距空域＋操作高度。 */
export interface SubjectEDef {
  name: string;
  /** 官方條文（p165 三條件原文）。 */
  criteria: string[];
  /** 是否第二階段測驗項目（與科目 F 同批）。 */
  phase2: boolean;
  params: {
    /** 各級距最小操作空域（長×寬，公尺；長沿 Z、寬沿 X）。 */
    minOperationAirspaceByLevelM: Record<string, { length: number; width: number }>;
    /** 操作高度（公尺）。 */
    operationAltitudeM: number;
  };
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
    /** 科目 D：側面停懸及前進、後退（p164）。 */
    D: {
      name: string;
      criteria: string[];
      params: {
        retreatDistanceByLevelM: Record<string, number>;
        hoverSecondsMin: number;
      };
      page: number;
    };
    /** 科目 F：緊急處置程序（p166）。 */
    F: {
      name: string;
      criteria: string[];
      params: {
        landInnerCircleAltitudeM: [number, number];
      };
      page: number;
    };
    /** 科目 A／G：飛行前／後檢查（p161／p167）。 */
    A: SubjectChecklist;
    G: SubjectChecklist;
    /**
     * 科目 E：高度保持五邊飛行（p165，phase2）。
     * 第一階段僅數據層＋可視化：不接評分（見 docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md）。
     */
    E: SubjectEDef;
  };
  /** 目前級距（exam-aircraft.json defaultLevel，例 'I'）。 */
  level: string;
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
    subjectD: {
      hoverHeightTargetM: number;
      hoverHeightToleranceM: number;
      hoverTimeRequiredS: number;
      hoverTimeToleranceS: number;
      positionHoldDriftToleranceM: number;
      sideHeadingToleranceDeg: number;
      retreatDistanceToleranceM: number;
    };
    subjectF: {
      /** 下達緊急返航後，水平速度應收斂到 holdSpeedMps 以下的時限（s）。 */
      immediateHoldS: number;
      /** 「立即」的量化：原處懸停平台須在觸發後此時限內開始（s）。模擬假設。 */
      immediateHoldWithinS: number;
      holdSpeedMps: number;
      /** 原處懸停期間的最大位置漂移（m）。 */
      holdDriftToleranceM: number;
      /** 進場下降率上限（m/s，負值）；超過視為不穩定進場。 */
      maxDescentRateMps: number;
      /** 進場至目標上方時的高度區間（m，官方 landInnerCircleAltitudeM）。 */
      approachAltitudeM: [number, number];
      /** 降落點距較近圓心的容許距離（m）。 */
      innerCircleToleranceM: number;
      /** 進場/下降窗口內撞擊角錐的高度門檻（m）。 */
      coneHitHeightM: number;
    };
    /**
     * 科目 E（高度保持五邊飛行）教學練習門檻（第四輪）。
     * 恆為模擬假設、非官方、可調；官方五邊量化容差未於 AC 107-005D 讀到。
     * 僅供教學練習提示與進度追蹤，不產生官方通過／失敗結論。
     */
    subjectE: {
      disclaimer: string;
      /** 恆 true：模擬假設，非官方。 */
      assumption: true;
      /** 偏離教學航線的提示門檻（m）。 */
      routeDeviationToleranceM: number;
      /** 高度偏差提示門檻（m）。 */
      altitudeToleranceM: number;
      /** 航路點到達判定半徑（m）。 */
      waypointReachRadiusM: number;
      /** 每段最短練習時間（s；防止抄捷徑跳段）。 */
      minSegmentTimeS: number;
      /** 起飛完成判定容差（m）。 */
      takeoffCompleteToleranceM: number;
      note: string;
    };
    /** 考試相機視角（模擬假設，非官方，可調）。 */
    camera: {
      disclaimer: string;
      defaultView: ExamCameraView;
      views: {
        examinee: { eyeHeightM: number; standoffBehindHM: number; note?: string };
        follow: { distanceM: number; heightM: number; note?: string };
        overview: { heightM: number; distanceM: number; lookAtZ: number; note?: string };
      };
    };
    /** 重大違失①「超越應考人後方」之模擬假設站位（非官方，可調）。 */
    examineeRear: {
      disclaimer: string;
      position: { x: number; z: number };
      behindMarginM: number;
      /** false = 官方站位距離未確認前只在成績單顯示警示，不計入 simulatedPass 否決。 */
      countsTowardFail: boolean;
      note?: string;
    };
    recordRawMeasurements: boolean;
    rawMeasurementFields: string[];
    /**
     * 風況選項（教學／監評切換）。
     *
     * 語意（2026-10-23 修正）：`gustMps` 是「瞬時風速的峰值上限」，瞬時風速在
     * `meanMps`（平均風）與 `gustMps`（陣峰）之間波動，**不再**把陣風疊加在平均
     * 風之上。安全宣告門檻仍為官方值（平均 ≥7.5 或 陣峰 ≥10 m/s，p4）。
     */
    windPresets: {
      disclaimer: string;
      semantics: string;
      defaultPreset: string;
      presets: Array<{
        key: string;
        label: string;
        meanMps: number;
        gustMps: number;
        /** true = 官方給出的數值（無風／宣告門檻）；false = 模擬假設（非官方）。 */
        official: boolean;
        note?: string;
      }>;
    };
  };
  nullsReport: string[];
}

/** 考試相機視角（V 鍵循環）——定義在 flow.ts，此處 re-export 供設定層引用。 */
export type { ExamCameraView };

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
    subjects: {
      B_takeoff_four_side_hover: ExamConfig['subjects']['B'];
      C_figure8: ExamConfig['subjects']['C'];
      D_side_hover_forward_backward: ExamConfig['subjects']['D'];
      F_emergency: ExamConfig['subjects']['F'];
      A_preflight: ExamConfig['subjects']['A'];
      G_postflight: ExamConfig['subjects']['G'];
      E_altitude_hold_five_sided: ExamConfig['subjects']['E'];
    };
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
    subjects: {
      B: raw.subjects.B_takeoff_four_side_hover,
      C: raw.subjects.C_figure8,
      D: raw.subjects.D_side_hover_forward_backward,
      F: raw.subjects.F_emergency,
      A: raw.subjects.A_preflight,
      G: raw.subjects.G_postflight,
      E: raw.subjects.E_altitude_hold_five_sided,
    },
    level: loadExamLevelInfo().level,
    majorFailures: raw.majorFailures,
    reportForm: raw.reportForm,
    scoring: raw.scoring,
    simAssist: raw.simAssist,
    nullsReport: raw.nullsReport,
  };
}

/** 目前級距與其官方參數（exam-aircraft.json）。 */
export interface ExamLevelInfo {
  level: string;
  /** 科目 D 後退距離（p164 retreatDistanceByLevelM）。 */
  retreatDistanceM: number | null;
  /** 級距對應之場地圖（附錄6 圖11/12/13）。 */
  fieldFigure: string | null;
}

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

/**
 * 目前級距（exam-aircraft.json defaultLevel）與科目 D 後退距離。
 * 級距 II/III 需搭配較大場地（附錄6 圖12/圖13），本模擬場幾何為級距 I，
 * 故 retreatDistanceM 可能與場地實際 P3↔P7 間距不符——由呼叫端比對並記錄。
 */
export function loadExamLevelInfo(): ExamLevelInfo {
  const raw = examAircraftJson as unknown as {
    defaultLevel?: string;
    levels?: Array<{ level?: string; retreatDistanceM?: number | null; fieldFigure?: string | null }>;
  };
  const level = raw.defaultLevel ?? 'I';
  const found = (raw.levels ?? []).find((l) => l.level === level);
  return {
    level,
    retreatDistanceM: found?.retreatDistanceM ?? null,
    fieldFigure: found?.fieldFigure ?? null,
  };
}

// ---------------------------------------------------------------------------
// 科目 E 配置合法性驗證（第一階段數據層）
// ---------------------------------------------------------------------------

export interface SubjectEConfigCheck {
  ok: boolean;
  /** 人類可讀的問題清單（空陣列 = 合法）。 */
  errors: string[];
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 科目 E 配置合法性驗證（型別完整性＋數值合理性，非官方性審查）。
 *
 * 檢查官方條文存在、級距空域齊備且為正數、操作高度為正數。
 * page 可為 null（「讀不到留 null」的既有慣例），不視為錯誤。
 */
export function validateSubjectEConfig(e: SubjectEDef): SubjectEConfigCheck {
  const errors: string[] = [];
  if (typeof e?.name !== 'string' || e.name.length === 0) {
    errors.push('name：科目 E 名稱為空或非字串');
  }
  if (!Array.isArray(e?.criteria) || e.criteria.length === 0) {
    errors.push('criteria：官方條文為空或非陣列');
  } else if (e.criteria.some((c) => typeof c !== 'string' || c.trim().length === 0)) {
    errors.push('criteria：含空字串或非字串條文');
  }
  const airspace = e?.params?.minOperationAirspaceByLevelM;
  if (!airspace || typeof airspace !== 'object') {
    errors.push('minOperationAirspaceByLevelM：缺失或非物件');
  } else if (!isPositiveNumber(airspace.I?.length) || !isPositiveNumber(airspace.I?.width)) {
    errors.push('minOperationAirspaceByLevelM：缺少級距 I 或其 length/width 非正數');
  }
  if (!isPositiveNumber(e?.params?.operationAltitudeM)) {
    errors.push('operationAltitudeM：操作高度缺失或非正數');
  }
  if (e?.page !== null && e?.page !== undefined && !isPositiveNumber(e.page)) {
    errors.push('page：頁碼須為正整數或 null');
  }
  return { ok: errors.length === 0, errors };
}
