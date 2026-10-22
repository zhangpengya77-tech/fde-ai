/**
 * 原始軸連續錄製（與使用者操作品質無關的診斷工具）。
 *
 * 設計目的：快速測試與引導式標定都要求使用者「把桿推到底」，但真機現場常常
 * 推不滿（峰值 0.05~0.07），導致判定不可信。這套錄製不依賴單次動作品質——
 * 它讓使用者把右桿依序畫一圈（上→右→下→左），期間每幀記錄所有原始軸，
 * 錄完直接算出每個軸的最小 / 最大 / 平均 / 起始 / 結束與變化量排序。
 *
 * 純函式、不碰 DOM、不改任何映射：只輸出「這 10 秒裡到底哪個軸真的在動」，
 * 交給人來判斷右桿上下 / 左右各自對到哪個 axis。
 */

export interface AxisRecordingStat {
  /** 軸編號（0..7）。 */
  readonly axis: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  /** 錄製開始時的第一個樣本值（靜止基線）。 */
  readonly start: number;
  /** 錄製結束時的最後一個樣本值。 */
  readonly end: number;
  /** max - min，變化幅度。 */
  readonly span: number;
}

export interface RecordingReport {
  readonly schema: string;
  readonly capturedAt: string;
  readonly deviceId: string | null;
  readonly sampleCount: number;
  readonly durationMs: number;
  readonly axes: readonly AxisRecordingStat[];
  /** 軸編號，按 span 由大到小排序（最會動的排最前）。 */
  readonly ranked: readonly number[];
  /** 各軸靜止（start）值是否落在預期中位附近的自檢結論。 */
  readonly restFlags: readonly AxisRestFlag[];
}

export interface AxisRestFlag {
  readonly axis: number;
  readonly rest: number;
  readonly expectedMid: number;
  readonly deviation: number;
  /** 靜止值是否偏離預期中位超過容許值。 */
  readonly offCenter: boolean;
}

/** 錄製視窗長度（毫秒）。 */
export const RECORDING_DURATION_MS = 10_000;

/** 錄製期間對使用者的提示。 */
export const RECORDING_PROMPT =
  '請把右桿依序畫圈：上、右、下、左，各停 1 秒，幅度推到底。';

/**
 * 預期靜止中位：自回中軸（roll/pitch/yaw）應在 0 附近，單向油門在底部 -1。
 * 這裡給的是「歸一化後的中位假設」對照用的原始預期中位（raw 0 對應 center）。
 */
export const EXPECTED_REST_MID: Record<number, number> = {
  0: 0, // roll
  1: 0, // pitch
  2: -1, // throttle（底部）
  3: 0, // yaw
};

/** 靜止值偏離預期中位超過此值就標記「offCenter」。 */
export const REST_OFFCENTER_TOLERANCE = 0.05;

/** 從一連串樣本（每個是各軸原始值的陣列）計算統計。 */
export function analyzeRecording(
  samples: readonly (readonly number[])[],
  deviceId: string | null,
  durationMs: number,
): RecordingReport {
  const channelCount = samples.length > 0 ? samples[0].length : 0;
  const axes: AxisRecordingStat[] = [];
  const restFlags: AxisRestFlag[] = [];

  for (let axis = 0; axis < channelCount; axis += 1) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    let start = Number.NaN;
    let end = Number.NaN;
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index][axis];
      if (!Number.isFinite(value)) continue;
      if (!Number.isFinite(start)) start = value;
      end = value;
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
      count += 1;
    }
    if (count === 0) {
      axes.push({ axis, min: 0, max: 0, mean: 0, start: 0, end: 0, span: 0 });
    } else {
      const mean = sum / count;
      axes.push({ axis, min, max, mean, start, end, span: max - min });
    }
    const expectedMid = EXPECTED_REST_MID[axis] ?? 0;
    const rest = Number.isFinite(start) ? start : 0;
    const deviation = rest - expectedMid;
    restFlags.push({
      axis,
      rest,
      expectedMid,
      deviation,
      offCenter: Math.abs(deviation) > REST_OFFCENTER_TOLERANCE,
    });
  }

  const ranked = axes
    .map((stat) => stat.axis)
    .slice()
    .sort((a, b) => axes[b].span - axes[a].span);

  return {
    schema: 'fde.raw-axis-recording/1',
    capturedAt: new Date().toISOString(),
    deviceId,
    sampleCount: samples.length,
    durationMs,
    axes,
    ranked,
    restFlags,
  };
}

/** 匯出給貼回用的 JSON 文字。 */
export function buildRecordingReportText(report: RecordingReport): string {
  return JSON.stringify(report, null, 2);
}
