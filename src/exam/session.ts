/**
 * 考試會話錄製（CAA 專業基本級術科模擬）。
 *
 * 職責：在考試進行期間每幀記錄飛行樣本（FlightSample），並累積航跡點（供回放）；
 * 考試結束時彙整——呼叫科目 B/C 判定、重大違失偵測，並建構仿附錄5 成績單。
 *
 * 本模組為純資料彙整，不依賴 DOM/Three.js（渲染回放由 scene.appendTrajectory 負責）。
 */

import type { ExamConfig } from './config';
import type { ExamField } from './field';
import type { FlightSample, SubjectBResult, SubjectCResult } from './subjects';
import { judgeSubjectB, judgeSubjectC } from './subjects';
import { detectMajorFailures, type MajorFailureReport, type ManualMajorFailureFlags } from './major-failures';
import { buildExamReport, type ExamReport } from './scoring';

export interface TrajectoryPoint {
  x: number;
  z: number;
  y: number;
}

export interface FinalizeOptions {
  headerValues?: Record<string, string>;
  manualMajorFailures?: ManualMajorFailureFlags;
}

export interface ExamSessionResult {
  subjectB: SubjectBResult;
  subjectC: SubjectCResult;
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

  /** 每幀記錄一筆飛行樣本（snapshot）。 */
  record(sample: FlightSample): void {
    if (this.startedAtMs === 0) this.startedAtMs = Date.now();
    this.samples.push(sample);
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
    this.startedAtMs = 0;
    this.endedAtMs = 0;
  }

  /**
   * 彙整考試結果：科目判定 + 重大違失 + 成績單。
   * @param config 考場設定
   * @param field  考場幾何
   */
  finalize(config: ExamConfig, field: ExamField, options: FinalizeOptions = {}): ExamSessionResult {
    this.endedAtMs = Date.now();
    const subjectB = judgeSubjectB(this.samples, config, field);
    const subjectC = judgeSubjectC(this.samples, config, field);
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
