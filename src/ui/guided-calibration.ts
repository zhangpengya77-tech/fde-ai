import type { AxisCalibration, AxisBinding, AxisBindings, AxisRangeKind } from '../input/InputNormalizer';
import type { DeviceProfile } from '../input/device-profile';

/**
 * Guided, measurement-driven calibration for the four flight functions.
 *
 * The wizard never assumes an axis layout: for each step the pilot is asked to
 * move exactly ONE stick to exactly ONE extreme, and the state machine records
 * which raw axis actually moved and in which direction. `reverse` is derived
 * from the measured sign so the normalized command is +1 at the requested
 * extreme (上推 = 前進 / 右打 = 右移 / ...), never from documentation.
 *
 * Pure and DOM-free: the panel feeds raw samples in and renders the phases.
 */

export type GuidedFunctionKey = keyof AxisBindings;

export interface GuidedStepDef {
  readonly fn: GuidedFunctionKey;
  /** Which physical stick to move, in the teacher's language. */
  readonly stick: string;
  /** Which extreme of that stick to hold. */
  readonly direction: string;
  /** Function title shown in the UI. */
  readonly title: string;
  /** Physical effect the extreme is supposed to produce (verification aid). */
  readonly expected: string;
  /**
   * Extra preparation shown with the prompt. Only the throttle needs one: it is
   * not self-centring, so the measured span is wrong unless it starts at the
   * bottom stop.
   */
  readonly prepare?: string;
}

/** 美國手 Mode 2: 左桿油門/偏航，右桿俯仰/橫滾。 */
export const GUIDED_STEPS: readonly GuidedStepDef[] = [
  { fn: 'pitch', stick: '右搖桿', direction: '最上', title: '俯仰 Pitch', expected: '前推 = 前進（機頭下壓）' },
  { fn: 'roll', stick: '右搖桿', direction: '最右', title: '橫滾 Roll', expected: '右打 = 右移（右側下沉）' },
  { fn: 'yaw', stick: '左搖桿', direction: '最右', title: '偏航 Yaw', expected: '右打 = 機頭右轉（航向角增）' },
  {
    fn: 'throttle',
    stick: '左搖桿',
    direction: '最上',
    title: '油門 Throttle',
    expected: '上推 = 油門增大',
    prepare: '開始前先把油門拉到最底（油門不會自動回中）。',
  },
];

/** 單一軸偏離中位超過此值才算「這根桿被動了」（其餘軸視為雜訊）。 */
export const GUIDED_MOVE_THRESHOLD = 0.3;

/**
 * 引導式標定每步鎖定所需的最小峰值。低於此值視為推動不足，拒絕記錄並提示
 * 目前峰值，避免把半推的雜訊當成有效標定（真機常見峰值 0.05~0.07）。
 */
export const GUIDED_MIN_PEAK = 0.7;

const STEP_KIND: Record<GuidedFunctionKey, AxisRangeKind> = {
  roll: 'bipolar',
  pitch: 'bipolar',
  yaw: 'bipolar',
  throttle: 'unipolar',
};

export interface AxisDetection {
  /** Raw axis index that moved. */
  readonly axis: number;
  /** Raw value of that axis at the requested extreme. */
  readonly extreme: number;
  /** Deviation magnitude that selected this axis. */
  readonly deviation: number;
}

/**
 * Picks the axis whose deviation from the baseline is largest. Returns null
 * when no axis moved past `GUIDED_MOVE_THRESHOLD` (the pilot is still neutral).
 */
export function detectMovedAxis(
  baseline: readonly number[],
  sample: readonly number[],
  threshold: number = GUIDED_MOVE_THRESHOLD,
): AxisDetection | null {
  let best: AxisDetection | null = null;
  const count = Math.min(baseline.length, sample.length);
  for (let axis = 0; axis < count; axis += 1) {
    const base = baseline[axis];
    const value = sample[axis];
    if (!Number.isFinite(base) || !Number.isFinite(value)) continue;
    const deviation = Math.abs(value - base);
    if (deviation < threshold) continue;
    if (!best || deviation > best.deviation) best = { axis, extreme: value, deviation };
  }
  return best;
}

