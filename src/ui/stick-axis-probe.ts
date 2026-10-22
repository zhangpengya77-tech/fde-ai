import { InputNormalizer, type AxisBinding } from '../input/InputNormalizer';

/**
 * 搖桿軸向快速測試（pitch / roll 專用，離線可驗證）。
 *
 * 只做一件事：把「實際推動的那根搖桿」對到「哪個 axis、往哪個方向」，
 * 再跟目前生效的綁定比對，給出三種結論之一——
 *   ok              ：axis 與方向都對
 *   wrong-source    ：axis 綁錯（推動的軸不是目前綁定的軸）
 *   wrong-direction ：axis 對，但推滿後歸一化是負的（方向反）
 *
 * 純函式、不碰 DOM、不改任何綁定：本模組只輸出「建議」，套用與否由人決定。
 */

export type StickProbeTestKey = 'pitch' | 'roll';

export interface StickProbeTestDef {
  readonly key: StickProbeTestKey;
  /** 顯示用的搖桿與方向，例如「右桿上下」。 */
  readonly label: string;
  /** 期望的動作描述，例如「推上」。 */
  readonly action: string;
  /** 期望產生的物理效果（驗收依據）。 */
  readonly expected: string;
  /** 該動作應得到的歸一化符號：+1 = 前進／右移。 */
  readonly expectedSign: 1 | -1;
}

/** 美國手 Mode 2：右桿上下＝俯仰、右桿左右＝橫滾。 */
export const STICK_PROBE_TESTS: readonly StickProbeTestDef[] = [
  { key: 'pitch', label: '右桿上下', action: '推上', expected: '機頭下壓、向前飛', expectedSign: 1 },
  { key: 'roll', label: '右桿左右', action: '右打', expected: '向右移、右側下沉', expectedSign: 1 },
];

/** 單軸偏離基線超過此值才算「這根桿被推到」，其餘視為雜訊。 */
export const STICK_PROBE_THRESHOLD = 0.3;

/** 歸一化後超過此值才敢說「方向正確」，避免半舵誤判。 */
export const STICK_PROBE_CONFIDENT = 0.5;

/**
 * 峰值（原始偏移量）低於此值時，任何結論都不可信：推動幅度不足。
 * 此時不得給出「source 綁錯」或「軸是對的」，只能回報「結論無效」。
 */
export const STICK_PROBE_INVALID = 0.5;

export interface StickPeak {
  readonly axis: number;
  readonly baseline: number;
  readonly peak: number;
  /** 峰值減基線（保留原始正負號）。 */
  readonly delta: number;
  /** |delta| */
  readonly deviation: number;
}

/**
 * 取偏離基線最大的軸。沒有任何軸超過門檻時回傳 null
 * （代表搖桿還沒動，或動的幅度不足以判定）。
 */
export function detectStickPeak(
  baseline: readonly number[],
  sample: readonly number[],
  threshold: number = STICK_PROBE_THRESHOLD,
): StickPeak | null {
  let best: StickPeak | null = null;
  const count = Math.min(baseline.length, sample.length);
  for (let axis = 0; axis < count; axis += 1) {
    const base = baseline[axis];
    const value = sample[axis];
    if (!Number.isFinite(base) || !Number.isFinite(value)) continue;
    const delta = value - base;
    const deviation = Math.abs(delta);
    if (deviation < threshold) continue;
    if (!best || deviation > best.deviation) {
      best = { axis, baseline: base, peak: value, delta, deviation };
    }
  }
  return best;
}

/**
 * 累積峰值：面板每個 tick 呼叫一次，直到放開為止。
 * 只保留偏離最大的一筆，避免「剛過門檻就定案」把峰值記成 0.3。
 */
export function trackStickPeak(
  previous: StickPeak | null,
  baseline: readonly number[],
  sample: readonly number[],
  threshold = 0.05,
): StickPeak | null {
  const candidate = detectStickPeak(baseline, sample, threshold);
  if (!candidate) return previous;
  if (!previous || candidate.deviation > previous.deviation) return candidate;
  return previous;
}

