import type { AxisBinding } from '../input/InputNormalizer';
import type { DeviceProfile } from '../input/device-profile';

/**
 * 錄製結果自動分析：把「右桿畫一圈（上→右→下→左）」的原始軸樣本，變成
 * pitch / roll 兩個通道的綁定建議。
 *
 * 設計邊界（與本專案其他診斷工具一致）：
 *  - 純函式：只根據實測數據推導，絕不自行套用；是否寫入由使用者按
 *    「套用建議」決定，且只改 pitch / roll 的 source 與 reverse。
 *  - 峰值 < SUGGESTION_MIN_PEAK 的軸不得列入建議（真機常見只推 0.05~0.07），
 *    並明確要求「請推到底重錄」。
 *  - 兩組若指向同一軸，視為無效：右桿上下與左右必然是兩根不同的軸。
 *
 * 方向約定（與飛控一致）：上推 = pitch 正 = 前進；右打 = roll 正 = 右移。
 * 因此「該段原始平均偏離為負」時需要 reverse=true 才能得到 +1。
 */

/** 列入建議所需的最小峰值（0..1）。 */
export const SUGGESTION_MIN_PEAK = 0.7;

/** 畫圈錄製切成 4 段，依序對應 上 / 右 / 下 / 左。 */
export const SUGGESTION_SEGMENT_COUNT = 4;
export const SUGGESTION_SEGMENT_LABELS = ['上', '右', '下', '左'] as const;

/** 單段平均偏離小於此值視為「這段沒動這根軸」（避免斜向雜訊當成訊號）。 */
const SEGMENT_MEAN_EPSILON = 0.2;

export interface StickSuggestion {
  readonly fn: 'pitch' | 'roll';
  /** 人類可讀的動作名稱，例如「右桿上下」。 */
  readonly label: string;
  /** 動作描述，例如「推上」。 */
  readonly action: string;
  /** 建議綁定的軸；null 表示這組沒有有效資料。 */
  readonly axis: number | null;
  /** 該軸在整段錄製中的峰值（max |值 − 起始值|）。 */
  readonly peak: number;
  /** 建議的 reverse（true = 需要反向才能讓該動作得到 +1）。 */
  readonly reverse: boolean;
  /** 該段原始平均偏離的符號：+1 / -1 / 0。 */
  readonly sign: number;
  readonly valid: boolean;
  /** 無效原因（峰值不足、未偵測到軸…）。 */
  readonly reason: string | null;
}

export interface BindingSummary {
  readonly source: number;
  readonly reverse: boolean;
}

export interface RecordingSuggestion {
  /** 兩組都有效且不是同一軸時才為 true（此時才允許「套用建議」）。 */
  readonly ok: boolean;
  readonly pitch: StickSuggestion;
  readonly roll: StickSuggestion;
  /** 兩組指向同一軸（無效，必須重錄）。 */
  readonly sameAxis: boolean;
  /** 不可套用時的重錄提示。 */
  readonly retryHint: string | null;
  /** 分析時的目前綁定（供比對）。 */
  readonly current: { pitch: BindingSummary; roll: BindingSummary } | null;
  /** 建議與目前綁定是否一致。 */
  readonly matches: { pitch: boolean; roll: boolean };
}

/** 每個軸的峰值（max |值 − 起始值|），索引即軸編號。 */
export function axisPeaks(samples: readonly (readonly number[])[]): number[] {
  const axisCount = samples.length > 0 ? Math.min(samples[0].length, 8) : 0;
  const peaks: number[] = [];
  for (let axis = 0; axis < axisCount; axis += 1) {
    let start = Number.NaN;
    let peak = 0;
    for (const sample of samples) {
      const value = sample[axis];
      if (!Number.isFinite(value)) continue;
      if (!Number.isFinite(start)) start = value;
      peak = Math.max(peak, Math.abs(value - start));
    }
    peaks.push(peak);
  }
  return peaks;
}

/** 每根軸在 4 個段落中的平均偏離（相對該軸起始值）：[axis][segment]。 */
export function segmentMeanDeviations(samples: readonly (readonly number[])[]): number[][] {
  const axisCount = samples.length > 0 ? Math.min(samples[0].length, 8) : 0;
  const result: number[][] = [];
  for (let axis = 0; axis < axisCount; axis += 1) {
    const sums = new Array<number>(SUGGESTION_SEGMENT_COUNT).fill(0);
    const counts = new Array<number>(SUGGESTION_SEGMENT_COUNT).fill(0);
    let start = Number.NaN;
    samples.forEach((sample, index) => {
      const value = sample[axis];
      if (!Number.isFinite(value)) return;
      if (!Number.isFinite(start)) start = value;
      const segment = Math.min(
        SUGGESTION_SEGMENT_COUNT - 1,
        Math.floor((index / Math.max(samples.length, 1)) * SUGGESTION_SEGMENT_COUNT),
      );
      sums[segment] += value - start;
      counts[segment] += 1;
    });
    result.push(sums.map((sum, segment) => (counts[segment] > 0 ? sum / counts[segment] : 0)));
  }
  return result;
}

