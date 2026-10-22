import type { AxisCalibration } from '../input/InputNormalizer';

/**
 * 自動置中偏移補償（只更新 center，不動 source / reverse）。
 *
 * 真機现场：搖桿靜止值沒落在校正 center 上（例如中心偏 0.08），而死區只有
 * 0.05，歸一化後留下 0.03 的殘餘指令，飛控把它當速度目標逐帧積分 → 機體
 * 持續漂移。與「錄製建議」互補：那個改 source/reverse，這個只把 center
 * 拉回靜止位置。
 *
 * 純函式：偵測與補償值都可單獨測試；是否寫入由使用者按「校正中心」決定。
 */

/** 靜止值偏離 center 超過此值就視為中心偏移（也作為死區為 0 時的下限）。 */
export const CENTER_OFFSET_MIN = 0.05;

/** 一段樣本的最大最小差小於此值，才認為「搖桿是停著沒動」。 */
export const CENTER_PARKED_SPREAD = 0.02;

export interface CenterOffsetSample {
  /** 該功能目前偵測到的靜止原始值（樣本平均）。 */
  readonly rest: number;
  /** 偏離校正 center 的量（rest − center）。 */
  readonly deviation: number;
  /** 是否構成需要校正的偏移。 */
  readonly offCenter: boolean;
}

/**
 * 從一小段連續樣本判斷某個自回中軸是否「停在偏離中心的位置」。
 * 只有當搖桿確實停著（波動小於 CENTER_PARKED_SPREAD）且偏離超過門檻時
 * 才返回 offCenter：正在移動中的桿不算偏移，避免誤判。
 */
export function detectCenterOffset(
  samples: readonly number[],
  center: number,
  deadzone: number,
): CenterOffsetSample {
  const finite = samples.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { rest: center, deviation: 0, offCenter: false };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const rest = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const deviation = rest - center;
  const threshold = Math.max(deadzone, CENTER_OFFSET_MIN);
  const parked = max - min < CENTER_PARKED_SPREAD;
  return { rest, deviation, offCenter: parked && Math.abs(deviation) > threshold };
}

/**
 * 校正後的 center：取當前靜止原始值，並夾在已量測的 [min, max] 內，
 * 避免把 center 設到行程外（其餘校正欄位一律不動）。
 */
export function compensatedCenter(raw: number, calibration: AxisCalibration): number {
  if (!Number.isFinite(raw)) return calibration.center;
  const lo = Math.min(calibration.min, calibration.max);
  const hi = Math.max(calibration.min, calibration.max);
  return Math.min(Math.max(raw, lo), hi);
}
