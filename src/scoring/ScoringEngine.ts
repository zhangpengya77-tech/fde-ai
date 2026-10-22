import { MISSION_STATE_LABEL, MISSION_STEP_ORDER } from '../mission/types';
import type { MissionState } from '../mission/types';
import type { ScoreSession, ScoreConfig, ScoreDimension, ScoreGrade, MissionScoreResult } from './types';
import { DEFAULT_SCORE_CONFIG } from './config';

/**
 * Deterministic teaching-score engine (V1).
 *
 * Pure logic: it consumes one `ScoreSession` - real recorded flight, hazard,
 * capture and input data - and returns a transparent `MissionScoreResult`.
 * It never reads the DOM, never reads UI text, and never uses randomness.
 *
 * Hard safety rule: a mission that collided or failed can never look like a
 * good score. The total is capped (configurable, default 59) no matter how
 * clean the other dimensions are.
 *
 * This is a TEACHING metric, not an official licence-exam standard.
 */

const MINUTE_MS = 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Round to 2 decimals so dimension sums and totals never drift. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeDimension(
  label: string,
  maxScore: number,
  rawScore: number,
  reasons: string[],
  config: ScoreConfig,
): ScoreDimension {
  const score = round2(clamp(rawScore, 0, maxScore));
  const ratio = maxScore === 0 ? 1 : score / maxScore;
  const status = ratio >= config.statusGoodRatio ? 'GOOD' : ratio >= config.statusCheckRatio ? 'CHECK' : 'POOR';
  return { label, score, maxScore, status, reasons: reasons.length > 0 ? reasons : ['—'] };
}

/** Grade band lookup (thresholds come from config). */
export function gradeForTotal(total: number, bands: ScoreConfig['gradeBands']): ScoreGrade {
  if (total >= bands.excellent) return 'EXCELLENT';
  if (total >= bands.pass) return 'PASS';
  if (total >= bands.needsPractice) return 'NEEDS_PRACTICE';
  return 'FAIL';
}

/** Index of INSPECTION_COMPLETE in the teaching step order. */
const INSPECTION_COMPLETE_INDEX = MISSION_STEP_ORDER.indexOf('INSPECTION_COMPLETE');
/** Extra ratio kept when the inspection is done but the trainee never returns/lands. */
const INCOMPLETE_LANDING_RATIO = 0.85;

export class ScoringEngine {
  constructor(readonly config: ScoreConfig = DEFAULT_SCORE_CONFIG) {}

  score(session: ScoreSession): MissionScoreResult {
    const config = this.config;

    const missionCompletion = this.scoreMissionCompletion(session);
    const flightSafety = this.scoreFlightSafety(session);
    const inspectionPosition = this.scoreInspectionPosition(session);
    const photoQuality = this.scorePhotoQuality(session);
    const flightEfficiency = this.scoreFlightEfficiency(session);
    const controlStability = this.scoreControlStability(session);

    const dimensions = {
      missionCompletion,
      flightSafety,
      inspectionPosition,
      photoQuality,
      flightEfficiency,
      controlStability,
    };

    const rawTotal = Object.values(dimensions).reduce((sum, dimension) => sum + dimension.score, 0);

    // --- Hard safety rules -------------------------------------------------
    const collisionCount = session.hazardEpisodes.filter((episode) => episode.state === 'COLLISION').length;
    let total = Math.round(rawTotal);
    let capped = false;
    let capReason: string | null = null;
    if (collisionCount > 0 && total > config.capCollisionTotal) {
      total = config.capCollisionTotal;
      capped = true;
      capReason = `發生碰撞，總分受限（最高 ${config.capCollisionTotal} 分）`;
    } else if (session.missionFailed && total > config.capFailedTotal) {
      total = config.capFailedTotal;
      capped = true;
      capReason = `任務失敗，總分受限（最高 ${config.capFailedTotal} 分）`;
    }

    const majorIssues = this.buildMajorIssues(session, collisionCount, capped, capReason);
    const suggestions = this.buildSuggestions(session, dimensions, collisionCount);

    return {
      missionId: session.missionId,
      totalScore: total,
      grade: gradeForTotal(total, config.gradeBands),
      capped,
      capReason,
      dimensions,
      majorIssues,
      suggestions,
    };
  }

  // --- A. Mission completion -------------------------------------------------

