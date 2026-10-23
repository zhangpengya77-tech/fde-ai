/**
 * 成績單 / 術科測驗報告表（CAA 專業基本級術科模擬，附錄5 p220）。
 *
 * 本模組為「純函式」報告建構：輸入科目 B/C 判定結果、重大違失報告與考場設定，
 * 產出仿附錄5 的七項 S/U/N 表 + 重大違失欄 + 總評。不依賴 DOM/Three.js。
 *
 * 重要：
 *  - 附錄5 七項中，本模擬實作自動判定的項目：A（飛行前檢查）、B（定點起降及
 *    四面停懸）、C（8字水平圓）、D（側面停懸及前進、後退）、F（緊急處置程序，
 *    監評人員觸發）、G（飛行後檢查）；僅 E（高度保持五邊飛行）非本模擬涵蓋，
 *    標記為「未涵蓋（N）」並附註，絕不自創及格線。
 *  - 總評區分兩層：
 *      · officialPassStandard：附錄5 原文「所有項目皆為 S（無 U、無重大違失）」；
 *      · simulatedPass：本模擬評判，看已實作之 A、B、C、D、F、G 與重大違失，
 *        供教學練習用。
 *  - 所有 S/U/N 均為「模擬判定，非官方測驗結果」（config.scoring.judgmentLabel）。
 */

import type { ExamConfig } from './config';
import { REPORT_ITEMS } from './config';
import type { SubjectBResult, SubjectCResult, ExamRating } from './subjects';
import type { SubjectDResult } from './subject-d';
import type { SubjectFResult } from './subject-f';
import type { SubjectAResult, SubjectGResult } from './subject-ag';
import type { MajorFailureReport } from './major-failures';

/** 附錄5 七項中，本模擬實作自動判定的項目索引（依 config.reportForm.items 順序）。 */
const SUBJECT_A_REPORT_INDEX = 0; // 飛行前檢查
const SUBJECT_B_REPORT_INDEX = 1; // 定點起降及四面停懸
const SUBJECT_C_REPORT_INDEX = 2; // 8字水平圓
const SUBJECT_D_REPORT_INDEX = 3; // 側面停懸及前進、後退
const SUBJECT_F_REPORT_INDEX = 5; // 緊急處置程序
const SUBJECT_G_REPORT_INDEX = 6; // 飛行後檢查

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
  /** 本模擬評判（看 A/B/C/D/F/G + 重大違失）。 */
  simulatedPass: boolean;
  simulatedPassDetail: string;
  /** 測驗備註（附錄5 testNote，如 □一般測驗 □定位模式）。 */
  testNote: string;
  signatures: string[];
}

export interface BuildExamReportParams {
  config: ExamConfig;
  subjectA?: SubjectAResult | null;
  subjectB: SubjectBResult | null;
  subjectC: SubjectCResult | null;
  subjectD?: SubjectDResult | null;
  subjectF?: SubjectFResult | null;
  subjectG?: SubjectGResult | null;
  majorFailure: MajorFailureReport;
  headerValues?: Record<string, string>;
  testTime?: { from: string; to: string };
}

function ratingOf(
  subject: SubjectAResult | SubjectBResult | SubjectCResult | SubjectDResult | SubjectFResult | SubjectGResult | null,
): ExamRating | null {
  if (!subject) return null;
  // 未執行（N）以 rating 直接表達；executed=false 時 rating 已為 'N'。
  return subject.rating;
}

/**
 * 建構仿附錄5 術科測驗報告表。
 */
export function buildExamReport(params: BuildExamReportParams): ExamReport {
  const { config, subjectA, subjectB, subjectC, subjectD, subjectF, subjectG, majorFailure } = params;
  const headerValues = params.headerValues ?? {};
  const testTime = params.testTime ?? { from: '—', to: '—' };

  const rf = config.reportForm;
  const sc = config.scoring;

  // 表頭欄位（附錄5 headerFields：測驗日期/申請人姓名/身分證字號/測驗級別）。
  const header: ExamReportHeaderField[] = rf.headerFields.map((field) => ({
    field,
    value: headerValues[field] ?? '—',
  }));

  // 七項：先全填 N（未執行/未涵蓋），再覆寫 A、B、C、D、F、G。
  const items: ExamReportItem[] = REPORT_ITEMS.map((name) => ({
    name,
    rating: null,
    note: '本模擬未涵蓋',
    simulated: false,
  }));
  const setItem = (idx: number, rating: ExamRating | null, note: string, simulated: boolean): void => {
    items[idx] = { name: REPORT_ITEMS[idx], rating, note, simulated };
  };
  if (subjectA) {
    setItem(SUBJECT_A_REPORT_INDEX, ratingOf(subjectA), subjectA.executed ? '自動判定' : '未執行（未進行檢查）', true);
  }
  if (subjectB) {
    setItem(SUBJECT_B_REPORT_INDEX, ratingOf(subjectB), subjectB.executed ? '自動判定' : '未執行（未起飛）', true);
  }
  if (subjectC) {
    setItem(SUBJECT_C_REPORT_INDEX, ratingOf(subjectC), subjectC.executed ? '自動判定' : '未執行（未起飛）', true);
  }
  if (subjectD) {
    setItem(SUBJECT_D_REPORT_INDEX, ratingOf(subjectD), subjectD.executed ? '自動判定' : '未執行（未起飛）', true);
  }
  if (subjectF) {
    setItem(
      SUBJECT_F_REPORT_INDEX,
      ratingOf(subjectF),
      subjectF.executed ? '自動判定（監評人員觸發）' : '未執行（未起飛）',
      true,
    );
  }
  if (subjectG) {
    setItem(SUBJECT_G_REPORT_INDEX, ratingOf(subjectG), subjectG.executed ? '自動判定' : '未執行（未進行檢查）', true);
  }

  // 本模擬評判：已實作之 A、B、C、D、F、G 皆為 S 且無重大違失。
  const aOk = subjectA !== null && subjectA !== undefined && subjectA.rating === 'S';
  const bOk = subjectB !== null && subjectB !== undefined && subjectB.rating === 'S';
  const cOk = subjectC !== null && subjectC !== undefined && subjectC.rating === 'S';
  const dOk = subjectD !== null && subjectD !== undefined && subjectD.rating === 'S';
  const fOk = subjectF !== null && subjectF !== undefined && subjectF.rating === 'S';
  const gOk = subjectG !== null && subjectG !== undefined && subjectG.rating === 'S';
  const simulatedPass = aOk && bOk && cOk && dOk && fOk && gOk && !majorFailure.hasAny;

  const reasons: string[] = [];
  if (!aOk) reasons.push(subjectA ? `科目A=${subjectA.rating}` : '科目A=未測');
  if (!bOk) reasons.push(subjectB ? `科目B=${subjectB.rating}` : '科目B=未測');
  if (!cOk) reasons.push(subjectC ? `科目C=${subjectC.rating}` : '科目C=未測');
  if (!dOk) reasons.push(subjectD ? `科目D=${subjectD.rating}` : '科目D=未測');
  if (!fOk) reasons.push(subjectF ? `科目F=${subjectF.rating}` : '科目F=未觸發');
  if (!gOk) reasons.push(subjectG ? `科目G=${subjectG.rating}` : '科目G=未測');
  if (majorFailure.hasAny) reasons.push('有重大違失');
  const simulatedPassDetail = simulatedPass
    ? '本模擬評判：科目 A、B、C、D、F、G 均 S 且無重大違失'
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
