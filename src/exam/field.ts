/**
 * 考場場景幾何（CAA 專業基本級術科考場模擬，附錄6 圖11 p233）。
 *
 * 數值來源：config/caa-exam.json（AC 107-005D 附錄6，附頁碼）。
 * 讀不到的欄位在 JSON 已是 null，這裡如實傳遞。
 *
 * 座標約定與全專案飛控一致（forward = −Z、right = +X）：
 *  - 起降點 H 置於世界原點 (0,0,0)；
 *  - 八字雙圓對稱軸沿 X（左弧在 −X 側、右弧在 +X 側），整體位於 H 前方
 *    （−Z 方向），便於應考人自 H 起飛後向前飛入；
 *  - 角錐 P1–P7 落在各自圓周上（左弧 CCW、右弧 CW），交點 P4 為兩圓共用點
 *    （兩圓於 P4 相切，各圓半徑 6m，圓心相距 12m）。
 *
 * 說明：圖11 未以數值化方式給出各角錐的精確角度與考場整體朝向，下方「前向
 * 距離」「監評站位」等為本教學模擬依圖11 比例之自設幾何（標「模擬假設，
 * 非官方」），僅用於渲染與路徑偏差判定；角錐皆位於官方半徑 6m 圓周上，
 * 符合「八字雙圓直徑 12m」之強約束。
 */

import type { Vector3Like } from '../flight/types';
import type { ExamConfig } from './config';

/** 場平面座標（公尺，世界 X / 世界 Z）。 */
export interface FieldPoint2D {
  x: number;
  z: number;
}

/** 一個八字圓（中心 + 半徑）。 */
export interface ExamFigure8Circle {
  center: FieldPoint2D;
  radiusM: number;
}

export interface ExamOperationArea {
  lengthM: number;
  widthM: number;
  sideMarginM: number;
  halfLengthM: number;
  halfWidthM: number;
}

export interface ExamLandingPoint {
  position: FieldPoint2D;
  /** 外標示半徑（markingCircleDiameterM 在 JSON 為 null，這裡用觀察值 1.8m）。 */
  outerMarkingM: number;
  /** 內靶半徑（觀察值 0.5m）。 */
  innerTargetM: number;
}

export interface ExamExaminerStation {
  position: FieldPoint2D;
  /** 站位至八字中心的距離（JSON observedInFigure.stationToCenterM = 4m）。 */
  stationToCenterM: number;
}

export interface ExamFigure8 {
  radiusM: number;
  /** 共用交點 P4。 */
  crossing: FieldPoint2D;
  /** 八字中心（兩圓心連線中點），用於監評站位距離與整體定位。 */
  center: FieldPoint2D;
  leftCircle: ExamFigure8Circle;
  rightCircle: ExamFigure8Circle;
  circles: [ExamFigure8Circle, ExamFigure8Circle];
  /** 角錐 P1..P7 的場平面座標（key 為 'P1'..'P7'）。 */
  cones: Record<string, FieldPoint2D>;
  leftArcOrder: string[];
  rightArcOrder: string[];
}

export interface ExamField {
  operationArea: ExamOperationArea;
  figure8: ExamFigure8;
  landingPointH: ExamLandingPoint;
  examinerPosition: ExamExaminerStation;
  /** 應考人站位（起降點 H 附近）；用於「超越應考人後方」重大違失判定。 */
  examineePosition: FieldPoint2D;
  /** 應考人後方界線（z 大於此值即視為超越應考人後方，單位 m）。 */
  behindLimitZ: number;
  sourcePage: number;
}

// ---------------------------------------------------------------------------
// 自設幾何常數（模擬假設，非官方；依圖11 比例，不違反官方半徑/直徑強約束）
// ---------------------------------------------------------------------------

/** 八字中心相對 H 的前向距離（−Z 為前）。兩圓位於 H 前方。 */
const FIGURE8_FORWARD_Z = -16;
/** H 標示外圈半徑（圖11 觀察 1.8m）。 */
const H_OUTER_MARKING_M = 1.8;
/** H 內靶半徑（圖11 觀察 0.5m）。 */
const H_INNER_TARGET_M = 0.5;
/** 監評站位至八字中心距離（圖11 觀察 4m），置於 H 與八字中心連線上。 */
const EXAMINER_STATION_TO_CENTER_M = 4;
/** 應考人後方界線（相對 examineePosition.z 的容許後退量，m）。 */
const BEHIND_MARGIN_M = 3;
/** 角錐碰撞半徑（含機體半徑的近似，m）。 */
const CONE_HIT_RADIUS_M = 0.8;

/**
 * 由官方設定建構考場幾何。所有強約束（操作區尺寸、八字直徑/半徑、角錐數量）
 * 直接來自 config；朝向與監評站位為上述自設幾何。
 */