/**
 * Turns a measured (baseline, extreme) pair into the calibration for one axis.
 *
 * - bipolar (self-centring sticks): `center` is the measured rest position, the
 *   opposite end is mirrored around it (`2*center - extreme`) - a gimbal is
 *   mechanically symmetric, and the mirrored end is displayed for review.
 * - unipolar (throttle): baseline and extreme ARE the two ends of travel.
 *
 * `reverse` is set so the normalized command reads +1 at the requested extreme.
 */
export function extremeToCalibration(kind: AxisRangeKind, baseline: number, extreme: number): AxisCalibration {
  if (kind === 'unipolar') {
    const lo = Math.min(baseline, extreme);
    const hi = Math.max(baseline, extreme);
    const span = hi - lo > 1e-6 ? hi - lo : 1;
    return { min: lo, center: lo, max: lo + span, reverse: extreme < baseline, deadzone: 0, expo: 0 };
  }
  const mirrored = 2 * baseline - extreme;
  return {
    min: Math.min(baseline, extreme, mirrored),
    center: baseline,
    max: Math.max(baseline, extreme, mirrored),
    reverse: extreme < baseline,
    deadzone: 0,
    expo: 0,
  };
}

export interface GuidedStepResult {
  readonly fn: GuidedFunctionKey;
  readonly axis: number;
  readonly baseline: number;
  readonly extreme: number;
  readonly kind: AxisRangeKind;
  readonly calibration: AxisCalibration;
}

export type GuidedPhase = 'idle' | 'arming' | 'detected' | 'error' | 'done';

export interface GuidedProfileExtras {
  readonly gimbal: DeviceProfile['gimbal'];
  readonly armButton: DeviceProfile['armButton'];
}

/**
 * Four-step guided calibration state machine.
 *
 * Lifecycle: `arm(baseline)` -> feed samples until one locks (`detected`) ->
 * `confirm()` records the step and advances; a duplicate axis across steps is an
 * `error` that must be retried. When all four functions are measured the
 * machine is `done` and `buildProfile()` produces a ready-to-save profile.
 */
export class GuidedCalibrationState {
  private phase: GuidedPhase = 'idle';
  private stepIndex = 0;
  private baseline: readonly number[] = [];
  private detection: AxisDetection | null = null;
  /** 鎖定前持續追蹤的最大偏移（即便低於 GUIDED_MIN_PEAK 也記錄，供面板顯示）。 */
  private softPeak: AxisDetection | null = null;
  private errorMessage: string | null = null;
  private readonly results = new Map<GuidedFunctionKey, GuidedStepResult>();

  get currentPhase(): GuidedPhase {
    return this.phase;
  }

  get currentStep(): GuidedStepDef | null {
    return GUIDED_STEPS[this.stepIndex] ?? null;
  }

  /** 1-based step number for display ("第 1 / 4 步"). */
  get stepNumber(): number {
    return Math.min(this.stepIndex + 1, GUIDED_STEPS.length);
  }

  get totalSteps(): number {
    return GUIDED_STEPS.length;
  }

  get currentDetection(): AxisDetection | null {
    return this.detection;
  }

  /** 鎖定前追蹤到的最大偏移（可能低於 GUIDED_MIN_PEAK）。 */
  get currentSoftPeak(): AxisDetection | null {
    return this.softPeak;
  }

  get error(): string | null {
    return this.errorMessage;
  }

  /** Snapshot of all confirmed step results (empty until confirmed). */
  stepResults(): GuidedStepResult[] {
    return [...this.results.values()];
  }

  /** Arms the current step: the sample becomes the neutral baseline. */
  arm(baseline: readonly number[]): void {
    this.baseline = [...baseline];
    this.detection = null;
    this.softPeak = null;
    this.errorMessage = null;
    this.phase = 'arming';
  }

