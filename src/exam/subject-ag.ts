/**
 * 科目 A／G 判定 S/U/N（飛行前／後 360 度檢查，AC 107-005D p161／p167）。
 *
 * 官方準則：
 *   A（p161）：1 系統知識 9 項；2 檢查手持操控器各搖桿及開關功能是否正確；
 *              3 依據自備檢查表（附件3 範例）以逆時針方向繞行考試機實施飛行前
 *                360 度檢查。
 *   G（p167）：依據自備檢查表以逆時針方向繞行考試機實施飛行後 360 度檢查。
 *
 * 模擬實作邊界（如實記錄，不臆造）：
 *   - 「系統知識」官方由監評人員口頭問答；模擬以應考人自評「熟悉／不熟悉」
 *     呈現（口試問答未實作），記錄於 nullsReport。
 *   - 「搖桿及開關功能」模擬以自評功能正常與否呈現（未接實機訊號）。
 *   - 檢查表勾選（是／否）為應考人自備檢查表之模擬；任一項「否」即視為檢查
 *     發現缺陷 → 該科 U（不得帶缺陷飛／結案）。
 *   - 「逆時針繞行」以到訪航站順序判定：機頭 → 左側 → 機尾 → 右側
 *     （自上空俯視之逆時針；以機頭朝向為 12 點鐘）。
 *
 * 本模組為純函式分析：輸入地面檢查記錄（GroundCheckLog），不依賴 DOM。
 */

import {
  CHECKLIST_ITEMS,
  CONTROLLER_CHECK_ITEMS,
  STATIONS_CCW,
  SYSTEM_KNOWLEDGE_ITEMS,
  type StationId,
} from './checklist';
import type { ExamRating, JudgmentCheck, SubjectJudgmentBase } from './subjects';

/** 附件3 單項勾選（true=是；false=否）。 */
export interface ChecklistEntry {
  /** 飛行前欄（科目 A）。 */
  pre?: boolean;
  /** 飛行後欄（科目 G）。 */
  post?: boolean;
}

/** 地面檢查記錄（由 ExamSession 於考試進行中累積）。 */
export interface GroundCheckLog {
  /** 繞行到訪航站順序（含重訪）。 */
  stations: StationId[];
  /** 附件3 勾選：itemId → 飛行前／飛行後欄。 */
  checklist: Record<string, ChecklistEntry>;
  /** 系統知識自評：itemId → 是否熟悉（科目 A）。 */
  knowledge: Record<string, boolean>;
  /** 搖桿／開關功能自評：itemId → 功能是否正常（科目 A）。 */
  controller: Record<string, boolean>;
}

export function createGroundCheckLog(): GroundCheckLog {
  return { stations: [], checklist: {}, knowledge: {}, controller: {} };
}

export interface SubjectAResult extends SubjectJudgmentBase {
  raw: {
    stationOrder: StationId[];
    walkaroundCCW: boolean;
    checklistPreOk: number;
    checklistPreTotal: number;
    knowledgeOk: number;
    knowledgeTotal: number;
    controllerOk: number;
    controllerTotal: number;
  };
}

export interface SubjectGResult extends SubjectJudgmentBase {
  raw: {
    stationOrder: StationId[];
    walkaroundCCW: boolean;
    checklistPostOk: number;
    checklistPostTotal: number;
  };
}

function emptyAResult(): SubjectAResult {
  return {
    rating: 'N',
    executed: false,
    checks: [],
    failReasonKeys: ['subjectA.notExecuted'],
    raw: {
      stationOrder: [],
      walkaroundCCW: false,
      checklistPreOk: 0,
      checklistPreTotal: CHECKLIST_ITEMS.length,
      knowledgeOk: 0,
      knowledgeTotal: SYSTEM_KNOWLEDGE_ITEMS.length,
      controllerOk: 0,
      controllerTotal: CONTROLLER_CHECK_ITEMS.length,
    },
  };
}

function emptyGResult(): SubjectGResult {
  return {
    rating: 'N',
    executed: false,
    checks: [],
    failReasonKeys: ['subjectG.notExecuted'],
    raw: {
      stationOrder: [],
      walkaroundCCW: false,
      checklistPostOk: 0,
      checklistPostTotal: CHECKLIST_ITEMS.length,
    },
  };
}

/** 到訪順序是否涵蓋官方逆時針順序（機頭→左側→機尾→右側；之後的重訪不影響）。 */
export function isWalkaroundCCW(stations: StationId[]): boolean {
  const firstSeen: StationId[] = [];
  for (const st of stations) {
    if (!firstSeen.includes(st)) firstSeen.push(st);
  }
  const expected = STATIONS_CCW.filter((s) => firstSeen.includes(s));
  if (expected.length < STATIONS_CCW.length) return false;
  for (let i = 0; i < STATIONS_CCW.length; i += 1) {
    if (firstSeen[i] !== STATIONS_CCW[i]) return false;
  }
  return true;
}