export function buildExamField(config: ExamConfig): ExamField {
  const op = config.field.operationArea;
  const fig = config.field.figure8;
  const radius = fig.circleRadiusM;

  // 防呆：若 JSON 半徑與官方 6 不一致，仍以 JSON 為準（不自行修正）。
  const crossZ = FIGURE8_FORWARD_Z;
  const crossing: FieldPoint2D = { x: 0, z: crossZ };
  const leftCenter: FieldPoint2D = { x: -radius, z: crossZ };
  const rightCenter: FieldPoint2D = { x: radius, z: crossZ };
  const center: FieldPoint2D = { x: 0, z: crossZ };

  const leftCircle: ExamFigure8Circle = { center: leftCenter, radiusM: radius };
  const rightCircle: ExamFigure8Circle = { center: rightCenter, radiusM: radius };

  // 角錐位置：以「相對各自圓心、角度 α（自 +X 方向量起）」參數化。
  // 左圓 P4 在 α=0；右圓 P4 在 α=180°。左弧 CCW（α 遞增）、右弧 CW（α 遞減）。
  // 左圓：P4(α0) → P1(α90) → P2(α180) → P3(α270) → P4。
  const leftCones: Record<string, FieldPoint2D> = {
    P4: { x: leftCenter.x + radius * Math.cos(0), z: leftCenter.z + radius * Math.sin(0) },
    P1: { x: leftCenter.x + radius * Math.cos(Math.PI / 2), z: leftCenter.z + radius * Math.sin(Math.PI / 2) },
    P2: { x: leftCenter.x + radius * Math.cos(Math.PI), z: leftCenter.z + radius * Math.sin(Math.PI) },
    P3: { x: leftCenter.x + radius * Math.cos((3 * Math.PI) / 2), z: leftCenter.z + radius * Math.sin((3 * Math.PI) / 2) },
  };
  // 右圓：P4 在 α=180；CW 自 P4 起 α 遞減：P4(α180) → P5(α90) → P6(α0) → P7(α270) → P4。
  const rightCones: Record<string, FieldPoint2D> = {
    P4: { x: rightCenter.x + radius * Math.cos(Math.PI), z: rightCenter.z + radius * Math.sin(Math.PI) },
    P5: { x: rightCenter.x + radius * Math.cos(Math.PI / 2), z: rightCenter.z + radius * Math.sin(Math.PI / 2) },
    P6: { x: rightCenter.x + radius * Math.cos(0), z: rightCenter.z + radius * Math.sin(0) },
    P7: { x: rightCenter.x + radius * Math.cos((3 * Math.PI) / 2), z: rightCenter.z + radius * Math.sin((3 * Math.PI) / 2) },
  };
  const cones: Record<string, FieldPoint2D> = { ...leftCones, ...rightCones };

  const figure8: ExamFigure8 = {
    radiusM: radius,
    crossing,
    center,
    leftCircle,
    rightCircle,
    circles: [leftCircle, rightCircle],
    cones,
    leftArcOrder: fig.leftArcOrder,
    rightArcOrder: fig.rightArcOrder,
  };

  const examineePosition: FieldPoint2D = { x: 0, z: 0 };
  // 監評站位：八字中心往 H 方向 4m（z = crossZ + 4 = -12）。
  const examinerPosition: ExamExaminerStation = {
    position: { x: 0, z: crossZ + EXAMINER_STATION_TO_CENTER_M },
    stationToCenterM: EXAMINER_STATION_TO_CENTER_M,
  };

  return {
    operationArea: {
      lengthM: op.lengthM,
      widthM: op.widthM,
      sideMarginM: op.sideMarginM,
      halfLengthM: op.lengthM / 2,
      halfWidthM: op.widthM / 2,
    },
    figure8,
    landingPointH: {
      position: { x: 0, z: 0 },
      outerMarkingM: config.field.landingPointH.observedInFigure?.outerMarkingM ?? H_OUTER_MARKING_M,
      innerTargetM: config.field.landingPointH.observedInFigure?.innerTargetM ?? H_INNER_TARGET_M,
    },
    examinerPosition,
    examineePosition,
    behindLimitZ: examineePosition.z + BEHIND_MARGIN_M,
    sourcePage: op.page,
  };
}

/** 備用：若外部需要直徑常數。 */
export const FIGURE8_DIAMETER_M = 12;
export const CONE_HIT_RADIUS = CONE_HIT_RADIUS_M;

// ---------------------------------------------------------------------------
// 幾何量測輔助（判定與渲染共用）
// ---------------------------------------------------------------------------