export type StickProbeVerdict = 'ok' | 'wrong-source' | 'wrong-direction' | 'no-motion' | 'insufficient' | 'same-axis';

export interface StickProbeBindingView {
  readonly source: number;
  readonly reverse: boolean;
  readonly kind: string;
}

export interface StickProbeResult {
  readonly test: StickProbeTestKey;
  readonly label: string;
  readonly action: string;
  readonly axis: number | null;
  readonly baseline: number | null;
  readonly peak: number | null;
  readonly delta: number | null;
  /** 用「目前綁定」算出的歸一化值；axis 對不上時為 null。 */
  readonly normalized: number | null;
  readonly verdict: StickProbeVerdict;
  /** 給人看的一句話結論。 */
  readonly message: string;
  readonly current: StickProbeBindingView | null;
  /** 建議的綁定（僅 wrong-* 時有值）；本模組不會自動套用。 */
  readonly suggested: { source: number; reverse: boolean } | null;
}

function signText(delta: number): string {
  return delta < 0 ? '負' : '正';
}

function bindingLabel(test: StickProbeTestKey, binding: StickProbeBindingView): string {
  return `${test}←a${binding.source}${binding.reverse ? '（反）' : ''}`;
}

/**
 * 判定一次測試結果。
 *
 * `binding` 是「目前生效」的那條綁定（pitch 或 roll），只讀不寫。
 */
export function judgeStickProbe(
  test: StickProbeTestDef,
  peak: StickPeak | null,
  binding: AxisBinding | null,
  normalizer: InputNormalizer = new InputNormalizer(),
): StickProbeResult {
  const current = binding
    ? { source: binding.source, reverse: binding.calibration.reverse, kind: binding.kind }
    : null;

  if (!peak) {
    return {
      test: test.key,
      label: test.label,
      action: test.action,
      axis: null,
      baseline: null,
      peak: null,
      delta: null,
      normalized: null,
      verdict: 'no-motion',
      message: `${test.label}：沒有偵測到足夠的位移。請把搖桿推到最上／最右並保持一秒再放開。`,
      current,
      suggested: null,
    };
  }

  // 峰值（原始偏移量）不足：推動幅度不夠，任何結論都不可信。
  // 不得給出 source 綁錯或軸是對的，只能回報無效。
  if (peak.deviation < STICK_PROBE_INVALID) {
    return {
      test: test.key,
      label: test.label,
      action: test.action,
      axis: peak.axis,
      baseline: peak.baseline,
      peak: peak.peak,
      delta: peak.delta,
      normalized: null,
      verdict: 'insufficient',
      message:
        `${test.label}：峰值僅 ${peak.deviation.toFixed(3)}（軸 ${peak.axis}），` +
        `推動幅度不足，結論無效。請把這根搖桿推到底並保持一秒再放開，不要只輕推。`,
      current,
      suggested: null,
    };
  }

  const prefix = `${test.label} = axis${peak.axis}，${test.action}為${signText(peak.delta)}（峰值 ${peak.peak.toFixed(3)}）`;

  if (!current) {
    return {
      test: test.key,
      label: test.label,
      action: test.action,
      axis: peak.axis,
      baseline: peak.baseline,
      peak: peak.peak,
      delta: peak.delta,
      normalized: null,
      verdict: 'no-motion',
      message: `${prefix} → 目前沒有可比較的 ${test.key} 綁定（未載入標定）。`,
      current: null,
      suggested: null,
    };
  }

  // axis 綁錯：這是「推這根桿卻動到別的軸」，翻 reverse 救不回來。
  if (peak.axis !== current.source) {
    const suggestedReverse = peak.delta * test.expectedSign < 0;
    return {
      test: test.key,
      label: test.label,
      action: test.action,
      axis: peak.axis,
      baseline: peak.baseline,
      peak: peak.peak,
      delta: peak.delta,
      normalized: null,
      verdict: 'wrong-source',
      message:
        `${prefix} → source 綁錯：${test.key} 目前綁 axis${current.source}，` +
        `建議改 ${test.key}←a${peak.axis}（reverse=${suggestedReverse}）`,
      current,
      suggested: { source: peak.axis, reverse: suggestedReverse },
    };
  }

  const normalized = normalizer.normalizeAxis(peak.peak, binding!.calibration, binding!.kind);
  const oriented = normalized * test.expectedSign;

  if (oriented >= STICK_PROBE_CONFIDENT) {
    return {
      test: test.key,
      label: test.label,
      action: test.action,
      axis: peak.axis,
      baseline: peak.baseline,
      peak: peak.peak,
      delta: peak.delta,
      normalized,
      verdict: 'ok',
      message: `${prefix} → 目前映射 ${bindingLabel(test.key, current)}，正確（歸一化 ${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}，${test.expected}）`,
      current,
      suggested: null,
    };
  }

  if (oriented <= -STICK_PROBE_CONFIDENT) {
    return {
      test: test.key,
      label: test.label,
      action: test.action,
      axis: peak.axis,
      baseline: peak.baseline,
      peak: peak.peak,
      delta: peak.delta,
      normalized,
      verdict: 'wrong-direction',
      message:
        `${prefix} → 方向反：目前 ${bindingLabel(test.key, current)}，推滿卻得到歸一化 ` +
        `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}（應為 ${test.expectedSign > 0 ? '+' : '-'}1），` +
        `建議翻 reverse（改為 reverse=${!current.reverse}）`,
      current,
      suggested: { source: current.source, reverse: !current.reverse },
    };
  }

  // 推得不夠滿：軸是對的，但不足以判定方向。
  return {
    test: test.key,
    label: test.label,
    action: test.action,
    axis: peak.axis,
    baseline: peak.baseline,
    peak: peak.peak,
    delta: peak.delta,
    normalized,
    verdict: 'no-motion',
    message: `${prefix} → 軸是對的（${bindingLabel(test.key, current)}），但推得不夠滿（歸一化 ${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}），請推到底再測一次。`,
    current,
    suggested: null,
  };
}

