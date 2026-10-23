/**
 * 重大違失偵測（CAA 專業基本級術科考場模擬，majorFailures p160）。
 *
 * 官方重大違失（config.majorFailures.items，p160）共四項文字，原則「任一項即
 * 不通過」：
 *   ① 因設備或人為因素，導致考試機失控、撞擊、墜落或超越應考人後方者
 *   ② 應考人操作/漏忘，致需由測驗官從旁協助方能確保飛安者
 *   ③ 未遵守測驗秩序、規定及程序，或有肇生危安事件之虞者
 *   ④ 應考人與申請人身分不符，或涉舞弊情事者
 *
 * 本模組將「機器可客觀偵測」的子事件與官方項對應：
 *   - 撞擊  → 機體在低高度與角錐重疊（hitCone）
 *   - 墜落  → 高度跌破地面（crash，y < 門檻）
 *   - 超越應考人後方 → 飛越應考人後方界線（beyondExamineeRear；官方站位距離
 *     未確認前為「警示」，不計入否決，見 WARNING_ONLY_AUTO_CODES）
 *   - 失控/越區 → 離開操作區邊界（outOfOperationArea，監理空域強約束）
 * ②③④ 三項須由監評人員認定（手動旗標），無法由飛行樣本自動判定。
 *
 * 判定為「模擬輔助」，非官方測驗結果；原始量測一併記錄供人工審閱。
 *
 * 純函式分析：輸入飛行樣本（FlightSample[]）+ 考場幾何（ExamField），不依賴
 * DOM/Three.js，可單元測試。
 */

import type { ExamField } from './field';
import { hitsAnyCone, isBehindExaminee, isWithinOperationArea } from './field';
import type { FlightSample } from './subjects';

/** 機器自動偵測的重大違失代碼（對應官方項①之子事件）。 */
export type MajorFailureAutoCode =
  | 'outOfOperationArea'
  | 'hitCone'
  | 'crash'
  | 'beyondExamineeRear';

/** 需監評人員認定的手動重大違失代碼（官方項②③④）。 */
export type MajorFailureManualCode = 'examinerIntervene' | 'disorder' | 'identityFraud';

export type MajorFailureCode = MajorFailureAutoCode | MajorFailureManualCode;

export interface MajorFailureDetection {
  code: MajorFailureCode;
  /** i18n 鍵（zhHant.exam.majorFailure.*）。 */
  labelKey: string;
  /** 是否為機器自動偵測；false = 需監評手動認定。 */
  auto: boolean;
  detected: boolean;
  /** 量測說明（供人工審閱）。 */
  detail: string;
  page: number | null;
  /** true = 官方數值未確認前的模擬假設項：只顯示警示，不計入否決（見 simAssist.examineeRear）。 */
  warningOnly?: boolean;
}

export interface MajorFailureReport {
  /** 官方規則文字（config.majorFailures.rule）。 */
  rule: string;
  page: number | null;
  items: MajorFailureDetection[];
  /** 任一「非警示」重大違失即不通過（警示項不計入）。 */
  hasAny: boolean;
  /** 已觸發的警示項（模擬假設，非官方；不影響 simulatedPass）。 */
  warnings: MajorFailureDetection[];
}

/** 高度跌破此值視為墜地/撞擊地面（m，相對起降面）。 */
const CRASH_Y_M = -0.2;
/** 撞擊角錐的高度門檻（m）：高於此高度飛越角錐不算碰撞（角錐為地面標記）。 */
const CONE_HIT_HEIGHT_M = 0.8;

/** 官方重大違失規則與頁碼（config.majorFailures）。 */
export const MAJOR_FAILURE_RULE = '不得有任何一項重大違失（任一項即不通過）';

/**
 * 官方站位距離未確認前「僅警示、不否決」的自動偵測項。
 *
 * 「超越應考人後方」屬官方重大違失①，但附錄6 圖11（p233）未給出應考人站位
 * 精確距離（config.field.examinerPosition.examinerDistanceM=null），本模擬的
 * 站位與後方容許距離是 simAssist.examineeRear 的模擬假設。在官方數值確認前，
 * 此項只於成績單顯示「警示：疑似超越應考人後方（模擬假設）」，不計入
 * simulatedPass 否決；其他重大違失（越區／撞錐／墜落／監評手動認定）維持否決。
 */
export const WARNING_ONLY_AUTO_CODES: readonly MajorFailureAutoCode[] = ['beyondExamineeRear'];

export function isWarningOnlyMajorFailure(code: MajorFailureCode): boolean {
  return (WARNING_ONLY_AUTO_CODES as readonly MajorFailureCode[]).includes(code);
}

/** 機器可自動偵測項（對應官方項①子事件）。labelKey 待 i18n 擴充。 */
export const AUTO_MAJOR_FAILURES: ReadonlyArray<{
  code: MajorFailureAutoCode;
  labelKey: string;
  page: number | null;
}> = [
  { code: 'outOfOperationArea', labelKey: 'exam.majorFailure.outOfOperationArea', page: 160 },
  { code: 'hitCone', labelKey: 'exam.majorFailure.hitCone', page: 160 },
  { code: 'crash', labelKey: 'exam.majorFailure.crash', page: 160 },
  { code: 'beyondExamineeRear', labelKey: 'exam.majorFailure.beyondExamineeRear', page: 160 },
];