/** 點到圓周的徑向偏差（m）：|dist(point,center) − radius|。 */
export function radialDeviationM(point: FieldPoint2D, circle: ExamFigure8Circle): number {
  const d = Math.hypot(point.x - circle.center.x, point.z - circle.center.z);
  return Math.abs(d - circle.radiusM);
}

/**
 * 八字路徑偏差（m）：取兩圓徑向偏差之最小值。飛行時應保持貼近任一圓周，
 * 故偏差即「距理想 8 字路徑」的距離。
 */
export function figure8PathDeviationM(field: ExamField, x: number, z: number): number {
  const point: FieldPoint2D = { x, z };
  return Math.min(
    radialDeviationM(point, field.figure8.leftCircle),
    radialDeviationM(point, field.figure8.rightCircle),
  );
}

/** 點是否在操作區內（可選額外 margin，預設為側邊界 sideMarginM 視為區內）。 */
export function isWithinOperationArea(field: ExamField, x: number, z: number, marginM = 0): boolean {
  const dx = field.operationArea.halfWidthM + marginM;
  const dz = field.operationArea.halfLengthM + marginM;
  return Math.abs(x) <= dx && Math.abs(z) <= dz;
}

/** 點是否落於 H 外標示圈內（用於科目B 降落不超標判定）。 */
export function isWithinHMarking(field: ExamField, x: number, z: number, toleranceM = 0): boolean {
  const d = Math.hypot(x - field.landingPointH.position.x, z - field.landingPointH.position.z);
  return d <= field.landingPointH.outerMarkingM + toleranceM;
}

/** 點是否與任一角錐碰撞（含機體半徑近似）。 */
export function hitsAnyCone(field: ExamField, x: number, z: number, radiusM = CONE_HIT_RADIUS_M): string | null {
  for (const [id, c] of Object.entries(field.figure8.cones)) {
    if (Math.hypot(x - c.x, z - c.z) <= radiusM) return id;
  }
  return null;
}

/** 是否超越應考人後方（重大違失用）。 */
export function isBehindExaminee(field: ExamField, z: number): boolean {
  return z > field.behindLimitZ;
}

/** 八字中心（供渲染/監評站位定位）。 */
export function figure8Center(field: ExamField): FieldPoint2D {
  return field.figure8.center;
}

/** 取角錐座標（不存在回 null）。 */
export function conePosition(field: ExamField, id: string): FieldPoint2D | null {
  return field.figure8.cones[id] ?? null;
}

/**
 * 科目 D 側向機動的兩個端角錐（P3 左、P7 右）與其橫向間距。
 *
 * 官方（p164）描述「側面前進至P3／側面後退至P7」，即機頭朝側面時沿機頭方向
 * 在 P3↔P7 之間往返；P3↔P7 間距即該級距之後退距離
 * （config.subjects.D.params.retreatDistanceByLevelM，級距 I = 12m）。
 *
 * 注意：本場幾何的八字圓直徑固定 12m（級距 I），故 P3↔P7 恆為 12m；
 * 級距 II/III 的 18m/24m 需搭配較大場地（附錄6 圖12/圖13），當前場地無法
 * 重現——由判定端如實記錄差異，不自創及格線。
 */
export function subjectDWaypoints(field: ExamField): {
  p3: FieldPoint2D;
  p7: FieldPoint2D;
  h: FieldPoint2D;
  /** P3↔P7 橫向間距（m，由場幾何導出）。 */
  retreatSpacingM: number;
} {
  const p3 = conePosition(field, 'P3') ?? { x: -field.figure8.radiusM, z: field.figure8.center.z - field.figure8.radiusM };
  const p7 = conePosition(field, 'P7') ?? { x: field.figure8.radiusM, z: field.figure8.center.z - field.figure8.radiusM };
  return {
    p3,
    p7,
    h: field.landingPointH.position,
    retreatSpacingM: Math.hypot(p7.x - p3.x, p7.z - p3.z),
  };
}

/** 較近一側八字圓（科目 F「相對較近一側八字內圈」用）。 */
export function nearerFigure8Circle(
  field: ExamField,
  x: number,
  z: number,
): { side: 'left' | 'right'; circle: ExamFigure8Circle; distanceM: number } {
  const l = field.figure8.leftCircle;
  const r = field.figure8.rightCircle;
  const dl = Math.hypot(x - l.center.x, z - l.center.z);
  const dr = Math.hypot(x - r.center.x, z - r.center.z);
  return dl <= dr
    ? { side: 'left', circle: l, distanceM: dl }
    : { side: 'right', circle: r, distanceM: dr };
}

/** 點到圓心的距離（m）。 */
export function distanceToCircleCenter(circle: ExamFigure8Circle, x: number, z: number): number {
  return Math.hypot(x - circle.center.x, z - circle.center.z);
}

export type { Vector3Like };
