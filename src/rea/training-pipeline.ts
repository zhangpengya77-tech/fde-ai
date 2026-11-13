/**
 * 訓練證據管線：SitlEngine（唯讀 attach）→ telemetry_v2 觀測 → TrainingTelemetryAdapter
 * → TrainingEvidenceSample → 任務狀態機（J7）→ TRAINING_TEMPLATE 評分建議。
 *
 * 規則（P5-J7）：
 * - 只接受授權 SITL/Gateway 遙測；Session 遺失、身分不符、資料過期、序號亂序 → INVALID，之後不再累積。
 * - localSequence 是瀏覽器端序號；telemetry_v2 目前沒有 Gateway 樣本 ID，gatewaySampleId 一律留空，不得偽裝。
 * - 評分只是教學模板建議，結論固定 PENDING_TEACHER_REVIEW；不是民航局官方評分。
 */
import type { CourseResult } from './runner';
import { enuToField } from './sitl-client';
import {
  acceptEvidence, createTrainingTaskRun, invalidateForSessionLoss, startTrainingTask, transitionTrainingTask,
  type TrainingTaskRun,
} from './training-evidence';
import { scoreTrainingRun, type TrainingScore, type TrainingScoreRule } from './training-score';
import { getTrainingTemplate, type TrainingTaskId, type TrainingTemplate } from './training-template';
import {
  TrainingTelemetryAdapter, type AdapterRejectReason, type ReadOnlyLinkStatus, type ReadOnlyObservation,
  type ReadOnlyTelemetryBinding,
} from './training-telemetry-adapter';

export const TRAINING_RULE_VERSION = 'training-template-j7-1';

/** 考照科目 → 七項訓練模板（教學對應，非官方對照表）。 */
export const SUBJECT_TO_TRAINING_TASK: Record<string, TrainingTaskId> = {
  'hover-small': 'orientation', // 四面停懸＝四向定點
  hover: 'orientation',
  sideways: 'translate',
  'figure-eight': 'circle',
  'rect-small': 'waypoints',
  rect: 'waypoints',
  'five-leg': 'waypoints',
  return: 'emergency',
};

const REJECT_TEXT: Record<AdapterRejectReason, string> = {
  IDENTITY_MISMATCH: '遙測身分（Session／模擬實例／SYSID／COMPID）不符',
  LINK_STALE: '遙測連線過期',
  LINK_DISCONNECTED: 'Session 遺失（遙測斷線）',
  LINK_PENDING: '遙測尚未就緒',
  OBSERVATION_STALE: '遙測資料過期',
  LOCAL_SEQUENCE_NOT_MONOTONIC: '樣本序號未單調遞增（亂序）',
  INVALID_TELEMETRY: '遙測數值無效',
};

export interface TrainingSummary {
  classification: 'TRAINING_TEMPLATE';
  taskId: TrainingTaskId;
  taskName: string;
  status: TrainingTaskRun['status'];
  reason: string | null;
  sampleCount: number;
  /** 證據序號來源：瀏覽器端，不是 Gateway 樣本 ID */
  sequenceSource: 'BROWSER_LOCAL_SEQUENCE';
  score: TrainingScore;
}

export class TrainingEvidencePipeline {
  run: TrainingTaskRun;
  readonly template: TrainingTemplate;
  private readonly adapter: TrainingTelemetryAdapter;
  private readonly rule: TrainingScoreRule;

  constructor(readonly taskId: TrainingTaskId, binding: ReadOnlyTelemetryBinding, private readonly freshnessMs = 3_000,
              /** 考生面向（0 = 北）：安全邊界是考場座標，遙測是 ENU，需旋轉後比對 */
              private readonly facingDeg = 0) {
    const tpl = getTrainingTemplate(taskId);
    if (!tpl) throw new Error(`未知的訓練模板：${taskId}`);
    this.template = tpl;
    this.adapter = new TrainingTelemetryAdapter(binding, freshnessMs);
    this.rule = { version: TRAINING_RULE_VERSION, maxPositionDeviationM: tpl.toleranceM, maxAltitudeDeviationM: 1, maxDurationS: tpl.timeLimitS };
    this.run = startTrainingTask(createTrainingTaskRun(taskId, TRAINING_RULE_VERSION), binding.sessionId);
  }

  static forSubject(subjectId: string, binding: ReadOnlyTelemetryBinding, freshnessMs = 3_000, facingDeg = 0): TrainingEvidencePipeline | null {
    const task = SUBJECT_TO_TRAINING_TASK[subjectId];
    return task ? new TrainingEvidencePipeline(task, binding, freshnessMs, facingDeg) : null;
  }