/** 需監評手動認定項（官方項②③④）。 */
export const MANUAL_MAJOR_FAILURES: ReadonlyArray<{
  code: MajorFailureManualCode;
  labelKey: string;
  page: number | null;
}> = [
  { code: 'examinerIntervene', labelKey: 'exam.majorFailure.examinerIntervene', page: 160 },
  { code: 'disorder', labelKey: 'exam.majorFailure.disorder', page: 160 },
  { code: 'identityFraud', labelKey: 'exam.majorFailure.identityFraud', page: 160 },
];

export type ManualMajorFailureFlags = Partial<Record<MajorFailureManualCode, boolean>>;

/** 單項自動偵測：離開操作區（失控/越區）。 */
function detectOutOfOperationArea(samples: FlightSample[], field: ExamField): { detected: boolean; detail: string } {
  let maxOverM = 0;
  let detected = false;
  for (const s of samples) {
    if (!isWithinOperationArea(field, s.x, s.z)) {
      detected = true;
      const overX = Math.abs(s.x) - field.operationArea.halfWidthM;
      const overZ = Math.abs(s.z) - field.operationArea.halfLengthM;
      maxOverM = Math.max(maxOverM, overX, overZ);
    }
  }
  return { detected, detail: detected ? `最大越界 ${maxOverM.toFixed(2)}m` : '—' };
}

/** 單項自動偵測：撞擊角錐（低高度與任一角錐重疊）。 */
function detectHitCone(samples: FlightSample[], field: ExamField): { detected: boolean; detail: string } {
  const hitIds = new Set<string>();
  for (const s of samples) {
    if (s.y <= CONE_HIT_HEIGHT_M) {
      const id = hitsAnyCone(field, s.x, s.z);
      if (id) hitIds.add(id);
    }
  }
  return { detected: hitIds.size > 0, detail: hitIds.size > 0 ? `撞擊 ${[...hitIds].join('/')}` : '—' };
}

/** 單項自動偵測：墜落（高度跌破地面）。 */
function detectCrash(samples: FlightSample[], _field: ExamField): { detected: boolean; detail: string } {
  let minY = 0;
  let detected = false;
  for (const s of samples) {
    if (s.y < minY) minY = s.y;
    if (s.y < CRASH_Y_M) detected = true;
  }
  return { detected, detail: detected ? `最低高度 ${minY.toFixed(2)}m` : '—' };
}

/** 單項自動偵測：超越應考人後方。 */
function detectBeyondExamineeRear(samples: FlightSample[], field: ExamField): { detected: boolean; detail: string } {
  let maxZ = -Infinity;
  let detected = false;
  for (const s of samples) {
    if (s.z > maxZ) maxZ = s.z;
    if (isBehindExaminee(field, s.z)) detected = true;
  }
  return { detected, detail: detected ? `最遠後方 z=${maxZ.toFixed(2)}m（界線 ${field.behindLimitZ.toFixed(2)}m）` : '—' };
}

/**
 * 偵測全部自動重大違失（官方項①之子事件）。
 * 回傳四項偵測結果（detected + 量測細節）。
 */
export function detectAutoMajorFailures(
  samples: FlightSample[],
  field: ExamField,
): MajorFailureDetection[] {
  const oa = detectOutOfOperationArea(samples, field);
  const hc = detectHitCone(samples, field);
  const cr = detectCrash(samples, field);
  const br = detectBeyondExamineeRear(samples, field);

  const build = (
    code: MajorFailureAutoCode,
    detail: string,
    detected: boolean,
  ): MajorFailureDetection => {
    const meta = AUTO_MAJOR_FAILURES.find((a) => a.code === code)!;
    return {
      code,
      labelKey: meta.labelKey,
      auto: true,
      detected,
      detail,
      page: meta.page,
      warningOnly: isWarningOnlyMajorFailure(code),
    };
  };

  return [
    build('outOfOperationArea', oa.detail, oa.detected),
    build('hitCone', hc.detail, hc.detected),
    build('crash', cr.detail, cr.detected),
    build('beyondExamineeRear', br.detail, br.detected),
  ];
}

/**
 * 彙整重大違失報告：自動偵測項 + 監評手動旗標。
 * 任一項 detected → hasAny = true（即不通過）。
 *
 * @param samples 飛行樣本
 * @param field   考場幾何
 * @param manual  監評手動認定的重大違失（官方項②③④）
 * @param rule    官方規則文字（來自 config.majorFailures.rule）
 * @param page    官方頁碼（config.majorFailures.page）
 */
export function detectMajorFailures(
  samples: FlightSample[],
  field: ExamField,
  manual: ManualMajorFailureFlags = {},
  rule: string = MAJOR_FAILURE_RULE,
  page: number | null = 160,
): MajorFailureReport {
  const auto = detectAutoMajorFailures(samples, field);

  const manualItems: MajorFailureDetection[] = MANUAL_MAJOR_FAILURES.map((m) => ({
    code: m.code,
    labelKey: m.labelKey,
    auto: false,
    detected: manual[m.code] === true,
    detail: manual[m.code] === true ? '監評認定' : '—',
    page: m.page,
  }));

  const items = [...auto, ...manualItems];
  return {
    rule,
    page,
    items,
    // 警示項（模擬假設、官方數值未確認）不計入否決；其餘任一項即不通過。
    hasAny: items.some((i) => i.detected && !i.warningOnly),
    warnings: items.filter((i) => i.warningOnly && i.detected),
  };
}
