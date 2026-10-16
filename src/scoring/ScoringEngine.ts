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
      capReason = `发生碰撞，总分受限（最高 ${config.capCollisionTotal} 分）`;
    } else if (session.missionFailed && total > config.capFailedTotal) {
      total = config.capFailedTotal;
      capped = true;
      capReason = `任务失败，总分受限（最高 ${config.capFailedTotal} 分）`;
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
    const label = '任务完成';

    if (session.missionFailed) {
      return makeDimension(label, max, max * this.config.failedMissionRatio, ['任务失败，巡检未完成'], this.config);
    }

    if (session.reachedInspectionComplete) {
      if (session.missionFinalState === 'COMPLETE') {
        return makeDimension(label, max, max, ['完成全部巡检步骤并安全降落'], this.config);
      }
      // Evidence obtained, but the return/land steps were skipped.
      return makeDimension(label, max, max * INCOMPLETE_LANDING_RATIO, ['巡检取证已完成，但未按流程返航降落'], this.config);
    }

    const reference = INSPECTION_COMPLETE_INDEX > 0 ? INSPECTION_COMPLETE_INDEX : 1;
    const ratio = clamp(session.missionBestStepIndex / reference, 0, 1) * this.config.incompleteStepRatio;
    const stepLabel =
      MISSION_STATE_LABEL[MISSION_STEP_ORDER[Math.min(session.missionBestStepIndex, MISSION_STEP_ORDER.length - 1)] as MissionState] ?? '未知步骤';
    return makeDimension(
      label,
      max,
      max * ratio,
      [`任务未完成：最远到达「${stepLabel}」步骤（${session.missionBestStepIndex + 1} / ${reference + 1} 步）`],
      this.config,
    );
  }

  // --- B. Flight safety ------------------------------------------------------

  private scoreFlightSafety(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.flightSafety;
    const label = '飞行安全';

    let score = max;
    const reasons: string[] = [];

    const collisions = session.hazardEpisodes.filter((episode) => episode.state === 'COLLISION');
    const dangers = session.hazardEpisodes.filter((episode) => episode.state === 'DANGER');
    const warnings = session.hazardEpisodes.filter((episode) => episode.state === 'WARNING');
    const dangerSeconds = dangers.reduce((sum, episode) => sum + episode.durationMs, 0) / 1000;
    const warningSeconds = warnings.reduce((sum, episode) => sum + episode.durationMs, 0) / 1000;

    if (collisions.length > 0) {
      score -= collisions.length * config.collisionPenalty;
      reasons.push(`发生 ${collisions.length} 次碰撞`);
    }
    if (dangers.length > 0) {
      score -= dangers.length * config.dangerEpisodePenalty;
      score -= dangerSeconds * config.dangerSecondPenalty;
      reasons.push(`发生 ${dangers.length} 次 DANGER（危险接近），累计 ${dangerSeconds.toFixed(1)} 秒`);
      if (dangerSeconds >= config.severeDangerSeconds) {
        score -= config.severeDangerPenalty;
        reasons.push('DANGER 累计时间过长，属于严重违规');
      }
    }
    if (warnings.length > 0) {
      score -= warnings.length * config.warningEpisodePenalty;
      score -= warningSeconds * config.warningSecondPenalty;
      reasons.push(`发生 ${warnings.length} 次 WARNING，累计 ${warningSeconds.toFixed(1)} 秒`);
    }
    if (reasons.length === 0) {
      reasons.push('全程保持安全距离，未触发 WARNING / DANGER / COLLISION');
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- C. Inspection position -------------------------------------------------

  private scoreInspectionPosition(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.inspectionPosition;
    const label = '巡检位置';
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
        reasons.push(`拍摄距离 ${distance.toFixed(1)} m 偏离理想距离 ${config.idealDistanceM} m`);
      }
      if (validAttempt.photoValidation.angleErrorDeg > config.goodAngleErrorDeg) {
        reasons.push(`最终拍摄角度偏差 ${validAttempt.photoValidation.angleErrorDeg.toFixed(1)}°`);
      }
    } else if (session.enteredInspectionZone) {
      score = max * config.zoneWithoutPhotoRatio;
      reasons.push('进入过巡检拍摄区，但未获得有效照片');
    } else {
      score = max * config.neverZoneRatio;
      reasons.push('未进入巡检拍摄区');
    }

    if (unsafeShot) {
      score -= config.unsafeShotPenalty;
      reasons.push(`第 ${unsafeShot.index} 次拍摄时处于 ${unsafeShot.safetyState} 危险位置`);
    }

    if (reasons.length === 0) {
      reasons.push(`在巡检区内以合理距离（${config.idealDistanceM} m 左右）对准目标拍摄`);
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- D. Photo quality -------------------------------------------------------

  private scorePhotoQuality(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.photoQuality;
    const label = '照片质量';

    const attempts = session.captureAttempts;
    if (attempts.length === 0) {
      return makeDimension(label, max, 0, ['未拍摄任何照片'], config);
    }

    const validIndex = attempts.map((attempt) => attempt.photoValidation.valid).lastIndexOf(true);
    if (validIndex < 0) {
      const last = attempts[attempts.length - 1];
      return makeDimension(
        label,
        max,
        0,
        [`最终照片不合格：${last.photoValidation.reasons.join('；') || '未说明原因'}`],
        config,
      );
    }

    const final = attempts[validIndex];
    const failedBefore = attempts.slice(0, validIndex).filter((attempt) => !attempt.photoValidation.valid).length;

    let score = max;
    const reasons: string[] = [`共拍摄 ${attempts.length} 次，最终照片合格`];
    if (failedBefore > 0) {
      score -= failedBefore * config.failedAttemptPenalty;
      reasons.push(`其中 ${failedBefore} 次不合格（已重拍修正）`);
    }

    const photo = final.photoValidation;
    if (photo.coverageRatio < config.goodCoverageRatio) {
      score -= config.lowCoveragePenalty;
      reasons.push(`目标占比偏小（${Math.round(photo.coverageRatio * 100)}%）`);
    }
    if (photo.angleErrorDeg > config.goodAngleErrorDeg) {
      score -= config.offAnglePenalty;
      reasons.push(`瞄准偏差 ${photo.angleErrorDeg.toFixed(1)}° 偏大`);
    }
    const offIdeal = Math.abs(photo.distanceToTarget - config.idealDistanceM) > config.idealDistanceToleranceM;
    if (offIdeal) {
      score -= config.offIdealDistancePenalty;
      reasons.push(`拍摄距离 ${photo.distanceToTarget.toFixed(1)} m 偏离理想值`);
    }

    // A valid photo never falls below the floor; quality is still told apart.
    const floor = max * config.validPhotoFloorRatio;
    score = Math.max(score, floor);
    if (score >= max) {
      reasons.length = 0;
      reasons.push('目标完整进入画面，距离和角度合格');
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- E. Flight efficiency ---------------------------------------------------

  private scoreFlightEfficiency(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.flightEfficiency;
    const label = '飞行效率';

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

    const reasons: string[] = [`实际航程 ${session.pathLengthM.toFixed(1)} m / 基本航程 ${required.toFixed(1)} m（${ratio.toFixed(2)} 倍）`];
    if (ratio > config.goodPathRatio) {
      reasons.push('航线绕行较多');
    }

    const durationSec = session.durationMs / 1000;
    if (durationSec > config.maxDurationSec) {
      score -= config.overtimePenalty;
      reasons.push(`任务耗时 ${Math.floor(durationSec / 60)} 分 ${Math.round(durationSec % 60)} 秒，超出教学时长`);
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- F. Control stability ---------------------------------------------------

  private scoreControlStability(session: ScoreSession): ScoreDimension {
    const config = this.config;
    const max = config.weights.controlStability;
    const label = '操纵稳定性';

    let score = max;
    const reasons: string[] = [];

    if (session.fullStickCount > config.goodFullStickCount) {
      score -= (session.fullStickCount - config.goodFullStickCount) * config.fullStickPenalty;
      reasons.push(`大幅满杆 ${session.fullStickCount} 次`);
    }
    if (session.inputReversalCount > config.goodReversalCount) {
      score -= (session.inputReversalCount - config.goodReversalCount) * config.reversalPenalty;
      reasons.push(`高频反复修正 ${session.inputReversalCount} 次`);
    }
    if (session.hoverSampleCount > 0 && session.hoverInputDeviation > config.goodHoverDeviation) {
      const over = (session.hoverInputDeviation - config.goodHoverDeviation) / config.goodHoverDeviation;
      score -= config.hoverDeviationPenalty * over;
      reasons.push(`悬停阶段输入波动较大（平均幅度 ${session.hoverInputDeviation.toFixed(2)}）`);
    }
    if (reasons.length === 0) {
      reasons.push('操纵输入平稳，无大幅满杆与反复修正');
    }

    return makeDimension(label, max, score, reasons, config);
  }

  // --- Issues and suggestions --------------------------------------------------

  private buildMajorIssues(session: ScoreSession, collisionCount: number, capped: boolean, capReason: string | null): string[] {
    const issues: string[] = [];
    if (capped && capReason) issues.push(capReason);
    if (collisionCount > 0 && !capped) issues.push(`发生 ${collisionCount} 次碰撞`);

    const dangers = session.hazardEpisodes.filter((episode) => episode.state === 'DANGER');
    if (dangers.length > 0) {
      issues.push(`发生 ${dangers.length} 次 DANGER 危险接近`);
    }
    if (!session.reachedInspectionComplete && !session.missionFailed) {
      issues.push('任务未完成：未取得巡检取证');
    }
    const hasValid = session.captureAttempts.some((attempt) => attempt.photoValidation.valid);
    if (!hasValid && session.captureAttempts.length > 0) {
      issues.push('未获得有效巡检照片');
    }

    const horizontal = Math.hypot(
      session.targetPosition.x - session.homePoint.x,
      session.targetPosition.z - session.homePoint.z,
    );
    const required = Math.max(session.maxAltitudeM + 2 * horizontal, 1);
    if (session.pathLengthM / required >= this.config.badPathRatio) {
      issues.push('航线绕行明显过多');
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
      suggestions.push('发生碰撞：总分已按安全规则限制，请先在空旷区练习悬停与航线保持，再重新巡检。');
    } else if (session.missionFailed) {
      suggestions.push('任务未完成即结束：请按清单逐步执行，完成取证后再返航。');
    }

    const dangerSeconds =
      session.hazardEpisodes
        .filter((episode) => episode.state === 'DANGER')
        .reduce((sum, episode) => sum + episode.durationMs, 0) / 1000;
    if (dangerSeconds > 0) {
      suggestions.push('接近导线或杆塔时距离过近，建议提前减速并保持安全距离。');
    }

    const validIndex = session.captureAttempts.map((attempt) => attempt.photoValidation.valid).lastIndexOf(true);
    if (validIndex < 0) {
      if (session.captureAttempts.length > 0) {
        suggestions.push('未获得合格照片：请检查拍摄距离、云台角度与安全位置后重拍。');
      } else if (!session.missionFailed) {
        suggestions.push('未拍摄巡检照片：进入拍摄区并对准绝缘子串后再按拍摄。');
      }
    } else {
      const firstInvalid = session.captureAttempts
        .slice(0, validIndex)
        .find((attempt) => !attempt.photoValidation.valid);
      if (firstInvalid) {
        suggestions.push('首次拍照不合格后已重拍成功：建议先稳定悬停，再微调云台拍摄。');
      }
    }

    const horizontal = Math.hypot(
      session.targetPosition.x - session.homePoint.x,
      session.targetPosition.z - session.homePoint.z,
    );
    const required = Math.max(session.maxAltitudeM + 2 * horizontal, 1);
    if (session.pathLengthM / required > config.goodPathRatio) {
      suggestions.push('航线绕行较多，可提前规划接近路线。');
    }

    if (dimensions.controlStability.status === 'POOR') {
      suggestions.push('操纵波动较大，可尝试小杆量、短行程修正。');
    }

    if (suggestions.length === 0) {
      const minutes = Math.floor(session.durationMs / MINUTE_MS);
      suggestions.push(
        minutes > 0
          ? `操作流畅，${minutes} 分 ${Math.round((session.durationMs % MINUTE_MS) / 1000)} 秒完成巡检，保持当前节奏。`
          : '操作流畅，保持当前节奏。',
      );
    }

    return suggestions.slice(0, 3);
  }
}