  get terminal(): boolean {
    return ['COMPLETED', 'FAILED', 'CANCELLED', 'INVALID'].includes(this.run.status);
  }

  /** 每次收到新的唯讀觀測呼叫；回傳 accepted 或拒絕原因代碼（給畫面與測試讀）。 */
  observe(obs: ReadOnlyObservation, link: ReadOnlyLinkStatus, nowMs: number): 'accepted' | AdapterRejectReason | 'TERMINAL' {
    if (this.terminal) return 'TERMINAL';
    const res = this.adapter.accept(obs, link, nowMs);
    if (!res.accepted) {
      // 尚未就緒只是等待；其餘拒絕原因都代表證據鏈不可信 → INVALID
      if (res.reason !== 'LINK_PENDING') this.run = { ...this.run, status: 'INVALID', reason: REJECT_TEXT[res.reason] };
      return res.reason;
    }
    const b = this.template.safetyBoundary;
    const { x, y } = enuToField(res.sample.position.x, res.sample.position.y, this.facingDeg);
    const safetyEvents = x < b.xMin || x > b.xMax || y < b.yMin || y > b.yMax ? ['越出安全邊界'] : [];
    this.run = acceptEvidence(this.run, { ...res.sample, safetyEvents, taskId: this.taskId, scoringRuleVersion: TRAINING_RULE_VERSION }, this.freshnessMs, nowMs);
    return this.run.status === 'INVALID' ? 'INVALID_TELEMETRY' : 'accepted';
  }

  /** 科目結束：依課程結果轉為 COMPLETED／FAILED（已終止則不變）。 */
  finish(result: CourseResult): void {
    if (this.run.status !== 'RUNNING') return;
    this.run = result.finished && !result.failure
      ? transitionTrainingTask(this.run, 'COMPLETED')
      : transitionTrainingTask(this.run, 'FAILED', result.failure ?? '未完成全部步驟');
  }

  cancel(reason = '使用者結束或換科目'): void {
    if (this.run.status === 'RUNNING') this.run = transitionTrainingTask(this.run, 'CANCELLED', reason);
  }

  sessionLost(reason: string): void {
    this.run = invalidateForSessionLoss(this.run, reason);
  }

  summary(): TrainingSummary {
    return {
      classification: 'TRAINING_TEMPLATE', taskId: this.taskId, taskName: this.template.name,
      status: this.run.status, reason: this.run.reason, sampleCount: this.run.samples.length,
      sequenceSource: 'BROWSER_LOCAL_SEQUENCE', score: scoreTrainingRun(this.run, this.rule),
    };
  }
}

/** 匯出格式版本：欄位變動時遞增，教師端工具依此判讀 */
export const TRAINING_EXPORT_SCHEMA = 'fde-training-evidence-export/1';

/**
 * 教師唯讀匯出紀錄。
 * - 只是「供教師覆核的證據檔」，不含任何寫入授權；Gateway 沒有教師寫入端點，
 *   前端也不得以 localStorage 或旗標冒充教師核可，因此 teacherDecision 固定為 null。
 * - 不含 ticket、token 等任何秘密。
 */
export interface TrainingExportRecord {
  schema: typeof TRAINING_EXPORT_SCHEMA;
  generatedAt: string;
  subjectId: string;
  summary: TrainingSummary;
  run: TrainingTaskRun;
  teacherReview: { status: 'PENDING_TEACHER_REVIEW'; teacherDecision: null; writeAuthorization: 'NONE' };
  disclaimer: string;
}

/** 建立教師唯讀匯出紀錄（純函式，方便測試） */
export function buildTrainingExport(pipeline: TrainingEvidencePipeline, subjectId: string, now = new Date()): TrainingExportRecord {
  return {
    schema: TRAINING_EXPORT_SCHEMA,
    generatedAt: now.toISOString(),
    subjectId,
    summary: pipeline.summary(),
    // 深拷貝，避免匯出後管線再變動影響已匯出的內容
    run: JSON.parse(JSON.stringify(pipeline.run)) as TrainingTaskRun,
    teacherReview: { status: 'PENDING_TEACHER_REVIEW', teacherDecision: null, writeAuthorization: 'NONE' },
    disclaimer: '訓練模板評分建議，非民航局官方評分；證據序號為瀏覽器端序號（非 Gateway 樣本 ID）；結論須由教師覆核。',
  };
}

/** 匯出檔名：科目＋Session 前 8 碼＋時間（不含任何秘密） */
export function trainingExportFilename(rec: TrainingExportRecord): string {
  const sid = (rec.run.sessionId ?? 'no-session').slice(0, 8);
  return `fde-training-${rec.subjectId}-${sid}-${rec.generatedAt.replace(/[:.]/g, '-')}.json`;
}
