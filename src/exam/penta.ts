/**
 * 科目 E（高度保持五邊飛行）五邊幾何 — 純函式層（第一階段）。
 *
 * 定位：數據／幾何／可視化輔助，**不接評分**（判定留待下階段，須另行批准）。
 * 依據：config/caa-exam.json subjects.E（AC 107-005D p165）。
 *
 * 官方已核實（p165）：
 *  - 三條質性條件（機頭朝飛行方向並穩定航高／航向改變時滾轉俯仰不得劇烈變化／
 *    第一邊及第五邊須穩定準確通過 P3 至 P7 之延伸線上方）；
 *  - 最小操作空域（級距 I 80×20／II 120×30／III 160×40）；
 *  - 操作高度 20m。
 *
 * 項目教學假設（非官方，畫面與程式碼均標註）：
 *  - 五邊航線的形狀、航路點位置、轉彎方式（本檔採順時鐘矩形五邊）；
 *  - 起飛進入段與第五邊進場段的斜接下標；
 *  - 官方五邊各邊具體幾何（位置/方向/轉彎）尚未核實，見
 *    docs/handoff/SUBJECT-E-RULE-VERIFICATION-2026-10-25.md。
 */

import type { ExamConfig } from './config';
import type { ExamField, FieldPoint2D } from './field';

/** 場平面上的直線（點 + 單位方向）。 */
export interface PentaExtensionLine {
  point: FieldPoint2D;
  dirX: number;
  dirZ: number;
}

/** 級距最小操作空域（長沿 Z、寬沿 X）。 */
export interface PentaAirspace {
  lengthM: number;
  widthM: number;
}

/** 航段與延伸線的關係。 */
export type PentaLegRelation = 'along' | 'crossing' | 'touch-end' | 'none';

/** 五邊航線的一個航路點（y 為海拔高度）。 */
export interface PentaWaypoint {
  x: number;
  z: number;
  y: number;
  label: string;
}

/** 五邊的一條邊（航段）。 */
export interface PentaLeg {
  fromIndex: number;
  toIndex: number;
  label: string;
  /** 航段是否「通過 P3–P7 延伸線上方」（官方條件③的可視化錨點）。 */
  crossesExtension: boolean;
  relation: PentaLegRelation;
}

/** 教學假設五邊航線。 */
export interface PentaRoute {
  waypoints: PentaWaypoint[];
  /** 五條邊（第一邊～第五邊）。 */
  legs: PentaLeg[];
  /** 起飛進入段（H → 第一邊起點；非五邊之一）。 */
  entry: { fromIndex: number; toIndex: number; label: string; crossesExtension: boolean };
  /** 操作高度（公尺；官方值由呼叫端自 config.subjects.E.params.operationAltitudeM 傳入）。 */
  altitudeM: number;
  /** 延伸線（由場地 P3/P7 導出，供可視化與判定錨點）。 */
  extensionLine: PentaExtensionLine;
  /** 恆 true：本航線為項目教學假設，非官方。 */
  assumption: true;
  note: string;
}

/** 數值比較容差（公尺）。 */
const EPS = 1e-6;

/**
 * P3 至 P7 的延伸線（官方條件③的場地錨點）。
 * 由場地幾何導出：P3(-6,-22)、P7(6,-22)（級距 I、八字半徑 6m、圓心 z=-16）。
 */
export function p3ToP7ExtensionLine(field: ExamField): PentaExtensionLine {
  const p3 = field.figure8.cones.P3 ?? { x: -field.figure8.radiusM, z: field.figure8.center.z - field.figure8.radiusM };
  const p7 = field.figure8.cones.P7 ?? { x: field.figure8.radiusM, z: field.figure8.center.z - field.figure8.radiusM };
  const dx = p7.x - p3.x;
  const dz = p7.z - p3.z;
  const len = Math.hypot(dx, dz) || 1;
  return { point: { x: p3.x, z: p3.z }, dirX: dx / len, dirZ: dz / len };
}

/** 點到延伸線的垂直距離（公尺）。 */
export function distanceToExtensionLineM(line: PentaExtensionLine, x: number, z: number): number {
  const vx = x - line.point.x;
  const vz = z - line.point.z;
  return Math.abs(vx * line.dirZ - vz * line.dirX);
}

/** 級距最小操作空域（config.subjects.E.params.minOperationAirspaceByLevelM）。 */
export function pentaAirspaceForLevel(config: ExamConfig, level: string): PentaAirspace | null {
  const a = config.subjects.E?.params?.minOperationAirspaceByLevelM?.[level];
  if (!a || !(a.length > 0) || !(a.width > 0)) return null;
  return { lengthM: a.length, widthM: a.width };
}

