/**
 * 考試會話錄製（CAA 專業基本級術科模擬）。
 *
 * 職責：在考試進行期間每幀記錄飛行樣本（FlightSample），並累積航跡點（供回放）；
 * 考試結束時彙整——呼叫科目 B/C/D 判定、重大違失偵測，並建構仿附錄5 成績單。
 *
 * 科目分段：實際考試每科為一次獨立飛行（起飛→動作→降落）。同一場次連續應考
 * 多科時，若各科判定都掃描全部樣本，科目間的直飛航段會互相污染（例如科目 D 的
 * P3↔P7 往返直線會切進科目 C 的八字盒，使 C 的路徑偏差超標）。因此錄製時以
 * startSubject() 標記樣本所屬科目，finalize() 讓各科判定只看自己的樣本切片；
 * 重大違失偵測仍看全時段（任何時刻撞圓錐／出界都是違失）。未標記任何科目時
 * （單科飛行）退回全樣本，行為與舊版一致。
 *
 * 本模組為純資料彙整，不依賴 DOM/Three.js（渲染回放由 scene.appendTrajectory 負責）。
 */

import type { ExamConfig } from './config';
import type { ExamField } from './field';
import type { FlightSample, SubjectBResult, SubjectCResult } from './subjects';
import { judgeSubjectB, judgeSubjectC } from './subjects';
import { judgeSubjectD, type SubjectDResult } from './subject-d';
import { detectMajorFailures, type MajorFailureReport, type ManualMajorFailureFlags } from './major-failures';
import { buildExamReport, type ExamReport } from './scoring';
import { loadExamLevelInfo } from './config';

export interface TrajectoryPoint {
  x: number;
  z: number;
  y: number;
}

/** 應考科目鍵（附錄5 成績單七列；A/G 為地面檢查、F 由考官觸發）。 */
export type ExamSubjectKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface FinalizeOptions {
  headerValues?: Record<string, string>;
  manualMajorFailures?: ManualMajorFailureFlags;
}

export interface ExamSessionResult {
  subjectB: SubjectBResult;
  subjectC: SubjectCResult;
  subjectD: SubjectDResult;
  majorFailure: MajorFailureReport;
  report: ExamReport;
  trajectory: TrajectoryPoint[];
  sampleCount: number;
}

export class ExamSession {
  private samples: FlightSample[] = [];
  private trajectory: TrajectoryPoint[] = [];
  private startedAtMs = 0;
  private endedAtMs = 0;
  /** 與 samples 平行的科目標籤（startSubject 之後錄製的樣本所屬科目）。 */
  private subjectTags: (ExamSubjectKey | null)[] = [];
  private currentSubject: ExamSubjectKey | null = null;
  /** 是否呼叫過 startSubject（false → 單科飛行，各科判定看全樣本）。 */
  private tagged = false;

  /**
   * 標記後續錄製樣本所屬的應考科目。
   * 實際流程：考官／學生每開始一新科目飛行時呼叫一次（起飛前）。
   */
  startSubject(key: ExamSubjectKey): void {
    this.currentSubject = key;
    this.tagged = true;
  }

  /** 目前標記的科目（未標記時為 null）。 */
  getCurrentSubject(): ExamSubjectKey | null {
    return this.currentSubject;
  }

  /** 每幀記錄一筆飛行樣本（snapshot）。 */
  record(sample: FlightSample): void {
    if (this.startedAtMs === 0) this.startedAtMs = Date.now();
    this.samples.push(sample);
    this.subjectTags.push(this.currentSubject);
    this.trajectory.push({ x: sample.x, z: sample.z, y: sample.y });
  }

  getSamples(): readonly FlightSample[] {
    return this.samples;
  }

  getTrajectory(): readonly TrajectoryPoint[] {
    return this.trajectory;
  }

  getSampleCount(): number {
    return this.samples.length;
  }

  clear(): void {
    this.samples = [];
    this.trajectory = [];
    this.subjectTags = [];
    this.currentSubject = null;
    this.tagged = false;
    this.startedAtMs = 0;
    this.endedAtMs = 0;
  }

  /**
   * 取某科目的樣本切片。
   * 未標記過科目（單科飛行）時回傳全樣本——舊行為，向後相容。
   */
  private samplesFor(key: ExamSubjectKey): FlightSample[] {
    if (!this.tagged) return [...this.samples];
    const out: FlightSample[] = [];
    for (let i = 0; i < this.samples.length; i += 1) {
      if (this.subjectTags[i] === key) out.push(this.samples[i]);
    }
    return out;
  }

  /**
   * 彙整考試結果：科目判定 + 重大違失 + 成績單。
   * @param config 考場設定
   * @param field  考場幾何
   */
  finalize(config: ExamConfig, field: ExamField, options: FinalizeOptions = {}): ExamSessionResult {
    this.endedAtMs = Date.now();
    const subjectB = judgeSubjectB(this.samplesFor('B'), config, field);
    const subjectC = judgeSubjectC(this.samplesFor('C'), config, field);
    const levelInfo = loadExamLevelInfo();
    const subjectD = judgeSubjectD(this.samplesFor('D'), config, field, {
      configRetreatDistanceM: levelInfo.retreatDistanceM,
      level: levelInfo.level,
    });
    const majorFailure = detectMajorFailures(
      this.samples,
      field,
      options.manualMajorFailures ?? {},
      config.majorFailures.rule,
      config.majorFailures.page,
    );
    const report = buildExamReport({
      config,
      subjectB,
      subjectC,
      subjectD,
      majorFailure,
      headerValues: options.headerValues,
      testTime: {
        from: this.formatTime(this.startedAtMs),
        to: this.formatTime(this.endedAtMs),
      },
    });
    return {
      subjectB,
      subjectC,
      subjectD,
      majorFailure,
      report,
      trajectory: [...this.trajectory],
      sampleCount: this.samples.length,
    };
  }

  private formatTime(ms: number): string {
    if (ms === 0) return '—';
    const d = new Date(ms);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
