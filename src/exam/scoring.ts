/**
 * 成績單 / 術科測驗報告表（CAA 專業基本級術科模擬，附錄5 p220）。
 *
 * 本模組為「純函式」報告建構：輸入科目 B/C 判定結果、重大違失報告與考場設定，
 * 產出仿附錄5 的七項 S/U/N 表 + 重大違失欄 + 總評。不依賴 DOM/Three.js。
 *
 * 重要：
 *  - 附錄5 七項中，本模擬僅實作 B（定點起降及四面停懸）與 C（8字水平圓）的
 *    自動判定；其餘五項（飛行前/後檢查、側面停懸、高度保持五邊、緊急處置）
 *    非本模擬涵蓋，標記為「未涵蓋（N）」並附註，絕不自創及格線。
 *  - 總評區分兩層：
 *      · officialPassStandard：附錄5 原文「所有項目皆為 S（無 U、無重大違失）」；
 *      · simulatedPass：本模擬評判，僅看已實作之 B、C 與重大違失，供教學練習用。
 *  - 所有 S/U/N 均為「模擬判定，非官方測驗結果」（config.scoring.judgmentLabel）。
 */

import type { ExamConfig } from './config';
import { REPORT_ITEMS } from './config';
import type { SubjectBResult, SubjectCResult, ExamRating } from './subjects';
import type { MajorFailureReport } from './major-failures';

/** 附錄5 七項中，本模擬實作自動判定的項目索引（依 config.reportForm.items 順序）。 */
const SUBJECT_B_REPORT_INDEX = 1; // 定點起降及四面停懸
const SUBJECT_C_REPORT_INDEX = 2; // 8字水平圓

export interface ExamReportHeaderField {
  field: string;
  value: string;
}

export interface ExamReportItem {
  name: string;
  rating: ExamRating | null;
  note: string;
  /** 是否為本模擬實作自動判定之項目。 */
  simulated: boolean;
}

export interface ExamReportMajorFailure {
  rule: string;
  hasAny: boolean;
  items: Array<{
    labelKey: string;
    detected: boolean;
    detail: string;
    auto: boolean;
  }>;
}

export interface ExamReport {
  /** 來源文件標註。 */
  source: string;
  page: number;
  /** 鑑別標示：模擬判定，非官方。 */
  judgmentLabel: string;
  ratings: Record<'S' | 'U' | 'N', string>;
  header: ExamReportHeaderField[];
  /** 測驗起/迄時間（本模擬錄製時間）。 */
  testTime: { from: string; to: string };
  /** 附錄5 七項。 */
  items: ExamReportItem[];
  majorFailure: ExamReportMajorFailure;
  /** 官方通過標準文字（附錄5）。 */
  officialPassStandard: string;
  /** 本模擬評判（僅看 B/C + 重大違失）。 */
  simulatedPass: boolean;
  simulatedPassDetail: string;
  /** 測驗備註（附錄5 testNote，如 □一般測驗 □定位模式）。 */
  testNote: string;
  signatures: string[];
}

export interface BuildExamReportParams {
  config: ExamConfig;
  subjectB: SubjectBResult | null;
  subjectC: SubjectCResult | null;
  majorFailure: MajorFailureReport;
  headerValues?: Record<string, string>;
  testTime?: { from: string; to: string };
}

function ratingOf(subject: SubjectBResult | SubjectCResult | null): ExamRating | null {
  if (!subject) return null;
  // 未執行（N）以 rating 直接表達；executed=false 時 rating 已為 'N'。
  return subject.rating;
}

/**
 * 建構仿附錄5 術科測驗報告表。
 */
export function buildExamReport(params: BuildExamReportParams): ExamReport {
  const { config, subjectB, subjectC, majorFailure } = params;
  const headerValues = params.headerValues ?? {};
  const testTime = params.testTime ?? { from: '—', to: '—' };

  const rf = config.reportForm;
  const sc = config.scoring;

  // 表頭欄位（附錄5 headerFields：測驗日期/申請人姓名/身分證字號/測驗級別）。
  const header: ExamReportHeaderField[] = rf.headerFields.map((field) => ({
    field,
    value: headerValues[field] ?? '—',
  }));

  // 七項：先全填 N（未執行/未涵蓋），再覆寫 B、C。
  const items: ExamReportItem[] = REPORT_ITEMS.map((name) => ({
    name,
    rating: null,
    note: '本模擬未涵蓋',
    simulated: false,
  }));
  const setItem = (idx: number, rating: ExamRating | null, note: string, simulated: boolean): void => {
    items[idx] = { name: REPORT_ITEMS[idx], rating, note, simulated };
  };
  if (subjectB) {
    setItem(SUBJECT_B_REPORT_INDEX, ratingOf(subjectB), subjectB.executed ? '自動判定' : '未執行（未起飛）', true);
  }
  if (subjectC) {
    setItem(SUBJECT_C_REPORT_INDEX, ratingOf(subjectC), subjectC.executed ? '自動判定' : '未執行（未起飛）', true);
  }

  // 本模擬評判：已實作之 B、C 皆為 S 且無重大違失。
  const bOk = subjectB !== null && subjectB.rating === 'S';
  const cOk = subjectC !== null && subjectC.rating === 'S';
  const simulatedPass = bOk && cOk && !majorFailure.hasAny;

  const reasons: string[] = [];
  if (!bOk) reasons.push(subjectB ? `科目B=${subjectB.rating}` : '科目B=未測');
  if (!cOk) reasons.push(subjectC ? `科目C=${subjectC.rating}` : '科目C=未測');
  if (majorFailure.hasAny) reasons.push('有重大違失');
  const simulatedPassDetail = simulatedPass
    ? '本模擬評判：科目 B、C 均 S 且無重大違失'
    : `本模擬評判：不通過（${reasons.join('；')}）`;

  return {
    source: rf.source,
    page: rf.page,
    judgmentLabel: sc.judgmentLabel,
    ratings: sc.ratings,
    header,
    testTime,
    items,
    majorFailure: {
      rule: majorFailure.rule,
      hasAny: majorFailure.hasAny,
      items: majorFailure.items.map((i) => ({
        labelKey: i.labelKey,
        detected: i.detected,
        detail: i.detail,
        auto: i.auto,
      })),
    },
    officialPassStandard: sc.passStandard,
    simulatedPass,
    simulatedPassDetail,
    testNote: rf.testNote,
    signatures: rf.signatures,
  };
}