  private scoreMissionCompletion(session: ScoreSession): ScoreDimension {
    const max = this.config.weights.missionCompletion;
    const label = '任務完成';

    if (session.missionFailed) {
      return makeDimension(label, max, max * this.config.failedMissionRatio, ['任務失敗，巡檢未完成'], this.config);
    }

    if (session.reachedInspectionComplete) {
      if (session.missionFinalState === 'COMPLETE') {
        return makeDimension(label, max, max, ['完成全部巡檢步驟並安全降落'], this.config);
      }
      // Evidence obtained, but the return/land steps were skipped.
      return makeDimension(label, max, max * INCOMPLETE_LANDING_RATIO, ['巡檢取證已完成，但未按流程返航降落'], this.config);
    }

    const reference = INSPECTION_COMPLETE_INDEX > 0 ? INSPECTION_COMPLETE_INDEX : 1;
    const ratio = clamp(session.missionBestStepIndex / reference, 0, 1) * this.config.incompleteStepRatio;
    const stepLabel =
      MISSION_STATE_LABEL[MISSION_STEP_ORDER[Math.min(session.missionBestStepIndex, MISSION_STEP_ORDER.length - 1)] as MissionState] ?? '未知步驟';
    return makeDimension(
      label,
      max,
      max * ratio,
      [`任務未完成：最遠到達「${stepLabel}」步驟（${session.missionBestStepIndex + 1} / ${reference + 1} 步）`],
      this.config,
    );
  }

  // --- B. Flight safety ------------------------------------------------------