function invalidSuggestion(
  fn: 'pitch' | 'roll',
  label: string,
  action: string,
  reason: string,
): StickSuggestion {
  return { fn, label, action, axis: null, peak: 0, reverse: false, sign: 0, valid: false, reason };
}

function summary(binding: AxisBinding): BindingSummary {
  return { source: binding.source, reverse: Boolean(binding.calibration.reverse) };
}

/**
 * 從錄製樣本推導 pitch / roll 建議。
 *
 * @param samples 每幀的原始軸值陣列（錄製期間累積）。
 * @param current 分析時的目前綁定（pitch / roll）；null 表示尚未連接。
 */
export function suggestFromRecording(
  samples: readonly (readonly number[])[],
  current: { pitch: AxisBinding; roll: AxisBinding } | null,
): RecordingSuggestion {
  const currentSummary = current ? { pitch: summary(current.pitch), roll: summary(current.roll) } : null;
  const axisCount = samples.length > 0 ? Math.min(samples[0].length, 8) : 0;
  const retry = (hint: string): RecordingSuggestion => ({
    ok: false,
    pitch: invalidSuggestion('pitch', '右桿上下', '推上', hint),
    roll: invalidSuggestion('roll', '右桿左右', '右打', hint),
    sameAxis: false,
    retryHint: hint,
    current: currentSummary,
    matches: { pitch: false, roll: false },
  });

  if (samples.length < 8 || axisCount === 0) {
    return retry('錄製樣本不足（時間太短或未偵測到軸），請重新錄製 10 秒。');
  }

  const peaks = axisPeaks(samples);
  const segments = segmentMeanDeviations(samples);

  /** 在指定段落中找出平均偏離最大的軸；峰值不足或該段沒動的軸一律不列入。 */
  const pick = (segment: number, exclude: number | null): { axis: number; sign: number } | null => {
    let best: { axis: number; sign: number; magnitude: number } | null = null;
    for (let axis = 0; axis < axisCount; axis += 1) {
      if (exclude !== null && axis === exclude) continue;
      if (peaks[axis] < SUGGESTION_MIN_PEAK) continue;
      const mean = segments[axis]?.[segment] ?? 0;
      const magnitude = Math.abs(mean);
      if (magnitude < SEGMENT_MEAN_EPSILON) continue;
      if (!best || magnitude > best.magnitude) best = { axis, sign: Math.sign(mean), magnitude };
    }
    return best ? { axis: best.axis, sign: best.sign } : null;
  };

  const notFound = (label: string): string =>
    `未偵測到峰值 ≥ ${SUGGESTION_MIN_PEAK.toFixed(2)} 的軸對應「${label}」：請推到底重錄。`;

  const vertical = pick(0, null);
  const pitch: StickSuggestion = vertical
    ? {
        fn: 'pitch',
        label: '右桿上下',
        action: '推上',
        axis: vertical.axis,
        peak: peaks[vertical.axis],
        // 上推要得到 pitch +1：原始為負就必須 reverse。
        reverse: vertical.sign < 0,
        sign: vertical.sign,
        valid: true,
        reason: null,
      }
    : invalidSuggestion('pitch', '右桿上下', '推上', notFound('右桿上下'));

  const horizontal = vertical ? pick(1, vertical.axis) : null;
  const roll: StickSuggestion = horizontal
    ? {
        fn: 'roll',
        label: '右桿左右',
        action: '右打',
        axis: horizontal.axis,
        peak: peaks[horizontal.axis],
        reverse: horizontal.sign < 0,
        sign: horizontal.sign,
        valid: true,
        reason: null,
      }
    : invalidSuggestion('roll', '右桿左右', '右打', notFound('右桿左右'));

  // 防禦：兩組理論上已互斥，仍顯式禁止同一軸（右桿上下/左右必為兩根不同軸）。
  const sameAxis = vertical !== null && horizontal !== null && vertical.axis === horizontal.axis;
  if (sameAxis) {
    const hint =
      `兩組都指向 axis${vertical.axis}：右桿上下與左右不可能是同一根軸，請推到底重錄` +
      `（或檢查搖桿是否只動了一個方向）。`;
    return {
      ok: false,
      pitch: invalidSuggestion('pitch', '右桿上下', '推上', hint),
      roll: invalidSuggestion('roll', '右桿左右', '右打', hint),
      sameAxis: true,
      retryHint: hint,
      current: currentSummary,
      matches: { pitch: false, roll: false },
    };
  }

  const ok = pitch.valid && roll.valid;
  const retryHint = ok ? null : [pitch.reason, roll.reason].filter((reason): reason is string => Boolean(reason)).join(' ');
  const matches = {
    pitch: currentSummary !== null && pitch.axis !== null && currentSummary.pitch.source === pitch.axis && currentSummary.pitch.reverse === pitch.reverse,
    roll: currentSummary !== null && roll.axis !== null && currentSummary.roll.source === roll.axis && currentSummary.roll.reverse === roll.reverse,
  };

  return {
    ok,
    pitch,
    roll,
    sameAxis: false,
    retryHint,
    current: currentSummary,
    matches,
  };
}