/** 航段與延伸線的關係（along=共線穩定通過／crossing=橫穿或沿線脫離／touch-end=僅端點在線上）。 */
export function legRelationToExtension(
  line: PentaExtensionLine,
  a: FieldPoint2D,
  b: FieldPoint2D,
): PentaLegRelation {
  const lineZ = line.point.z; // 延伸線沿 X（dirZ≈0），以 z 座標判定
  const za = a.z - lineZ;
  const zb = b.z - lineZ;
  const alongZ = Math.abs(za) < 0.05 && Math.abs(zb) < 0.05;
  const alongX = Math.abs((b.x - a.x) * line.dirX + (b.z - a.z) * line.dirZ);
  if (alongZ) {
    // 兩端都在線上且沿方向有位移 → 共線穩定通過。
    return alongX > 0.05 ? 'along' : 'touch-end';
  }
  if (za * zb < -EPS) return 'crossing';
  if (Math.abs(za) < 0.05 || Math.abs(zb) < 0.05) {
    // 恰一端在線上：沿延伸線方向（X）有位移 → 視為通過（進場/起飛沿線脫離）；
    // 純垂直脫離（沿線位移≈0）→ 僅擦到端點，不算通過。
    return alongX > 0.05 ? 'crossing' : 'touch-end';
  }
  return 'none';
}

/**
 * 教學假設五邊航線（順時鐘矩形五邊，起降於 H 正上方）。
 *
 * 航路點（級距 I 場地，單位 m；y = altitudeM）：
 *  - W0 = H 正上方 (0, 0)（起飛／降落）
 *  - W1 = 左後 (-10, -22)（延伸線上，第一邊起點）
 *  - W2 = 右後 (10, -22)（延伸線上，第一邊終點）
 *  - W3 = 右前 (10, -6)
 *  - W4 = 左前 (-10, -6)
 *
 * 邊：
 *  - 起飛進入段 W0→W1（非五邊之一）
 *  - 第一邊 W1→W2（沿 X 通過 P3–P7 延伸線）★官方條件③
 *  - 第二邊 W2→W3（右側向前）
 *  - 第三邊 W3→W4（前方橫移）
 *  - 第四邊 W4→W1（左側向後）
 *  - 第五邊 W1→W0（進場，橫穿延伸線）★官方條件③
 *
 * 半寬 10m 取自級距 I 最小空域寬 20m；z 範圍 -6～-22 使航線環繞八字
 * （雙圓外接 x∈[-12,12]、z∈[-22,-10]）而不進入圓內。
 */
export function buildTeachingPentaRoute(field: ExamField, altitudeM: number): PentaRoute {
  const line = p3ToP7ExtensionLine(field);
  const y = altitudeM;
  const halfWidth = 10; // 級距 I 空域寬 20m 的一半（教學假設佈局）
  const w0: PentaWaypoint = { x: 0, z: 0, y, label: 'W0 起降點 H 上方' };
  const w1: PentaWaypoint = { x: -halfWidth, z: line.point.z, y, label: 'W1 左後（延伸線）' };
  const w2: PentaWaypoint = { x: halfWidth, z: line.point.z, y, label: 'W2 右後（延伸線）' };
  const w3: PentaWaypoint = { x: halfWidth, z: -6, y, label: 'W3 右前' };
  const w4: PentaWaypoint = { x: -halfWidth, z: -6, y, label: 'W4 左前' };
  const waypoints = [w0, w1, w2, w3, w4];

  const mkLeg = (fromIndex: number, toIndex: number, label: string): PentaLeg => {
    const a = waypoints[fromIndex];
    const b = waypoints[toIndex];
    const relation = legRelationToExtension(line, a, b);
    return {
      fromIndex,
      toIndex,
      label,
      relation,
      crossesExtension: relation === 'along' || relation === 'crossing',
    };
  };

  return {
    waypoints,
    legs: [
      mkLeg(1, 2, '第一邊'),
      mkLeg(2, 3, '第二邊'),
      mkLeg(3, 4, '第三邊'),
      mkLeg(4, 1, '第四邊'),
      mkLeg(1, 0, '第五邊'),
    ],
    entry: (() => {
      const relation = legRelationToExtension(line, w0, w1);
      return {
        fromIndex: 0,
        toIndex: 1,
        label: '起飛進入（非五邊）',
        crossesExtension: relation === 'along' || relation === 'crossing',
      };
    })(),
    altitudeM: y,
    extensionLine: line,
    assumption: true,
    note:
      '項目教學假設航線（非官方）：官方僅規定「第一邊及第五邊須穩定準確通過 P3 至 P7 之延伸線上方」' +
      '（p165），各邊位置/方向/轉彎方式未於官方文件核實。操作高度 20m 為官方值（p165）。',
  };
}

/** 取得航線的所有繪製段（進入段 + 五邊，依飛行順序）。 */
export function pentaLegs(route: PentaRoute): PentaLeg[] {
  return route.legs;
}

/** 取得依飛行順序的航路點序列（進入段起點 → … → 第五邊終點）。 */
export function pentaFlightOrder(route: PentaRoute): PentaWaypoint[] {
  const seq: PentaWaypoint[] = [route.waypoints[route.entry.fromIndex]];
  seq.push(route.waypoints[route.entry.toIndex]);
  for (const leg of route.legs) seq.push(route.waypoints[leg.toIndex]);
  return seq;
}