  private scoreFlightSafety(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.flightSafety;
    const label = '飛行安全';

    let score = max;
    const reasons: string[] = [];

    const collisions = session.hazardEpisodes.filter((episode) => episode.state === 'COLLISION');
    const dangers = session.hazardEpisodes.filter((episode) => episode.state === 'DANGER');
    const warnings = session.hazardEpisodes.filter((episode) => episode.state === 'WARNING');
    const dangerSeconds = dangers.reduce((sum, episode) => sum + episode.durationMs, 0) / 1000;
    const warningSeconds = warnings.reduce((sum, episode) => sum + episode.durationMs, 0) / 1000;

    if (collisions.length > 0) {
      score -= collisions.length * config.collisionPenalty;
      reasons.push(`發生 ${collisions.length} 次碰撞`);
    }
    if (dangers.length > 0) {
      score -= dangers.length * config.dangerEpisodePenalty;
      score -= dangerSeconds * config.dangerSecondPenalty;
      reasons.push(`發生 ${dangers.length} 次 DANGER（危險接近），累計 ${dangerSeconds.toFixed(1)} 秒`);
      if (dangerSeconds >= config.severeDangerSeconds) {
        score -= config.severeDangerPenalty;
        reasons.push('DANGER 累計時間過長，屬於嚴重違規');
      }
    }
    if (warnings.length > 0) {
      score -= warnings.length * config.warningEpisodePenalty;
      score -= warningSeconds * config.warningSecondPenalty;
      reasons.push(`發生 ${warnings.length} 次 WARNING，累計 ${warningSeconds.toFixed(1)} 秒`);
    }
    if (reasons.length === 0) {
      reasons.push('全程保持安全距離，未觸發 WARNING / DANGER / COLLISION');
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- C. Inspection position -------------------------------------------------

  private scoreInspectionPosition(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.inspectionPosition;
    const label = '巡檢位置';
    const reasons: string[] = [];

    const validAttempt = [...session.captureAttempts].reverse().find((attempt) => attempt.photoValidation.valid);
    const unsafeShot = session.captureAttempts.find(
      (attempt) => attempt.safetyState === 'DANGER' || attempt.safetyState === 'COLLISION',
    );

    let score: number;
    if (validAttempt) {
      score = max;
      const distance = validAttempt.photoValidation.distanceToTarget;
      const offIdeal =
        Math.abs(distance - config.idealDistanceM) > config.idealDistanceToleranceM;
      if (offIdeal) {
        score -= config.offIdealDistancePenalty;
        reasons.push(`拍攝距離 ${distance.toFixed(1)} m 偏離理想距離 ${config.idealDistanceM} m`);
      }
      if (validAttempt.photoValidation.angleErrorDeg > config.goodAngleErrorDeg) {
        reasons.push(`最終拍攝角度偏差 ${validAttempt.photoValidation.angleErrorDeg.toFixed(1)}°`);
      }
    } else if (session.enteredInspectionZone) {
      score = max * config.zoneWithoutPhotoRatio;
      reasons.push('進入過巡檢拍攝區，但未取得有效照片');
    } else {
      score = max * config.neverZoneRatio;
      reasons.push('未進入巡檢拍攝區');
    }

    if (unsafeShot) {
      score -= config.unsafeShotPenalty;
      reasons.push(`第 ${unsafeShot.index} 次拍攝時處於 ${unsafeShot.safetyState} 危險位置`);
    }

    if (reasons.length === 0) {
      reasons.push(`在巡檢區內以合理距離（${config.idealDistanceM} m 左右）對準目標拍攝`);
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- D. Photo quality -------------------------------------------------------

  private scorePhotoQuality(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.photoQuality;
    const label = '照片品質';

    const attempts = session.captureAttempts;
    if (attempts.length === 0) {
      return makeDimension(label, max, 0, ['未拍攝任何照片'], config);
    }

    const validIndex = attempts.map((attempt) => attempt.photoValidation.valid).lastIndexOf(true);
    if (validIndex < 0) {
      const last = attempts[attempts.length - 1];
      return makeDimension(
        label,
        max,
        0,
        [`最終照片不合格：${last.photoValidation.reasons.join('；') || '未說明原因'}`],
        config,
      );
    }

    const final = attempts[validIndex];
    const failedBefore = attempts.slice(0, validIndex).filter((attempt) => !attempt.photoValidation.valid).length;

    let score = max;
    const reasons: string[] = [`共拍攝 ${attempts.length} 次，最終照片合格`];
    if (failedBefore > 0) {
      score -= failedBefore * config.failedAttemptPenalty;
      reasons.push(`其中 ${failedBefore} 次不合格（已重拍修正）`);
    }

    const photo = final.photoValidation;
    if (photo.coverageRatio < config.goodCoverageRatio) {
      score -= config.lowCoveragePenalty;
      reasons.push(`目標佔比偏小（${Math.round(photo.coverageRatio * 100)}%）`);
    }
    if (photo.angleErrorDeg > config.goodAngleErrorDeg) {
      score -= config.offAnglePenalty;
      reasons.push(`瞄準偏差 ${photo.angleErrorDeg.toFixed(1)}° 偏大`);
    }
    const offIdeal = Math.abs(photo.distanceToTarget - config.idealDistanceM) > config.idealDistanceToleranceM;
    if (offIdeal) {
      score -= config.offIdealDistancePenalty;
      reasons.push(`拍攝距離 ${photo.distanceToTarget.toFixed(1)} m 偏離理想值`);
    }

    // A valid photo never falls below the floor; quality is still told apart.
    const floor = max * config.validPhotoFloorRatio;
    score = Math.max(score, floor);
    if (score >= max) {
      reasons.length = 0;
      reasons.push('目標完整進入畫面，距離和角度合格');
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- E. Flight efficiency ---------------------------------------------------

  private scoreFlightEfficiency(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.flightEfficiency;
    const label = '飛行效率';

    // Simple teaching baseline: climb + descent + there-and-back horizontal.
    // No optimal-path algorithm - this only flags obviously wasteful flying.
    const horizontal = Math.hypot(
      session.targetPosition.x - session.homePoint.x,
      session.targetPosition.z - session.homePoint.z,
    );
    const required = Math.max(session.maxAltitudeM + 2 * horizontal, 1);
    const ratio = session.pathLengthM / required;

    let score: number;
    if (ratio <= config.goodPathRatio) {
      score = max;
    } else if (ratio >= config.badPathRatio) {
      score = max * config.poorPathRatio;
    } else {
      const span = config.badPathRatio - config.goodPathRatio;
      const t = (config.badPathRatio - ratio) / span; // 1 -> full marks, 0 -> poor
      score = max * (config.poorPathRatio + (1 - config.poorPathRatio) * t);
    }

    const reasons: string[] = [`實際航程 ${session.pathLengthM.toFixed(1)} m / 基本航程 ${required.toFixed(1)} m（${ratio.toFixed(2)} 倍）`];
    if (ratio > config.goodPathRatio) {
      reasons.push('航線繞行較多');
    }

    const durationSec = session.durationMs / 1000;
    if (durationSec > config.maxDurationSec) {
      score -= config.overtimePenalty;
      reasons.push(`任務耗時 ${Math.floor(durationSec / 60)} 分 ${Math.round(durationSec % 60)} 秒，超出教學時長`);
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- F. Control stability ---------------------------------------------------

  private scoreControlStability(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.controlStability;
    const label = '操縱穩定性';

    let score = max;
    const reasons: string[] = [];

    if (session.fullStickCount > config.goodFullStickCount) {
      score -= (session.fullStickCount - config.goodFullStickCount) * config.fullStickPenalty;
      reasons.push(`大幅滿桿 ${session.fullStickCount} 次`);
    }
    if (session.inputReversalCount > config.goodReversalCount) {
      score -= (session.inputReversalCount - config.goodReversalCount) * config.reversalPenalty;
      reasons.push(`高頻反覆修正 ${session.inputReversalCount} 次`);
    }
    if (session.hoverSampleCount > 0 && session.hoverInputDeviation > config.goodHoverDeviation) {
      const over = (session.hoverInputDeviation - config.goodHoverDeviation) / config.goodHoverDeviation;
      score -= config.hoverDeviationPenalty * over;
      reasons.push(`懸停階段輸入波動較大（平均幅度 ${session.hoverInputDeviation.toFixed(2)}）`);
    }
    if (reasons.length === 0) {
      reasons.push('操縱輸入平穩，無大幅滿桿與反覆修正');
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- Issues and suggestions --------------------------------------------------

  private buildMajorIssues(session: ScoreSession, collisionCount: number, capped: boolean, capReason: string | null): string[] {
    const issues: string[] = [];
    if (capped && capReason) issues.push(capReason);
    if (collisionCount > 0 && !capped) issues.push(`發生 ${collisionCount} 次碰撞`);

    const dangers = session.hazardEpisodes.filter((episode) => episode.state === 'DANGER');
    if (dangers.length > 0) {
      issues.push(`發生 ${dangers.length} 次 DANGER 危險接近`);
    }
    if (!session.reachedInspectionComplete && !session.missionFailed) {
      issues.push('任務未完成：未取得巡檢取證');
    }
    const hasValid = session.captureAttempts.some((attempt) => attempt.photoValidation.valid);
    if (!hasValid && session.captureAttempts.length > 0) {
      issues.push('未取得有效巡檢照片');
    }

    const horizontal = Math.hypot(
      session.targetPosition.x - session.homePoint.x,
      session.targetPosition.z - session.homePoint.z,
    );
    const required = Math.max(session.maxAltitudeM + 2 * horizontal, 1);
    if (session.pathLengthM / required >= this.config.badPathRatio) {
      issues.push('航線繞行明顯過多');
    }
    return issues;
  }

  /**
   * 1-3 short teaching tips, chosen by a FIXED priority from the real scoring
   * reasons - deterministic, never random.
   */
  private buildSuggestions(
    session: ScoreSession,
    dimensions: MissionScoreResult['dimensions'],
    collisionCount: number,
  ): string[] {
    const config = this.config;
    const suggestions: string[] = [];

    if (collisionCount > 0) {
      suggestions.push('發生碰撞：總分已按安全規則限制，請先在空曠區練習懸停與航線保持，再重新巡檢。');
    } else if (session.missionFailed) {
      suggestions.push('任務未完成即結束：請按清單逐步執行，完成取證後再返航。');
    }

    const dangerSeconds =
      session.hazardEpisodes
        .filter((episode) => episode.state === 'DANGER')
        .reduce((sum, episode) => sum + episode.durationMs, 0) / 1000;
    if (dangerSeconds > 0) {
      suggestions.push('接近導線或桿塔時距離過近，建議提前減速並保持安全距離。');
    }

    const validIndex = session.captureAttempts.map((attempt) => attempt.photoValidation.valid).lastIndexOf(true);
    if (validIndex < 0) {
      if (session.captureAttempts.length > 0) {
        suggestions.push('未取得合格照片：請檢查拍攝距離、雲台角度與安全位置後重拍。');
      } else if (!session.missionFailed) {
        suggestions.push('未拍攝巡檢照片：進入拍攝區並對準絕緣子串後再按拍攝。');
      }
    } else {
      const firstInvalid = session.captureAttempts
        .slice(0, validIndex)
        .find((attempt) => !attempt.photoValidation.valid);
      if (firstInvalid) {
        suggestions.push('首次拍照不合格後已重拍成功：建議先穩定懸停，再微調雲台拍攝。');
      }
    }

    const horizontal = Math.hypot(
      session.targetPosition.x - session.homePoint.x,
      session.targetPosition.z - session.homePoint.z,
    );
    const required = Math.max(session.maxAltitudeM + 2 * horizontal, 1);
    if (session.pathLengthM / required > config.goodPathRatio) {
      suggestions.push('航線繞行較多，可提前規劃接近路線。');
    }

    if (dimensions.controlStability.status === 'POOR') {
      suggestions.push('操縱波動較大，可嘗試小桿量、短行程修正。');
    }

    if (suggestions.length === 0) {
      const minutes = Math.floor(session.durationMs / MINUTE_MS);
      suggestions.push(
        minutes > 0
          ? `操作流暢，${minutes} 分 ${Math.round((session.durationMs % MINUTE_MS) / 1000)} 秒完成巡檢，保持當前節奏。`
          : '操作流暢，保持當前節奏。',
      );
    }

    return suggestions.slice(0, 3);
  }
}