/** 面板 / 測試共用的一段結論文字。 */
export function describeSuggestion(suggestion: RecordingSuggestion): string {
  const line = (item: StickSuggestion, current: BindingSummary | null): string => {
    if (!item.valid) return `${item.label}：${item.reason ?? '無效'}`;
    const sign = item.sign < 0 ? '負' : '正';
    const reverse = item.reverse ? 'true' : 'false';
    const suggested = `${item.fn} ← axis${item.axis}（reverse=${reverse}）`;
    if (!current) return `${item.label} = axis${item.axis}，${item.action}為${sign}（峰值 ${item.peak.toFixed(2)}）→ 建議 ${suggested}`;
    const same = current.source === item.axis && current.reverse === item.reverse;
    return (
      `${item.label} = axis${item.axis}，${item.action}為${sign}（峰值 ${item.peak.toFixed(2)}）→ 建議 ${suggested}；` +
      `目前綁定 ${item.fn} ← axis${current.source}（reverse=${current.reverse ? 'true' : 'false'}）→ ${same ? '一致' : '不一致'}`
    );
  };
  return [line(suggestion.pitch, suggestion.current?.pitch ?? null), line(suggestion.roll, suggestion.current?.roll ?? null)].join('\n');
}

/**
 * 把建議寫進 profile：只改「與建議不一致」的 pitch / roll 欄位（source 與
 * reverse），已經一致的通道完全不動（例如真機已驗證 roll←axis0 正確時，
 * 套用建議不會碰 roll）。其餘欄位（kind / min / center / max / deadzone /
 * expo、yaw、throttle、gimbal、armButton）原樣保留。
 *
 * 呼叫端必須先取得有效建議（suggestion.ok）；兩組都一致時回傳 null。
 */
export function applySuggestionToProfile(profile: DeviceProfile, suggestion: RecordingSuggestion): DeviceProfile | null {
  if (!suggestion.ok) return null;
  const pitchAxis = suggestion.pitch.axis;
  const rollAxis = suggestion.roll.axis;
  if (pitchAxis === null || rollAxis === null) return null;
  const currentPitch = profile.axes.pitch;
  const currentRoll = profile.axes.roll;
  const pitchDiffers =
    currentPitch.source !== pitchAxis || Boolean(currentPitch.calibration.reverse) !== suggestion.pitch.reverse;
  const rollDiffers =
    currentRoll.source !== rollAxis || Boolean(currentRoll.calibration.reverse) !== suggestion.roll.reverse;
  if (!pitchDiffers && !rollDiffers) return null;
  return {
    ...profile,
    axes: {
      ...profile.axes,
      ...(pitchDiffers
        ? {
            pitch: {
              ...currentPitch,
              source: pitchAxis,
              calibration: { ...currentPitch.calibration, reverse: suggestion.pitch.reverse },
            },
          }
        : {}),
      ...(rollDiffers
        ? {
            roll: {
              ...currentRoll,
              source: rollAxis,
              calibration: { ...currentRoll.calibration, reverse: suggestion.roll.reverse },
            },
          }
        : {}),
    },
  };
}

/** 建議中「實際需要改寫」的通道清單（供面板提示與測試斷言）。 */
export function suggestionChanges(suggestion: RecordingSuggestion): Array<'pitch' | 'roll'> {
  if (!suggestion.ok) return [];
  const changes: Array<'pitch' | 'roll'> = [];
  if (suggestion.pitch.axis !== null && !suggestion.matches.pitch) changes.push('pitch');
  if (suggestion.roll.axis !== null && !suggestion.matches.roll) changes.push('roll');
  return changes;
}