function stationLabel(id: StationId): string {
  switch (id) {
    case 'nose':
      return '機頭';
    case 'left':
      return '左側';
    case 'tail':
      return '機尾';
    default:
      return '右側';
  }
}

/** 科目 A 判定（飛行前檢查）。 */
export function judgeSubjectA(log: GroundCheckLog): SubjectAResult {
  const touched =
    log.stations.length > 0 ||
    Object.keys(log.checklist).length > 0 ||
    Object.keys(log.knowledge).length > 0 ||
    Object.keys(log.controller).length > 0;
  if (!touched) return emptyAResult();

  const checks: JudgmentCheck[] = [];
  const failReasonKeys: string[] = [];

  // ① 系統知識 9 項全部自評熟悉。
  const knowledgeOk = SYSTEM_KNOWLEDGE_ITEMS.filter((k) => log.knowledge[k.id] === true).length;
  const knowledgePass = knowledgeOk === SYSTEM_KNOWLEDGE_ITEMS.length;
  checks.push({
    key: 'subjectA.knowledge',
    passed: knowledgePass,
    detail: `${knowledgeOk}/${SYSTEM_KNOWLEDGE_ITEMS.length} 項自評熟悉`,
  });
  if (!knowledgePass) failReasonKeys.push('subjectA.knowledgeFail');

  // ② 搖桿／開關功能全部正常。
  const controllerOk = CONTROLLER_CHECK_ITEMS.filter((k) => log.controller[k.id] === true).length;
  const controllerPass = controllerOk === CONTROLLER_CHECK_ITEMS.length;
  checks.push({
    key: 'subjectA.controller',
    passed: controllerPass,
    detail: `${controllerOk}/${CONTROLLER_CHECK_ITEMS.length} 項功能正常`,
  });
  if (!controllerPass) failReasonKeys.push('subjectA.controllerFail');

  // ③ 逆時針繞行（機頭→左側→機尾→右側）。
  const ccw = isWalkaroundCCW(log.stations);
  checks.push({
    key: 'subjectA.walkaround',
    passed: ccw,
    detail: `到訪順序 ${log.stations.map(stationLabel).join('→') || '—'}`,
  });
  if (!ccw) failReasonKeys.push('subjectA.walkaroundFail');

  // ④ 附件3 飛行前欄全部「是」。
  const preOk = CHECKLIST_ITEMS.filter((it) => log.checklist[it.id]?.pre === true).length;
  const prePass = preOk === CHECKLIST_ITEMS.length;
  checks.push({
    key: 'subjectA.checklist',
    passed: prePass,
    detail: `${preOk}/${CHECKLIST_ITEMS.length} 項皆「是」`,
  });
  if (!prePass) failReasonKeys.push('subjectA.checklistFail');

  const rating: ExamRating = checks.every((c) => c.passed) ? 'S' : 'U';
  return {
    rating,
    executed: true,
    checks,
    failReasonKeys: [...new Set(failReasonKeys)],
    raw: {
      stationOrder: [...log.stations],
      walkaroundCCW: ccw,
      checklistPreOk: preOk,
      checklistPreTotal: CHECKLIST_ITEMS.length,
      knowledgeOk,
      knowledgeTotal: SYSTEM_KNOWLEDGE_ITEMS.length,
      controllerOk,
      controllerTotal: CONTROLLER_CHECK_ITEMS.length,
    },
  };
}

/** 科目 G 判定（飛行後檢查）。 */
export function judgeSubjectG(log: GroundCheckLog): SubjectGResult {
  const touched = log.stations.length > 0 || Object.keys(log.checklist).length > 0;
  if (!touched) return emptyGResult();

  const checks: JudgmentCheck[] = [];
  const failReasonKeys: string[] = [];

  // ① 逆時針繞行。
  const ccw = isWalkaroundCCW(log.stations);
  checks.push({
    key: 'subjectG.walkaround',
    passed: ccw,
    detail: `到訪順序 ${log.stations.map(stationLabel).join('→') || '—'}`,
  });
  if (!ccw) failReasonKeys.push('subjectG.walkaroundFail');

  // ② 附件3 飛行後欄全部「是」。
  const postOk = CHECKLIST_ITEMS.filter((it) => log.checklist[it.id]?.post === true).length;
  const postPass = postOk === CHECKLIST_ITEMS.length;
  checks.push({
    key: 'subjectG.checklist',
    passed: postPass,
    detail: `${postOk}/${CHECKLIST_ITEMS.length} 項皆「是」`,
  });
  if (!postPass) failReasonKeys.push('subjectG.checklistFail');

  const rating: ExamRating = checks.every((c) => c.passed) ? 'S' : 'U';
  return {
    rating,
    executed: true,
    checks,
    failReasonKeys: [...new Set(failReasonKeys)],
    raw: {
      stationOrder: [...log.stations],
      walkaroundCCW: ccw,
      checklistPostOk: postOk,
      checklistPostTotal: CHECKLIST_ITEMS.length,
    },
  };
}