export interface StickProbeReportInput {
  readonly capturedAt: string;
  readonly deviceId: string | null;
  readonly profile: {
    readonly originKind: string;
    readonly file: string;
    readonly savedAtMs: number;
  } | null;
  readonly mapping: string | null;
  readonly results: readonly StickProbeResult[];
}

/**
 * 兩組測試（pitch / roll）若都判定到同一個 axis，結論無效。
 * 真機的右桿上下與左右應是兩個不同的軸，指向同一軸通常代表推動不足或雜訊。
 */
export function sameAxisVerdict(
  test: StickProbeTestDef,
  axis: number,
  otherLabel: string,
): StickProbeResult {
  return {
    test: test.key,
    label: test.label,
    action: test.action,
    axis,
    baseline: null,
    peak: null,
    delta: null,
    normalized: null,
    verdict: 'same-axis',
    message:
      `${test.label} 與 ${otherLabel} 都指向 axis${axis}：兩組結果無效。` +
      `右桿上下與左右應是不同的軸；可能是推動不足或雜訊，請重測（先放開回中，再只推指定的那根桿到底）。`,
    current: null,
    suggested: null,
  };
}

/** 匯出用 JSON（schema 固定，方便貼回或存檔比對）。 */
export function buildStickProbeReport(input: StickProbeReportInput): Record<string, unknown> {
  return {
    schema: 'fde.stick-axis-probe/1',
    capturedAt: input.capturedAt,
    deviceId: input.deviceId,
    profile: input.profile,
    mapping: input.mapping,
    tests: input.results.map((result) => ({
      test: result.test,
      label: result.label,
      action: result.action,
      axis: result.axis,
      baseline: result.baseline,
      peak: result.peak,
      delta: result.delta,
      normalized: result.normalized,
      verdict: result.verdict,
      message: result.message,
      current: result.current,
      suggested: result.suggested,
    })),
  };
}

/** 面板在沒有遙控器時顯示的固定文案（需求原文）。 */
export const NO_GAMEPAD_HINT = '未偵測到搖桿。USB：請選 USB Joystick (HID)；藍牙：瀏覽器無法讀取';