  /**
   * Feeds one raw sample while armed. Returns the locked detection (the caller
   * then shows the confirmation text), or null while still neutral. A duplicate
   * axis flips the machine into `error`: the pilot must redo the step with a
   * different stick - two functions must never share one physical axis.
   */
  feed(sample: readonly number[]): AxisDetection | null {
    if (this.phase !== 'arming') return null;
    const step = this.currentStep;
    if (!step) return null;
    const found = detectMovedAxis(this.baseline, sample);
    if (!found) {
      this.softPeak = null;
      return null;
    }
    this.softPeak = found;
    // 峰值不足：不鎖定、不報錯，只記錄目前峰值，由面板提示「請推到底」。
    if (found.deviation < GUIDED_MIN_PEAK) return null;

    for (const [fn, result] of this.results) {
      if (result.axis === found.axis) {
        this.phase = 'error';
        this.errorMessage =
          `axis${found.axis} 已分配給「${GUIDED_STEPS.find((s) => s.fn === fn)?.title ?? fn}」，兩個動作用了同一根軸。` +
          `請按「重做這步」，換一根搖桿再試。`;
        return null;
      }
    }

    this.detection = found;
    this.phase = 'detected';
    return found;
  }

  /** Records the pending detection and advances to the next step (or done). */
  confirm(): GuidedStepResult | null {
    const result = this.pendingResult();
    if (!result) return null;
    this.results.set(result.fn, result);
    this.detection = null;
    this.stepIndex += 1;
    this.phase = this.stepIndex >= GUIDED_STEPS.length ? 'done' : 'idle';
    return result;
  }

  /**
   * Result for the pending (locked but unconfirmed) detection, or null when
   * nothing is locked. The baseline is the one captured at `arm()` time, so the
   * displayed numbers never depend on whichever sample happens to be live.
   */
  pendingResult(): GuidedStepResult | null {
    if (this.phase !== 'detected' || !this.detection) return null;
    const step = this.currentStep;
    if (!step) return null;
    const kind = STEP_KIND[step.fn];
    const baseline = this.baseline[this.detection.axis] ?? 0;
    return {
      fn: step.fn,
      axis: this.detection.axis,
      baseline,
      extreme: this.detection.extreme,
      kind,
      calibration: extremeToCalibration(kind, baseline, this.detection.extreme),
    };
  }

  /** Clears a detection/error so the current step can be attempted again. */
  retry(): void {
    this.detection = null;
    this.softPeak = null;
    this.errorMessage = null;
    this.phase = this.stepIndex >= GUIDED_STEPS.length ? 'done' : 'idle';
  }

  /** Full reset back to step 1 with no results. */
  reset(): void {
    this.phase = 'idle';
    this.stepIndex = 0;
    this.detection = null;
    this.softPeak = null;
    this.errorMessage = null;
    this.results.clear();
  }

  /** True once all four functions were measured. */
  isComplete(): boolean {
    return this.results.size === GUIDED_STEPS.length;
  }

  /**
   * Builds the profile from the measured steps, or null when incomplete.
   * `gimbal`/`armButton` are carried over from the currently loaded profile so
   * a re-calibration never silently drops them.
   */
  buildProfile(deviceId: string, extras: GuidedProfileExtras, label: string): DeviceProfile | null {
    if (!this.isComplete()) return null;
    const axes = {} as AxisBindings;
    for (const step of GUIDED_STEPS) {
      const result = this.results.get(step.fn);
      if (!result) return null;
      const binding: AxisBinding = { source: result.axis, kind: result.kind, calibration: result.calibration };
      axes[step.fn] = binding;
    }
    return {
      id: deviceId,
      label,
      type: 'gamepad',
      mode: 'custom',
      axes,
      gimbal: extras.gimbal,
      armButton: extras.armButton,
      unsupported: false,
    };
  }
}

/** Formats the confirmation line shown when a step locks its detection. */
export function describeDetection(step: GuidedStepDef, result: GuidedStepResult): string {
  const reverse = result.calibration.reverse ? 'true（反向）' : 'false';
  const span = `min ${result.calibration.min.toFixed(2)} / 中位 ${result.calibration.center.toFixed(2)} / max ${result.calibration.max.toFixed(2)}`;
  return (
    `${step.title} ← axis${result.axis}（實測原始值 ${result.extreme.toFixed(3)}，中位 ${result.baseline.toFixed(3)}）` +
    ` → reverse=${reverse}，此端歸一化 = +1（${step.expected}）；${span}`
  );
}
