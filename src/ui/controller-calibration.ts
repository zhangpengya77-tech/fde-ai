import type { PilotInputAdapter, PilotInputType, RawPilotInput } from '../input/PilotInputAdapter';
import type {
  AxisBinding,
  AxisBindings,
  AxisCalibration,
  AxisRangeKind,
} from '../input/InputNormalizer';
import { InputNormalizer } from '../input/InputNormalizer';
import { createMode2Profile, toStoredDeviceProfile, type DeviceProfile } from '../input/device-profile';
import {
  describeAxisMapping,
  parseLatestProfileResponse,
  sameAxisMapping,
  shouldAutoApply,
  shouldUpgradeStoredProfile,
  type LatestProfilePayload,
} from '../input/auto-profile';
import { describeDetection, GuidedCalibrationState, GUIDED_MIN_PEAK } from './guided-calibration';
import {
  buildStickProbeReport,
  detectStickPeak,
  judgeStickProbe,
  NO_GAMEPAD_HINT,
  sameAxisVerdict,
  STICK_PROBE_TESTS,
  STICK_PROBE_THRESHOLD,
  trackStickPeak,
  type StickPeak,
  type StickProbeResult,
  type StickProbeTestKey,
} from './stick-axis-probe';
import {
  analyzeRecording,
  RECORDING_DURATION_MS,
  RECORDING_PROMPT,
  type RecordingReport,
} from './raw-axis-recorder';
import {
  applySuggestionToProfile,
  describeSuggestion,
  suggestFromRecording,
  suggestionChanges,
  SUGGESTION_MIN_PEAK,
  type RecordingSuggestion,
} from './recording-suggestion';
import {
  ACCEPTANCE_LABELS,
  buildAcceptanceReport,
  judgeAcceptance,
  RELEASE_NEUTRAL,
  RELEASE_SETTLE_S,
  type AcceptanceKey,
  type AcceptanceRecord,
  type AcceptanceSample,
} from './direction-acceptance';
import { compensatedCenter, detectCenterOffset, type CenterOffsetSample } from './center-compensation';
import {
  parseStoredProfile,
  serializeStoredProfile,
  type ProfileStore,
  type StoredProfileResult,
} from './profile-store';
import { zhHant as L } from '../i18n/zh-Hant';

export type AxisCaptureField = 'min' | 'center' | 'max';

export interface AxisCapture {
  readonly min: number;
  readonly center: number;
  readonly max: number;
  readonly minSeen: boolean;
  readonly centerSeen: boolean;
  readonly maxSeen: boolean;
  /** How many samples were folded into the current capture. */
  readonly samples: number;
}

export interface CalibrationDraft {
  readonly id: string;
  readonly label: string;
  readonly axes: AxisBindings;
  readonly gimbal: { yaw: AxisBinding; pitch: AxisBinding } | null;
  readonly armButton: number | null;
}

const MAX_MONITOR_CHANNELS = 8;

/** 中心偏移偵測的滑動視窗（約 1 秒，60ms tick）。 */
const CENTER_WATCH_SAMPLES = 16;

/** 單項方向驗收的最長等待時間（毫秒）。 */
const ACCEPTANCE_TIMEOUT_MS = 12_000;

// ---- pure capture state machine ---------------------------------------------

export function createAxisCapture(seed: Partial<AxisCalibration> = {}): AxisCapture {
  return {
    min: seed.min ?? -1,
    center: seed.center ?? 0,
    max: seed.max ?? 1,
    minSeen: false,
    centerSeen: false,
    maxSeen: false,
    samples: 0,
  };
}

export function resetAxisCapture(state: AxisCapture, field: AxisCaptureField): AxisCapture {
  if (field === 'center') return { ...state, centerSeen: false };
  if (field === 'min') return { ...state, minSeen: false };
  return { ...state, maxSeen: false };
}

export function feedAxisCapture(state: AxisCapture, field: AxisCaptureField, value: number): AxisCapture {
  if (!Number.isFinite(value)) return state;
  switch (field) {
    case 'min':
      return { ...state, min: state.minSeen ? Math.min(state.min, value) : value, minSeen: true, samples: state.samples + 1 };
    case 'max':
      return { ...state, max: state.maxSeen ? Math.max(state.max, value) : value, maxSeen: true, samples: state.samples + 1 };
    case 'center':
      return { ...state, center: value, centerSeen: true, samples: state.samples + 1 };
  }
}

export function captureToCalibration(state: AxisCapture, base: AxisCalibration): AxisCalibration {
  const min = state.minSeen ? state.min : base.min;
  const max = state.maxSeen ? state.max : base.max;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const center = state.centerSeen ? Math.min(Math.max(state.center, lo), hi) : base.center;
  return { ...base, min: lo, center, max: hi };
}

export function draftToDeviceProfile(draft: CalibrationDraft, type: PilotInputType = 'gamepad'): DeviceProfile {
  return {
    id: draft.id,
    label: draft.label,
    type,
    mode: 'custom',
    axes: draft.axes,
    gimbal: draft.gimbal,
    armButton: draft.armButton,
    unsupported: false,
  };
}

// ---- DOM helpers --------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  for (const child of children) node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
  return node;
}

const FUNCTION_META: ReadonlyArray<{ key: keyof AxisBindings; name: string; short: string }> = [
  { key: 'roll', name: '橫滾 Roll', short: 'Roll' },
  { key: 'pitch', name: '俯仰 Pitch', short: 'Pitch' },
  { key: 'yaw', name: '偏航 Yaw', short: 'Yaw' },
  { key: 'throttle', name: '油門 Throttle', short: 'Thr' },
];

/** Where the profile currently in effect came from (shown in the UI). */
export type ProfileOriginKind = 'live' | 'bundled' | 'stored' | 'draft' | 'manual' | 'guided' | 'imported' | 'suggestion';

export interface ProfileOriginInfo {
  readonly kind: ProfileOriginKind;
  /** Capture file name, when the profile came from a capture file. */
  readonly file?: string;
  /** Provenance timestamp of the profile in effect (capture time or save time). */
  readonly savedAtMs?: number;
  /**
   * Set when a locally stored profile wins on timestamps but binds the four
   * functions differently from the newest capture on the server. The teacher
   * must see this instead of silently flying an outdated mapping.
   */
  readonly conflict?: boolean;
  /** Mapping summary of the disagreeing capture, for the warning text. */
  readonly conflictMapping?: string;
}

export interface ActiveProfileInfo {
  readonly profile: DeviceProfile;
  readonly origin: ProfileOriginInfo;
  /** `Gamepad.id` of the connected controller, when connected. */
  readonly deviceId: string | null;
}

const ORIGIN_LABEL: Record<ProfileOriginKind, string> = {
  live: '在线 API（/api/rc/latest-profile）',
  bundled: '靜態回退（rc-profile-latest.json，建置時內建）',
  stored: 'IndexedDB（本機儲存）',
  draft: '預設草稿（尚未標定）',
  manual: '手動儲存（本機）',
  guided: '引導式標定（本機，本次實測）',
  imported: '匯入標定檔（本機）',
  suggestion: '錄製建議套用（本次實測，已寫入擷取檔）',
};

interface FunctionState {
  binding: AxisBinding;
  capture: AxisCapture;
}

export interface ControllerCalibrationOptions {
  root: HTMLElement;
  adapter: PilotInputAdapter;
  store: ProfileStore;
  /** Clock used only for the live monitor; defaults to performance.now(). */
  now?: () => number;
  pollIntervalMs?: number;
  /** Injectable DOM document (defaults to the global). */
  document?: Document;
  /** Called whenever a profile should take effect in the flight pipeline. */
  onProfileApplied?: (profile: DeviceProfile, origin?: ProfileOriginInfo) => void;
  /**
   * Called whenever the profile actually in effect changes (first connect,
   * auto-import, upgrade, manual save, guided save, clear-and-reload) or the
   * controller disconnects. The flight HUD uses it to pin "which capture am I
   * really flying with" on screen without polling the panel's DOM.
   */
  onActiveProfileChange?: (info: ActiveProfileInfo | null) => void;
  /**
   * Optional online fallback consulted once per newly connected device when
   * the local store holds no profile for it. Online deployments route this to
   * the latest guided-calibration capture; the wizard keeps its default draft
   * when the source is absent, unreachable or invalid.
   */
  autoProfileSource?: (deviceId: string) => Promise<unknown>;
  /**
   * When provided, the panel's "重設位置" button calls it to zero the aircraft
   * position/velocity in the flight model (a drift-diagnosis aid). The flight
   * controller is owned by the app shell, so the panel only fires this hook.
   */
  onResetPosition?: () => void;
  /**
   * When provided, the direction-acceptance panel samples the live flight
   * state every tick (position/velocity/heading + the normalized command) to
   * judge "stick forward -> Pitch positive & aircraft forward". The flight
   * controller is owned by the app shell, so the panel only asks for samples.
   */
  onFlightSample?: () => AcceptanceSample | null;
  /**
   * Endpoint that persists a new capture file (backs up the previous one,
   * keeps the newest mtime and mirrors it into the static fallbacks). The
   * teaching server implements it; a plain static deployment simply has no
   * such endpoint and the panel then applies the suggestion locally only.
   */
  captureEndpoint?: string;
}

/**
 * On-screen calibration wizard for any generic USB controller.
 *
 * The UI never learns which brand produced the numbers: it only edits a
 * `DeviceProfile` (channel bindings, per-axis Min/Center/Max, reverse, deadzone,
 * expo) and persists it to the injected `ProfileStore`. The wizard runs the
 * first time an external controller is used, exactly as the design requires.
 */
export class ControllerCalibrationPanel {
  private readonly now: () => number;
  private readonly doc: Document;
  private readonly pollIntervalMs: number;
  private readonly normalizer = new InputNormalizer();
  private readonly guided = new GuidedCalibrationState();

  private interval: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private deviceId: string | null = null;
  private draft: Map<keyof AxisBindings, FunctionState> | null = null;
  private gimbal: { yaw: AxisBinding; pitch: AxisBinding } | null = null;
  private armButton: number | null = null;
  private capturing: { fn: keyof AxisBindings; field: AxisCaptureField } | null = null;
  private upgrading = false;
  /** Where the profile currently in effect came from (rendered in the panel). */
  private origin: ProfileOriginInfo = { kind: 'draft', file: '', savedAtMs: 0 };
  /** Last live raw sample, so per-tick rendering can reuse one poll. */
  private lastRaw: RawPilotInput | null = null;
  /** Raw axes seen since this device connected: rest snapshot + observed extremes. */
  private restAxes: number[] | null = null;
  private axisMin: number[] = [];
  private axisMax: number[] = [];
  /** Last emitted signature, so `onActiveProfileChange` only fires on change. */
  private lastActiveSignature: string | null = null;
  /** 搖桿軸向快速測試：已完成的結果（pitch / roll 各一筆）。 */
  private readonly probeResults = new Map<StickProbeTestKey, StickProbeResult>();
  /** 測試進行中：基線 + 目前追到的峰值。 */
  private probeArmed: { key: StickProbeTestKey; baseline: number[]; best: StickPeak | null; startedAt: number } | null = null;
  private probeResultEls = new Map<StickProbeTestKey, HTMLElement>();
  private probeEmptyEl: HTMLElement | null = null;

  // --- 原始軸連續錄製（10 秒，與操作品質無關的診斷）-----------------------
  private recording: { samples: number[][]; startedAt: number; durationMs: number } | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingReport: RecordingReport | null = null;
  /** 保留原始樣本：錄製結束後要依段落分析（畫圈方向）推導建議。 */
  private recordingSamples: number[][] = [];
  private recordingSuggestion: RecordingSuggestion | null = null;
  private recordStatusEl: HTMLElement | null = null;
  private recordResultsEl: HTMLElement | null = null;
  private recordSuggestionEl: HTMLElement | null = null;
  private recordApplyEl: HTMLButtonElement | null = null;
  private recordExportEl: HTMLButtonElement | null = null;

  // --- 漂移診斷（靜止值 / 死區 / 重設位置 / 校正中心）----------------------
  private driftRestEls = new Map<keyof AxisBindings, HTMLElement>();
  private driftNormEls = new Map<keyof AxisBindings, HTMLElement>();
  private driftNoteEl: HTMLElement | null = null;
  private driftCenterEl: HTMLElement | null = null;
  /** 每個自回中功能最近的一段原始值（用來判斷「停著但偏離中心」）。 */
  private readonly centerWatch = new Map<keyof AxisBindings, number[]>();
  /** 目前偵測到的中心偏移（null = 沒有偏移）。 */
  private centerOffsets: Map<keyof AxisBindings, CenterOffsetSample> | null = null;

  // --- 方向驗收（右桿 pitch / roll 即時判定）--------------------------------
  private acceptanceArmed = new Map<AcceptanceKey, { startedAt: number; releasedAt: number | null }>();
  /** 測試進行中的即時說明（例如「請先解鎖並起飛」），讓畫面不說「測試中…」而已。 */
  private acceptancePending = new Map<AcceptanceKey, string>();
  private acceptanceRecords = new Map<AcceptanceKey, AcceptanceRecord>();
  private acceptanceResultEls = new Map<AcceptanceKey, HTMLElement>();
  private acceptanceButtonEls = new Map<AcceptanceKey, HTMLButtonElement>();
  private acceptanceExportEl: HTMLButtonElement | null = null;

  private channelRawEls: HTMLElement[] = [];
  private channelBarEls: HTMLElement[] = [];
  private channelMapEls: HTMLElement[] = [];
  private channelNormEls: HTMLElement[] = [];
  private calEls = new Map<keyof AxisBindings, HTMLElement>();
  private statusEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private activeFileEl: HTMLElement | null = null;
  private activeSavedEl: HTMLElement | null = null;
  private activeOriginEl: HTMLElement | null = null;
  private activeDeviceEl: HTMLElement | null = null;
  private activeMappingEl: HTMLElement | null = null;
  private guidedStepEl: HTMLElement | null = null;
  private guidedPromptEl: HTMLElement | null = null;
  private guidedHintEl: HTMLElement | null = null;
  private guidedErrorEl: HTMLElement | null = null;
  private guidedDetectionEl: HTMLElement | null = null;
  private guidedPeakEl: HTMLElement | null = null;
  private guidedButtons: Record<'start' | 'confirm' | 'retry' | 'save' | 'reset', HTMLButtonElement | null> = {
    start: null,
    confirm: null,
    retry: null,
    save: null,
    reset: null,
  };

  constructor(private readonly options: ControllerCalibrationOptions) {
    this.now = options.now ?? (() => performance.now());
    this.doc = options.document ?? document;
    this.pollIntervalMs = options.pollIntervalMs ?? 60;
  }

  /** The current draft profile, or null when no controller is connected. */
  getProfile(): DeviceProfile | null {
    if (!this.draft || !this.deviceId) return null;
    const axes = {} as AxisBindings;
    for (const { key } of FUNCTION_META) {
      const state = this.draft.get(key);
      if (state) axes[key] = state.binding;
    }
    return {
      id: this.deviceId,
      label: this.deviceId,
      type: 'gamepad',
      mode: 'custom',
      axes,
      gimbal: this.gimbal,
      armButton: this.armButton,
      unsupported: false,
    };
  }

  /**
   * The profile currently in effect plus its provenance. This is what the
   * on-screen block renders, and what a browser test asserts: it answers
   * "which capture is the real browser actually flying with?" without anyone
   * having to open devtools.
   */
  getActiveProfileInfo(): ActiveProfileInfo | null {
    const profile = this.getProfile();
    if (!profile) return null;
    return { profile, origin: this.origin, deviceId: this.deviceId };
  }

  isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    this.build();
    this.interval = setInterval(() => void this.tick(), this.pollIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private build(): void {
    const doc = this.doc;
    const root = this.options.root;
    root.innerHTML = '';

    const heading = el(doc, 'div', { class: 'panel-heading compact' }, [
      el(doc, 'span', { class: 'step-number' }, ['03']),
      el(doc, 'div', {}, [
        el(doc, 'p', { class: 'eyebrow' }, [L.calRemote]),
        el(doc, 'h2' , {}, [L.calTitle]),
      ]),
      el(doc, 'button', { type: 'button', class: 'calibration-expand', 'data-calibration-action': 'expand' }, [
        L.calExpand,
      ]),
    ]);

    this.statusEl = el(doc, 'p', { class: 'calibration-status' }, [L.calUndetected]);

    // --- 目前生效標定（真機除錯第一眼：載入的到底是哪一份）---------------
    const activeProfile = el(doc, 'section', { class: 'active-profile', 'data-active-profile': '' }, [
      el(doc, 'p', { class: 'active-profile-title' }, [L.calActiveTitle]),
      el(doc, 'dl', { class: 'active-profile-grid' }, [
        el(doc, 'div', {}, [el(doc, 'dt', {}, [L.calActiveFile]), (this.activeFileEl = el(doc, 'dd', { 'data-active-file': '' }, ['—']))]),
        el(doc, 'div', {}, [el(doc, 'dt', {}, [L.calActiveSaved]), (this.activeSavedEl = el(doc, 'dd', { 'data-active-saved': '' }, ['—']))]),
        el(doc, 'div', {}, [el(doc, 'dt', {}, [L.calActiveOrigin]), (this.activeOriginEl = el(doc, 'dd', { 'data-active-origin': '' }, ['—']))]),
        el(doc, 'div', {}, [el(doc, 'dt', {}, [L.calActiveDevice]), (this.activeDeviceEl = el(doc, 'dd', { 'data-active-device': '' }, ['—']))]),
      ]),
      el(doc, 'p', { class: 'active-profile-mapping', 'data-active-mapping': '' }, ['—']),
      el(doc, 'button', { type: 'button', class: 'active-profile-clear', 'data-calibration-action': 'clear' }, [L.calActiveClear]),
    ]);
    this.activeMappingEl = activeProfile.querySelector<HTMLElement>('[data-active-mapping]');

    // --- 即時通道：原始值 + 對應功能 + 是否反向 + 歸一化值 ----------------
    const monitor = el(doc, 'div', { class: 'channel-monitor', 'data-channel-monitor': '' });
    for (let index = 0; index < MAX_MONITOR_CHANNELS; index += 1) {
      const rawEl = el(doc, 'span', { class: 'channel-value', 'data-channel-raw': String(index) }, ['0.000']);
      const bar = el(doc, 'i', { 'data-channel-bar': String(index) });
      const mapEl = el(doc, 'span', { class: 'channel-map', 'data-channel-map': String(index) }, ['未使用']);
      const normEl = el(doc, 'span', { class: 'channel-norm', 'data-channel-norm': String(index) }, ['—']);
      this.channelRawEls.push(rawEl);
      this.channelBarEls.push(bar);
      this.channelMapEls.push(mapEl);
      this.channelNormEls.push(normEl);
      monitor.append(
        el(doc, 'div', { class: 'channel-row' }, [
          el(doc, 'span', { class: 'channel-name' }, [`axis${index}`]),
          rawEl,
          el(doc, 'span', { class: 'channel-bar' }, [bar]),
          mapEl,
          normEl,
        ]),
      );
    }

    // --- 搖桿軸向快速測試（只測 pitch / roll，不套用任何修改）---------------
    this.probeEmptyEl = el(doc, 'p', { class: 'stick-probe-empty', 'data-stick-probe-empty': '' }, [NO_GAMEPAD_HINT]);
    const probeRows = el(doc, 'div', { class: 'stick-probe-rows' });
    for (const test of STICK_PROBE_TESTS) {
      const resultEl = el(doc, 'p', { class: 'stick-probe-result', 'data-stick-probe-result': test.key }, ['—']);
      this.probeResultEls.set(test.key, resultEl);
      probeRows.append(
        el(doc, 'div', { class: 'stick-probe-row', 'data-stick-probe-row': test.key }, [
          el(doc, 'div', { class: 'stick-probe-head' }, [
            el(doc, 'span', { class: 'stick-probe-label' }, [`${test.label}（${test.action}）`]),
            el(doc, 'button', { type: 'button', class: 'stick-probe-start', 'data-stick-probe': test.key }, ['開始測試']),
          ]),
          resultEl,
        ]),
      );
    }
    const probe = el(doc, 'section', { class: 'stick-probe', 'data-stick-probe-section': '' }, [
      el(doc, 'p', { class: 'calibration-subhead' }, ['搖桿軸向快速測試（僅 pitch / roll）']),
      el(doc, 'p', { class: 'stick-probe-hint' }, [
        '按「開始測試」→ 只推指定的那根桿到底並保持一秒 → 放開。系統只記錄軸號、符號、峰值，不會修改任何映射。',
      ]),
      this.probeEmptyEl,
      probeRows,
      el(doc, 'button', { type: 'button', class: 'stick-probe-export', 'data-stick-probe-action': 'export' }, [
        '匯出測試結果 JSON',
      ]),
    ]);

    // --- 原始軸連續錄製（不依賴操作品質的診斷）-----------------------------
    this.recordStatusEl = el(doc, 'p', { class: 'rec-status', 'data-record-status': '' }, ['']);
    this.recordResultsEl = el(doc, 'p', { class: 'rec-results', 'data-record-results': '' }, ['—']);
    this.recordSuggestionEl = el(doc, 'p', { class: 'rec-suggestion', 'data-record-suggestion': '' }, ['—']);
    this.recordApplyEl = el(doc, 'button', { type: 'button', 'data-record-action': 'apply', hidden: '' }, [
      L.calRecordApply,
    ]) as HTMLButtonElement;
    this.recordExportEl = el(doc, 'button', { type: 'button', 'data-record-action': 'export', hidden: '' }, [L.calRecordExport]) as HTMLButtonElement;
    const recorder = el(doc, 'section', { class: 'axis-recorder', 'data-axis-recorder': '' }, [
      el(doc, 'p', { class: 'calibration-subhead' }, [L.calRecordTitle]),
      el(doc, 'p', { class: 'rec-hint' }, [L.calRecordHint]),
      el(doc, 'div', { class: 'rec-actions' }, [
        el(doc, 'button', { type: 'button', 'data-record-action': 'start' }, [L.calRecordStart]),
        this.recordApplyEl,
        this.recordExportEl,
      ]),
      this.recordStatusEl,
      this.recordResultsEl,
      el(doc, 'p', { class: 'calibration-subhead' }, [L.calRecordSuggestionTitle]),
      this.recordSuggestionEl,
    ]);

    // --- 漂移診斷（靜止值 / 死區 / 重設位置）--------------------------------
    const driftRows = el(doc, 'div', { class: 'drift-rows', 'data-drift-rows': '' });
    for (const { key, short } of FUNCTION_META) {
      const restEl = el(doc, 'span', { class: 'drift-value', 'data-drift-rest': key }, ['0.000']);
      const normEl = el(doc, 'span', { class: 'drift-norm', 'data-drift-norm': key }, ['—']);
      this.driftRestEls.set(key, restEl);
      this.driftNormEls.set(key, normEl);
      driftRows.append(
        el(doc, 'div', { class: 'drift-row' }, [
          el(doc, 'span', { class: 'drift-name' }, [short]),
          el(doc, 'span', { class: 'drift-label' }, ['靜止原始']),
          restEl,
          el(doc, 'span', { class: 'drift-label' }, ['歸一化']),
          normEl,
        ]),
      );
    }
    this.driftNoteEl = el(doc, 'p', { class: 'drift-note', 'data-drift-note': '' }, ['']);
    this.driftCenterEl = el(doc, 'p', { class: 'drift-center', 'data-drift-center': '', hidden: '' }, ['']);
    const drift = el(doc, 'section', { class: 'drift-diagnosis', 'data-drift-diagnosis': '' }, [
      el(doc, 'p', { class: 'calibration-subhead' }, [L.calDriftTitle]),
      el(doc, 'p', { class: 'drift-hint' }, [L.calDriftHint]),
      driftRows,
      this.driftCenterEl,
      this.driftNoteEl,
      el(doc, 'div', { class: 'drift-actions' }, [
        el(doc, 'button', { type: 'button', 'data-drift-action': 'center' }, [L.calDriftCenter]),
        el(doc, 'button', { type: 'button', 'data-drift-action': 'reset' }, [L.calDriftReset]),
      ]),
    ]);

    // --- 方向驗收（右桿 pitch / roll 即時綠紅燈）---------------------------
    const acceptanceRows = el(doc, 'div', { class: 'acceptance-rows', 'data-acceptance-rows': '' });
    for (const item of ACCEPTANCE_LABELS) {
      const resultEl = el(doc, 'p', { class: 'acceptance-result', 'data-acceptance-result': item.key }, ['—']);
      const button = el(doc, 'button', { type: 'button', 'data-acceptance-action': item.key }, ['開始測試']) as HTMLButtonElement;
      this.acceptanceResultEls.set(item.key, resultEl);
      this.acceptanceButtonEls.set(item.key, button);
      acceptanceRows.append(
        el(doc, 'div', { class: 'acceptance-row', 'data-acceptance-row': item.key }, [
          el(doc, 'div', { class: 'acceptance-head' }, [
            el(doc, 'span', { class: 'acceptance-label' }, [item.label]),
            button,
          ]),
          el(doc, 'p', { class: 'acceptance-hint' }, [item.hint]),
          resultEl,
        ]),
      );
    }
    this.acceptanceExportEl = el(doc, 'button', { type: 'button', 'data-acceptance-action': 'export' }, [
      '匯出驗收結果 JSON',
    ]) as HTMLButtonElement;
    const acceptance = el(doc, 'section', { class: 'acceptance', 'data-acceptance': '' }, [
      el(doc, 'p', { class: 'calibration-subhead' }, [L.calAcceptTitle]),
      el(doc, 'p', { class: 'acceptance-hint' }, [L.calAcceptHint]),
      acceptanceRows,
      this.acceptanceExportEl,
    ]);

    const bindings = el(doc, 'div', { class: 'calibration-bindings', 'data-calibration-bindings': '' });
    for (const { key, name } of FUNCTION_META) {
      bindings.append(this.buildBindingRow(key, name));
    }

    const actions = el(doc, 'div', { class: 'calibration-actions' }, [
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'save' }, [L.calSave]),
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'export' }, [L.calExport]),
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'import' }, [L.calImport]),
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'measure' }, [L.calMeasure]),
      el(doc, 'input', { type: 'file', hidden: '', accept: 'application/json', 'data-calibration-import': '' }),
    ]);

    // --- 引導式標定（以實測為準）-----------------------------------------
    const guidedButtons = el(doc, 'div', { class: 'guided-actions' }, [
      (this.guidedButtons.start = el(doc, 'button', { type: 'button', 'data-guided-action': 'start' }, [L.calGuidedStart]) as HTMLButtonElement),
      (this.guidedButtons.confirm = el(doc, 'button', { type: 'button', 'data-guided-action': 'confirm', hidden: '' }, [L.calGuidedConfirm]) as HTMLButtonElement),
      (this.guidedButtons.retry = el(doc, 'button', { type: 'button', 'data-guided-action': 'retry', hidden: '' }, [L.calGuidedRetry]) as HTMLButtonElement),
      (this.guidedButtons.save = el(doc, 'button', { type: 'button', 'data-guided-action': 'save', hidden: '' }, [L.calGuidedSave]) as HTMLButtonElement),
      (this.guidedButtons.reset = el(doc, 'button', { type: 'button', 'data-guided-action': 'reset', hidden: '' }, [L.calGuidedReset]) as HTMLButtonElement),
    ]);
    this.guidedStepEl = el(doc, 'p', { class: 'guided-step', 'data-guided-step': '' }, [L.calGuidedIdleStep]);
    this.guidedPromptEl = el(doc, 'p', { class: 'guided-prompt', 'data-guided-prompt': '' }, [L.calGuidedIdlePrompt]);
    this.guidedHintEl = el(doc, 'p', { class: 'guided-hint', 'data-guided-hint': '' }, [L.calGuidedIdleHint]);
    this.guidedErrorEl = el(doc, 'p', { class: 'guided-error', 'data-guided-error': '', hidden: '' }, ['']);
    this.guidedDetectionEl = el(doc, 'p', { class: 'guided-detection', 'data-guided-detection': '', hidden: '' }, ['']);
    this.guidedPeakEl = el(doc, 'p', { class: 'guided-peak', 'data-guided-peak': '', hidden: '' }, ['']);
    const guided = el(doc, 'section', { class: 'guided-calibration', 'data-guided-calibration': '' }, [
      el(doc, 'p', { class: 'calibration-subhead' }, [L.calGuidedTitle]),
      this.guidedStepEl,
      this.guidedPromptEl,
      this.guidedHintEl,
      this.guidedErrorEl,
      this.guidedPeakEl,
      this.guidedDetectionEl,
      guidedButtons,
    ]);

    this.hintEl = el(doc, 'p', { class: 'calibration-hint' }, [
      L.calHint,
    ]);

    root.append(
      el(doc, 'section', { class: 'panel calibration-panel', 'data-calibration-panel': '' }, [
        heading,
        this.statusEl,
        activeProfile,
        el(doc, 'p', { class: 'calibration-subhead' }, [L.calRealtime]),
        monitor,
        probe,
        recorder,
        drift,
        acceptance,
        guided,
        bindings,
        actions,
        this.hintEl,
      ]),
    );

    this.wireActions();
    this.wireGuidedActions();
    this.wireStickProbe();
    this.wireRecorder();
    this.wireDrift();
    this.wireAcceptance();
    this.updateActiveProfileDisplay();
  }

  private buildBindingRow(key: keyof AxisBindings, name: string): HTMLElement {
    const doc = this.doc;
    const sourceOptions = Array.from({ length: MAX_MONITOR_CHANNELS }, (_, i) =>
      el(doc, 'option', { value: String(i) }, [`CH${i + 1}`]),
    );
    const calEl = el(doc, 'span', { class: 'binding-cal', 'data-cal': key }, ['-1.00 / 0.00 / 1.00']);
    this.calEls.set(key, calEl);

    return el(doc, 'div', { class: 'binding-row', 'data-binding': key }, [
      el(doc, 'span', { class: 'binding-name' }, [name]),
      el(doc, 'label', {}, [L.calChannel, el(doc, 'select', { 'data-source': key }, sourceOptions)]),
      el(doc, 'label', {}, [
        L.calType,
        el(doc, 'select', { 'data-kind': key }, [
          el(doc, 'option', { value: 'bipolar' }, [L.calBipolar]),
          el(doc, 'option', { value: 'unipolar' }, [L.calUnipolar]),
        ]),
      ]),
      el(doc, 'label', {}, [L.calReverse, el(doc, 'input', { type: 'checkbox', 'data-reverse': key })]),
      el(doc, 'label', {}, [L.calDeadzone, el(doc, 'input', { type: 'range', min: '0', max: '0.9', step: '0.05', 'data-deadzone': key })]),
      el(doc, 'label', {}, [L.calExpo, el(doc, 'input', { type: 'range', min: '0', max: '1', step: '0.05', 'data-expo': key })]),
      calEl,
      el(doc, 'div', { class: 'capture-buttons' }, [
        el(doc, 'button', { type: 'button', 'data-capture': `${key}:min` }, [L.calCaptureMin]),
        el(doc, 'button', { type: 'button', 'data-capture': `${key}:center` }, [L.calCaptureCenter]),
        el(doc, 'button', { type: 'button', 'data-capture': `${key}:max` }, [L.calCaptureMax]),
      ]),
    ]);
  }

  private wireActions(): void {
    const root = this.options.root;
    root.querySelectorAll<HTMLButtonElement>('[data-capture]').forEach((button) => {
      button.addEventListener('click', () => this.toggleCapture(button));
    });
    root.querySelector<HTMLButtonElement>('[data-calibration-action="save"]')?.addEventListener('click', () => void this.save());
    root.querySelector<HTMLButtonElement>('[data-calibration-action="export"]')?.addEventListener('click', () => this.exportProfile());
    root.querySelector<HTMLButtonElement>('[data-calibration-action="clear"]')?.addEventListener('click', () => void this.clearLocalProfile());
    root.querySelector<HTMLButtonElement>('[data-calibration-action="measure"]')?.addEventListener('click', () => this.exportMeasurement());
    root.querySelector<HTMLButtonElement>('[data-calibration-action="expand"]')?.addEventListener('click', (event) => {
      const expanded = root.classList.toggle('is-expanded');
      const button = event.currentTarget as HTMLButtonElement;
      button.textContent = expanded ? L.calCollapse : L.calExpand;
      button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    });
    const importButton = root.querySelector<HTMLButtonElement>('[data-calibration-action="import"]');
    const importInput = root.querySelector<HTMLInputElement>('[data-calibration-import]');
    importButton?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', () => void this.importProfile(importInput));

    for (const { key } of FUNCTION_META) {
      const source = root.querySelector<HTMLSelectElement>(`[data-source="${key}"]`);
      source?.addEventListener('change', () => {
        const state = this.draft?.get(key);
        if (state && source.value !== '') state.binding = { ...state.binding, source: Number(source.value) };
      });
      const kind = root.querySelector<HTMLSelectElement>(`[data-kind="${key}"]`);
      kind?.addEventListener('change', () => {
        const state = this.draft?.get(key);
        if (state && (kind.value === 'bipolar' || kind.value === 'unipolar')) {
          state.binding = { ...state.binding, kind: kind.value as AxisRangeKind };
        }
      });
      const reverse = root.querySelector<HTMLInputElement>(`[data-reverse="${key}"]`);
      reverse?.addEventListener('change', () => {
        const state = this.draft?.get(key);
        if (state) state.binding = { ...state.binding, calibration: { ...state.binding.calibration, reverse: reverse.checked } };
      });
      const deadzone = root.querySelector<HTMLInputElement>(`[data-deadzone="${key}"]`);
      deadzone?.addEventListener('input', () => {
        const state = this.draft?.get(key);
        if (state) state.binding = { ...state.binding, calibration: { ...state.binding.calibration, deadzone: Number(deadzone.value) } };
      });
      const expo = root.querySelector<HTMLInputElement>(`[data-expo="${key}"]`);
      expo?.addEventListener('input', () => {
        const state = this.draft?.get(key);
        if (state) state.binding = { ...state.binding, calibration: { ...state.binding.calibration, expo: Number(expo.value) } };
      });
    }
  }

  // --- 引導式標定 -----------------------------------------------------------

  private wireGuidedActions(): void {
    const root = this.options.root;
    root.querySelector<HTMLButtonElement>('[data-guided-action="start"]')?.addEventListener('click', () => this.guidedStart());
    root.querySelector<HTMLButtonElement>('[data-guided-action="confirm"]')?.addEventListener('click', () => this.guidedConfirm());
    root.querySelector<HTMLButtonElement>('[data-guided-action="retry"]')?.addEventListener('click', () => this.guidedRetry());
    root.querySelector<HTMLButtonElement>('[data-guided-action="save"]')?.addEventListener('click', () => void this.guidedSave());
    root.querySelector<HTMLButtonElement>('[data-guided-action="reset"]')?.addEventListener('click', () => this.guidedReset());
  }

  /**
   * 開始這一步：先要求所有搖桿回中，把當前採樣當作中位基線。
   * 螢幕上方的即時通道可以確認基線是否真的居中。
   */
  private guidedStart(): void {
    if (!this.connected || !this.lastRaw) {
      this.setHint('未連接遙控器，無法進行引導式標定。');
      return;
    }
    // 量測前提：自回中搖桿必須真的回中，否則基線被污染，偵測到的軸與方向都會錯。
    const offCenter = this.offCenterAxes(this.lastRaw.channels);
    if (offCenter.length > 0) {
      const detail = offCenter
        .map((item) => `${item.fn}(axis${item.axis})=${item.value.toFixed(2)}，中位 ${item.center.toFixed(2)}`)
        .join('；');
      this.setHint(`搖桿尚未回中：${detail}。請先把所有搖桿回中（油門拉到最底），再按「開始這步」。`);
      return;
    }
    this.guided.arm(this.lastRaw.channels);
    this.setHint(L.calGuidedArmed);
    this.updateGuidedDisplay();
  }

  /** 目前偏離中位超過 0.3 的自回中軸（油門是單向，不列入）。 */
  private offCenterAxes(channels: readonly number[]): Array<{ fn: string; axis: number; value: number; center: number }> {
    const result: Array<{ fn: string; axis: number; value: number; center: number }> = [];
    if (!this.draft) return result;
    for (const { key, short } of FUNCTION_META) {
      const state = this.draft.get(key);
      if (!state || state.binding.kind !== 'bipolar') continue;
      const value = channels[state.binding.source];
      if (!Number.isFinite(value)) continue;
      const center = state.binding.calibration.center;
      if (Math.abs(value - center) > 0.3) result.push({ fn: short, axis: state.binding.source, value, center });
    }
    return result;
  }

  private guidedConfirm(): void {
    const step = this.guided.currentStep;
    const result = this.guided.confirm();
    if (result && step) {
      this.setHint(`已記錄：${step.title} ← axis${result.axis}`);
    }
    this.updateGuidedDisplay();
  }

  private guidedRetry(): void {
    this.guided.retry();
    this.updateGuidedDisplay();
  }

  private guidedReset(): void {
    this.guided.reset();
    this.updateGuidedDisplay();
  }

  /** 四步全部實測完成後：存成新 profile（時間戳最新）並立即套用。 */
  private async guidedSave(): Promise<void> {
    const deviceId = this.deviceId ?? this.options.adapter.id;
    if (!this.guided.isComplete()) {
      this.setHint('引導式標定尚未完成四個步驟。');
      return;
    }
    const savedAtMs = Date.now();
    const profile = this.guided.buildProfile(
      deviceId,
      { gimbal: this.gimbal, armButton: this.armButton },
      `引導標定 Mode2 · ${new Date(savedAtMs).toLocaleString('zh-Hant')}`,
    );
    if (!profile) {
      this.setHint('引導式標定資料不完整，請全部重做。');
      return;
    }
    try {
      await this.options.store.write(profile, savedAtMs, { kind: 'guided' });
      this.setOrigin({ kind: 'guided', file: '', savedAtMs });
      this.loadProfile(profile);
      this.options.onProfileApplied?.(profile, this.origin);
      this.guided.reset();
      this.updateGuidedDisplay();
      this.updateActiveProfileDisplay();
      this.setHint(L.calGuidedApplied);
    } catch (error) {
      this.setHint(`儲存失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private guidedTick(raw: RawPilotInput): void {
    if (this.guided.currentPhase !== 'arming') return;
    const detection = this.guided.feed(raw.channels);
    // 鎖定成功或同軸錯誤：重新整理引導區顯示。
    if (detection !== null || this.guided.error !== null) this.updateGuidedDisplay();
    // 即便未達 0.7，也持續顯示目前峰值，提示「請推到底」。
    const soft = this.guided.currentSoftPeak;
    if (!detection && this.guided.error === null && soft && this.guidedPeakEl) {
      this.guidedPeakEl.hidden = false;
      this.guidedPeakEl.textContent = `目前峰值 ${soft.deviation.toFixed(2)}（需 ≥ ${GUIDED_MIN_PEAK.toFixed(2)}）：請把這根搖桿推到底再放開。`;
    }
  }

  private updateGuidedDisplay(): void {
    const phase = this.guided.currentPhase;
    const step = this.guided.currentStep;
    if (this.guidedStepEl) {
      this.guidedStepEl.textContent = phase === 'done' ? L.calGuidedDoneStep : L.calGuidedStepLabel(this.guided.stepNumber, this.guided.totalSteps);
    }
    if (this.guidedPromptEl) {
      this.guidedPromptEl.textContent = step
        ? L.calGuidedStepPrompt(step.stick, step.direction, step.expected) + (step.prepare ? ` ${step.prepare}` : '')
        : L.calGuidedDonePrompt;
    }
    if (this.guidedHintEl) {
      this.guidedHintEl.textContent =
        phase === 'arming' ? L.calGuidedArmed : phase === 'detected' ? L.calGuidedConfirmHint : phase === 'error' ? L.calGuidedErrorHint : L.calGuidedIdleHint;
    }
    if (this.guidedErrorEl) {
      const message = this.guided.error;
      this.guidedErrorEl.hidden = !message;
      this.guidedErrorEl.textContent = message ?? '';
    }
    if (this.guidedDetectionEl) {
      const result = this.guided.pendingResult();
      if (result && step) {
        this.guidedDetectionEl.hidden = false;
        this.guidedDetectionEl.textContent = describeDetection(step, result);
      } else {
        this.guidedDetectionEl.hidden = true;
        this.guidedDetectionEl.textContent = '';
      }
    }
    const show = (key: 'start' | 'confirm' | 'retry' | 'save' | 'reset', visible: boolean): void => {
      const button = this.guidedButtons[key];
      if (button) button.hidden = !visible;
    };
    show('start', phase === 'idle');
    show('confirm', phase === 'detected');
    show('retry', phase === 'detected' || phase === 'error' || phase === 'arming');
    show('save', phase === 'done');
    show('reset', phase === 'done' || phase === 'detected' || phase === 'error' || phase === 'arming');
    if (this.guidedPeakEl) this.guidedPeakEl.hidden = phase !== 'arming';
  }

  // --- 搖桿軸向快速測試（pitch / roll）--------------------------------------

  private wireStickProbe(): void {
    const root = this.options.root;
    root.querySelectorAll<HTMLButtonElement>('[data-stick-probe]').forEach((button) => {
      button.addEventListener('click', () => this.startStickProbe(button.dataset.stickProbe as StickProbeTestKey));
    });
    root
      .querySelector<HTMLButtonElement>('[data-stick-probe-action="export"]')
      ?.addEventListener('click', () => this.exportStickProbe());
  }

  private wireRecorder(): void {
    const root = this.options.root;
    root.querySelector<HTMLButtonElement>('[data-record-action="start"]')?.addEventListener('click', () => this.startRecording());
    this.recordApplyEl?.addEventListener('click', () => void this.applySuggestion());
    this.recordExportEl?.addEventListener('click', () => this.exportRecording());
  }

  private wireDrift(): void {
    this.options.root.querySelector<HTMLButtonElement>('[data-drift-action="reset"]')?.addEventListener('click', () => {
      this.options.onResetPosition?.();
      this.setHint('已傳送「重設位置」指令至飛行模型（位置與速度歸零）。');
    });
    this.options.root
      .querySelector<HTMLButtonElement>('[data-drift-action="center"]')
      ?.addEventListener('click', () => void this.applyCenterCompensation());
  }

  private wireAcceptance(): void {
    const root = this.options.root;
    for (const { key } of ACCEPTANCE_LABELS) {
      root
        .querySelector<HTMLButtonElement>(`[data-acceptance-action="${key}"]`)
        ?.addEventListener('click', () => this.startAcceptance(key));
    }
    this.acceptanceExportEl?.addEventListener('click', () => this.exportAcceptance());
  }

  /** 開始一項測試：記下基線，之後由 probeTick 追峰值。 */
  private startStickProbe(key: StickProbeTestKey): void {
    const test = STICK_PROBE_TESTS.find((candidate) => candidate.key === key);
    if (!test) return;
    if (!this.connected || !this.lastRaw) {
      this.renderStickProbe();
      this.setHint(NO_GAMEPAD_HINT);
      return;
    }
    // 基線被污染時峰值會算錯：要求先放開這根桿。
    const state = this.draft?.get(key);
    if (state) {
      const value = this.lastRaw.channels[state.binding.source];
      const center = state.binding.calibration.center;
      if (Number.isFinite(value) && Math.abs(value - center) > STICK_PROBE_THRESHOLD) {
        this.setHint(`請先放開「${test.label}」搖桿回到中位，再按「開始測試」。`);
        return;
      }
    }
    this.probeArmed = {
      key,
      baseline: this.lastRaw.channels.slice(),
      best: null,
      startedAt: this.now(),
    };
    this.probeResults.delete(key);
    this.renderStickProbe();
    this.setHint(`測試中：請把「${test.label}」${test.action}到最底並保持一秒，然後放開。`);
  }

  /**
   * 每個 tick 追蹤最大位移。放開（回到基線附近）或超過 8 秒就定案；
   * 12 秒內完全沒有位移則判為 no-motion。全程只記錄，不套用任何修改。
   */
  private probeTick(raw: RawPilotInput): void {
    const armed = this.probeArmed;
    if (!armed) return;
    armed.best = trackStickPeak(armed.best, armed.baseline, raw.channels);
    const current = detectStickPeak(armed.baseline, raw.channels, 0.05);
    const released = !current || current.deviation < 0.15;
    const elapsed = this.now() - armed.startedAt;
    if ((armed.best !== null && released) || elapsed > 8000) this.finishStickProbe(armed.best);
    else if (elapsed > 12000) this.finishStickProbe(null);
  }

  private finishStickProbe(peak: StickPeak | null): void {
    const armed = this.probeArmed;
    if (!armed) return;
    const test = STICK_PROBE_TESTS.find((candidate) => candidate.key === armed.key);
    this.probeArmed = null;
    if (!test) return;
    const binding = this.draft?.get(test.key)?.binding ?? null;
    const result = judgeStickProbe(test, peak, binding);
    this.probeResults.set(test.key, result);
    this.revalidateProbe();
    this.renderStickProbe();
    this.setHint(result.message);
  }

  private renderStickProbe(): void {
    if (this.probeEmptyEl) this.probeEmptyEl.hidden = this.connected;
    for (const test of STICK_PROBE_TESTS) {
      const resultEl = this.probeResultEls.get(test.key);
      if (!resultEl) continue;
      if (this.probeArmed?.key === test.key) {
        resultEl.textContent = '測試中…請推到底並保持一秒，然後放開。';
        resultEl.dataset.verdict = 'pending';
        continue;
      }
      const result = this.probeResults.get(test.key);
      resultEl.textContent = result ? result.message : '—';
      resultEl.dataset.verdict = result ? result.verdict : 'idle';
    }
  }

  /** 匯出目前兩項測試的結果（含建議），供貼回或存檔比對。 */
  exportStickProbe(): void {
    const info = this.getActiveProfileInfo();
    const report = buildStickProbeReport({
      capturedAt: new Date().toISOString(),
      deviceId: this.deviceId,
      profile: info
        ? {
            originKind: info.origin.kind,
            file: info.origin.file ?? '',
            savedAtMs: info.origin.savedAtMs ?? 0,
          }
        : null,
      mapping: info ? describeAxisMapping(info.profile) : null,
      results: [...this.probeResults.values()],
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = this.doc.createElement('a');
    anchor.href = url;
    anchor.download = `fde-stick-axis-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setHint('已匯出搖桿軸向測試結果 JSON。');
  }

  // --- 原始軸連續錄製（不依賴操作品質的診斷）-------------------------------

  private startRecording(): void {
    if (!this.connected || !this.lastRaw) {
      this.setHint(NO_GAMEPAD_HINT);
      return;
    }
    this.stopRecordingTimer();
    const durationMs = this.recordingDurationMs();
    this.recordingSamples = [];
    this.recordingSuggestion = null;
    this.recording = { samples: this.recordingSamples, startedAt: this.now(), durationMs };
    this.recordingReport = null;
    if (this.recordApplyEl) this.recordApplyEl.hidden = true;
    if (this.recordExportEl) this.recordExportEl.hidden = true;
    if (this.recordSuggestionEl) this.recordSuggestionEl.textContent = '—';
    if (this.recordResultsEl) this.recordResultsEl.textContent = '錄製中…';
    if (this.recordStatusEl) this.recordStatusEl.textContent = RECORDING_PROMPT;
    this.recordingTimer = setTimeout(() => this.stopRecording(), durationMs);
    this.setHint(`錄製開始：${RECORDING_PROMPT}`);
  }

  /**
   * 錄製長度。預設 10 秒；瀏覽器測試可用 `window.__fdeRecordingDurationMs`
   * 暫時改短（與 `__fdeInputClock` 同一類型的測試接縫）。
   */
  private recordingDurationMs(): number {
    const override = (this.doc.defaultView as unknown as { __fdeRecordingDurationMs?: number } | null)
      ?.__fdeRecordingDurationMs;
    return typeof override === 'number' && override > 0 ? override : RECORDING_DURATION_MS;
  }

  private stopRecordingTimer(): void {
    if (this.recordingTimer !== null) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private stopRecording(): void {
    this.stopRecordingTimer();
    const rec = this.recording;
    this.recording = null;
    if (!rec) return;
    const report = analyzeRecording(rec.samples, this.deviceId, this.now() - rec.startedAt);
    this.recordingReport = report;
    this.renderRecording();
    if (this.recordExportEl) this.recordExportEl.hidden = false;
    const top = report.ranked.slice(0, 4).join(' / ');
    if (this.recordStatusEl) {
      this.recordStatusEl.textContent = `錄製完成：${report.sampleCount} 個樣本，最會動的軸依序為 ${top}`;
    }
    this.setHint(`錄製完成：最會動的軸 ${top}。右桿上下應對到其中最大的軸，右桿左右對到次大的軸。`);
    this.updateRecordingSuggestion();
  }

  /**
   * 依「畫圈段落」分析錄製樣本，得出 pitch / roll 的 source 與 reverse 建議。
   * 只計算與顯示：不寫入任何東西，要等使用者按「套用建議」。
   */
  private updateRecordingSuggestion(): void {
    const current =
      this.draft && this.draft.has('pitch') && this.draft.has('roll')
        ? { pitch: this.draft.get('pitch')!.binding, roll: this.draft.get('roll')!.binding }
        : null;
    const suggestion = suggestFromRecording(this.recordingSamples, current);
    this.recordingSuggestion = suggestion;
    if (this.recordSuggestionEl) {
      this.recordSuggestionEl.textContent = describeSuggestion(suggestion);
      this.recordSuggestionEl.dataset.verdict = suggestion.ok ? (suggestion.matches.pitch && suggestion.matches.roll ? 'match' : 'differs') : 'invalid';
    }
    if (this.recordApplyEl) {
      const nothingToApply = suggestion.ok && suggestion.matches.pitch && suggestion.matches.roll;
      this.recordApplyEl.hidden = !suggestion.ok || nothingToApply;
    }
    if (!suggestion.ok) {
      this.setHint(
        `錄製結果無效：${suggestion.retryHint ?? '請推到底重錄'}（建議需要兩組峰值都 ≥ ${SUGGESTION_MIN_PEAK.toFixed(2)} 且為不同軸）。`,
      );
    }
  }

  private renderRecording(): void {
    const report = this.recordingReport;
    if (!this.recordResultsEl) return;
    if (!report) {
      this.recordResultsEl.textContent = '—';
      return;
    }
    const lines = report.axes
      .slice()
      .sort((a, b) => b.span - a.span)
      .slice(0, MAX_MONITOR_CHANNELS)
      .map(
        (stat) =>
          `axis${stat.axis}：min ${stat.min.toFixed(3)} / max ${stat.max.toFixed(3)} / 均值 ${stat.mean.toFixed(3)} / 起始 ${stat.start.toFixed(3)} / 結束 ${stat.end.toFixed(3)}（變化 ${stat.span.toFixed(3)}）`,
      );
    this.recordResultsEl.textContent = lines.join('\n') || '（無變化）';
  }

  private exportRecording(): void {
    const report = this.recordingReport;
    if (!report) {
      this.setHint('尚無錄製結果可匯出，請先「錄製 10 秒」。');
      return;
    }
    // 匯出內容包含建議本身：貼回來時不必再肉眼比對。
    const text = JSON.stringify(
      {
        ...report,
        suggestion: this.recordingSuggestion
          ? {
              ok: this.recordingSuggestion.ok,
              pitch: this.recordingSuggestion.pitch,
              roll: this.recordingSuggestion.roll,
              sameAxis: this.recordingSuggestion.sameAxis,
              retryHint: this.recordingSuggestion.retryHint,
              current: this.recordingSuggestion.current,
              matches: this.recordingSuggestion.matches,
            }
          : null,
      },
      null,
      2,
    );
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = this.doc.createElement('a');
    anchor.href = url;
    anchor.download = `fde-raw-axis-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setHint('已匯出原始軸錄製 JSON（含 pitch / roll 建議）。');
  }

  /**
   * 套用錄製建議：只改 pitch / roll 的 source 與 reverse，其餘欄位原樣保留。
   *
   * 寫入順序（都只在使用者按下按鈕後發生）：
   *  1. 先在本機生效（不等伺服器）：套用 → 存 IndexedDB → 重載草稿；
   *  2. 再把整份 profile 送到擷取檔端點：伺服器備份舊檔、寫入 mtime 最新的
   *     新檔，並同步 public/ 與 dist/ 的靜態回退檔；
   *  3. 端點不存在（純靜態部署）時只做本機生效，並提示手動放置 JSON。
   */
  private async applySuggestion(): Promise<void> {
    const suggestion = this.recordingSuggestion;
    if (!suggestion || !suggestion.ok) {
      this.setHint('尚無有效建議（兩組峰值都需 ≥ 0.70 且必須是不同軸），請推到底重錄。');
      return;
    }
    if (suggestion.matches.pitch && suggestion.matches.roll) {
      this.setHint('目前綁定已與建議一致，不需要套用。');
      return;
    }
    const profile = this.getProfile();
    if (!profile) {
      this.setHint('尚未連接遙控器，無法套用。');
      return;
    }
    const changes = suggestionChanges(suggestion);
    if (changes.length === 0) {
      this.setHint('目前綁定已與建議一致，不需要套用。');
      if (this.recordApplyEl) this.recordApplyEl.hidden = true;
      return;
    }
    const next = applySuggestionToProfile(profile, suggestion);
    if (!next) {
      this.setHint('建議不完整（缺少軸或 reverse），已取消套用。');
      return;
    }
    // 只會寫入「與建議不一致」的通道：已驗證正確的通道（例如真機已確認的
    // roll←axis0）不會被碰。
    const changeText = changes
      .map((key) => {
        const item = key === 'pitch' ? suggestion.pitch : suggestion.roll;
        const before = profile.axes[key];
        return (
          `${key} axis${before.source}(reverse=${before.calibration.reverse ? 'true' : 'false'})` +
          ` → axis${item.axis}（reverse=${item.reverse ? 'true' : 'false'}）`
        );
      })
      .join('；');
    const untouched = (['pitch', 'roll'] as const).filter((key) => !changes.includes(key));
    const savedAtMs = Date.now();

    // 1) 本機立即生效
    await this.options.store.write(next, savedAtMs, { kind: 'suggestion' });
    this.loadProfile(next);
    this.setOrigin({ kind: 'suggestion', savedAtMs });
    this.options.onProfileApplied?.(next, this.origin);

    // 2) 伺服器落檔（備份舊檔 + mtime 最新 + 三處同步）
    const endpoint = this.options.captureEndpoint ?? '/api/rc/captures';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(toStoredDeviceProfile(next, savedAtMs, { kind: 'suggestion' })),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { file?: string; backup?: string };
      const file = typeof data.file === 'string' ? data.file : '';
      const backup = typeof data.backup === 'string' ? data.backup : '';
      this.setOrigin({ kind: 'suggestion', savedAtMs, ...(file ? { file } : {}) });
      this.updateActiveProfileDisplay();
      this.setHint(
        `已套用建議：${changeText}${untouched.length > 0 ? `（${untouched.join(' / ')} 未改動）` : ''}；` +
          `新擷取檔 ${file}（舊檔已備份：${backup || '—'}），立即生效。`,
      );
    } catch {
      this.setHint(
        `已在本機套用建議並立即生效：${changeText}${untouched.length > 0 ? `（${untouched.join(' / ')} 未改動）` : ''}；` +
          '但擷取檔端點未連上（純靜態部署？）。請按「匯出錄製 JSON」把檔案手動放到標定檔目錄，之後重新載入即可讓其他裝置也用到。',
      );
    }
  }

  /** tick 中把當前原始通道推入錄製樣本（錄製進行時才生效）。 */
  private recordSample(raw: RawPilotInput): void {
    if (!this.recording) return;
    this.recording.samples.push(raw.channels.slice(0, MAX_MONITOR_CHANNELS));
  }

  /**
   * 兩組測試若指向同一個 axis，結論無效：真機右桿上下/左右應是不同的軸。
   * 在任一組定案後呼叫，必要時把兩筆都覆寫成 same-axis 無效結論。
   */
  private revalidateProbe(): void {
    const pitch = this.probeResults.get('pitch');
    const roll = this.probeResults.get('roll');
    if (!pitch || !roll) return;
    if (pitch.axis === null || roll.axis === null) return;
    if (pitch.verdict === 'same-axis' || roll.verdict === 'same-axis') return;
    if (pitch.axis === roll.axis) {
      const pt = STICK_PROBE_TESTS.find((candidate) => candidate.key === 'pitch');
      const rt = STICK_PROBE_TESTS.find((candidate) => candidate.key === 'roll');
      if (pt && rt) {
        this.probeResults.set('pitch', sameAxisVerdict(pt, pitch.axis, rt.label));
        this.probeResults.set('roll', sameAxisVerdict(rt, roll.axis, pt.label));
      }
    }
  }

  /**
   * 漂移診斷：靜止時顯示四個功能的原始值與歸一化值，檢查歸一化是否為 0
   * （死區是否生效），並在校正中心偏移時給出根因說明。只顯示、不改映射。
   */
  private updateDrift(raw: RawPilotInput): void {
    if (!this.draft) return;
    const issues: string[] = [];
    for (const { key, short } of FUNCTION_META) {
      const state = this.draft.get(key);
      if (!state) continue;
      const source = state.binding.source;
      const rawVal = source < raw.channels.length ? raw.channels[source] : NaN;
      const restEl = this.driftRestEls.get(key);
      if (restEl) restEl.textContent = Number.isFinite(rawVal) ? rawVal.toFixed(3) : '—';
      const norm = Number.isFinite(rawVal)
        ? this.normalizer.normalizeAxis(rawVal, state.binding.calibration, state.binding.kind)
        : NaN;
      const normEl = this.driftNormEls.get(key);
      if (normEl) normEl.textContent = Number.isFinite(norm) ? (norm >= 0 ? '+' : '') + norm.toFixed(2) : '—';
      if (Number.isFinite(norm) && Math.abs(norm) > 0.02) {
        const dz = state.binding.calibration.deadzone;
        issues.push(`${short} 靜止歸一化 ${norm >= 0 ? '+' : ''}${norm.toFixed(2)}（死區 ${dz.toFixed(2)}）`);
      }
    }
    if (this.driftNoteEl) {
      if (issues.length > 0) {
        this.driftNoteEl.textContent =
          `⚠ 靜止時下列功能歸一化不為 0，會產生殘餘輸入並導致機體持續漂移：${issues.join('；')}。` +
          `根因：搖桿靜止時未落在校正 center，歸一化殘餘超過該功能死區（見上方括號），` +
          `飛控把殘餘指令當成速度指令並逐幀積分（updateManual 中 velocity 由 command × 8 m/s 逼近，position 再累加 velocity；手動模式無 hover 保持）。` +
          `暫時解法：按「重設位置」清零位置/速度；根治是按下方「校正中心」（只更新 center）或加大該功能死區。`;
        this.driftNoteEl.dataset.state = 'warn';
      } else {
        this.driftNoteEl.textContent = '靜止時各功能歸一化均為 0，死區生效，不會產生殘餘漂移。';
        this.driftNoteEl.dataset.state = 'ok';
      }
    }
    this.updateCenterOffsets(raw);
  }

  /**
   * 自動置中偏移偵測：自回中軸（roll / pitch / yaw）若「停著沒動」卻偏離
   * 校正 center 超過死區，就提示按「校正中心」。油門是單向軸，不在此列
   * （它的底部由 min 決定，改 center 沒有意義）。
   */
  private updateCenterOffsets(raw: RawPilotInput): void {
    const detected = new Map<keyof AxisBindings, CenterOffsetSample>();
    if (this.draft) {
      for (const key of ['roll', 'pitch', 'yaw'] as Array<keyof AxisBindings>) {
        const state = this.draft.get(key);
        if (!state) continue;
        const source = state.binding.source;
        const value = source < raw.channels.length ? raw.channels[source] : NaN;
        if (!Number.isFinite(value)) continue;
        const ring = this.centerWatch.get(key) ?? [];
        ring.push(value);
        if (ring.length > CENTER_WATCH_SAMPLES) ring.shift();
        this.centerWatch.set(key, ring);
        if (ring.length < CENTER_WATCH_SAMPLES) continue;
        const sample = detectCenterOffset(ring, state.binding.calibration.center, state.binding.calibration.deadzone);
        if (sample.offCenter) detected.set(key, sample);
      }
    }
    this.centerOffsets = detected.size > 0 ? detected : null;
    if (this.driftCenterEl) {
      if (!detected.size) {
        this.driftCenterEl.hidden = true;
        this.driftCenterEl.textContent = '';
      } else {
        const parts: string[] = [];
        for (const [key, sample] of detected) {
          const short = FUNCTION_META.find((meta) => meta.key === key)?.short ?? key;
          parts.push(`${short} 偏離 ${sample.deviation >= 0 ? '+' : ''}${sample.deviation.toFixed(3)}`);
        }
        this.driftCenterEl.hidden = false;
        this.driftCenterEl.textContent =
          `偵測到搖桿中心偏移（${parts.join('；')}）。請鬆開搖桿回到中位，再按「校正中心」` +
          `（只更新 center 值，不會改動 source / reverse）。`;
      }
    }
  }

  /**
   * 校正中心：把偵測到偏移的自回中軸 center 設為目前靜止原始值（夾在已量測
   * 的 min/max 內）。source / kind / reverse / deadzone / expo 一律不動，
   * 寫入後立即生效並持久化（本機），不需要重新載入頁面。
   */
  private async applyCenterCompensation(): Promise<void> {
    if (!this.draft || !this.lastRaw) {
      this.setHint(NO_GAMEPAD_HINT);
      return;
    }
    const offsets = this.centerOffsets;
    if (!offsets || offsets.size === 0) {
      this.setHint('未偵測到中心偏移：搖桿靜止值已落在校正 center 的死區內。');
      return;
    }
    const changed: string[] = [];
    for (const [key, sample] of offsets) {
      const state = this.draft.get(key);
      if (!state) continue;
      const calibration = state.binding.calibration;
      const center = compensatedCenter(sample.rest, calibration);
      state.binding = { ...state.binding, calibration: { ...calibration, center } };
      state.capture = { ...state.capture, center, centerSeen: true };
      const short = FUNCTION_META.find((meta) => meta.key === key)?.short ?? key;
      changed.push(`${short} center ${calibration.center.toFixed(3)} → ${center.toFixed(3)}`);
    }
    const profile = this.getProfile();
    if (!profile) return;
    const savedAtMs = Date.now();
    await this.options.store.write(profile, savedAtMs, { kind: 'manual' });
    this.setOrigin({ kind: 'manual', savedAtMs });
    this.syncControlsFromDraft();
    this.updateActiveProfileDisplay();
    this.options.onProfileApplied?.(profile, this.origin);
    this.setHint(`已校正中心（${changed.join('；')}）：只更新 center，source / reverse 未動，立即生效。`);
  }

  // --- 方向驗收（右桿 pitch / roll 即時綠紅燈）-----------------------------

  /** 開始一項驗收：之後由 acceptanceTick 每幀判定。 */
  private startAcceptance(key: AcceptanceKey): void {
    if (!this.connected) {
      this.setHint(NO_GAMEPAD_HINT);
      return;
    }
    this.acceptanceRecords.delete(key);
    this.acceptancePending.delete(key);
    this.acceptanceArmed.set(key, { startedAt: this.now(), releasedAt: null });
    this.renderAcceptance();
    const item = ACCEPTANCE_LABELS.find((candidate) => candidate.key === key);
    this.setHint(`方向驗收開始（${item?.label ?? key}）：${item?.hint ?? ''}`);
  }

  /**
   * 每幀取樣判定。只讀取飛行狀態與歸一化指令，不改任何東西；
   * pass / fail 一出現就定案，逾時則記為失敗並提示。
   */
  private acceptanceTick(): void {
    if (this.acceptanceArmed.size === 0) return;
    const sample = this.options.onFlightSample?.() ?? null;
    const nowMs = this.now();
    for (const [key, armed] of [...this.acceptanceArmed.entries()]) {
      if (!sample) {
        this.finishAcceptance(key, 'fail', '無法取得飛行狀態樣本（應用層未提供）。', {});
        continue;
      }
      // 放開項：先等所有搖桿回中，再等 RELEASE_SETTLE_S 讓機體停下。
      let settled = false;
      if (key === 'release') {
        if (armed.releasedAt === null) {
          const released =
            Math.abs(sample.command.pitch) <= RELEASE_NEUTRAL &&
            Math.abs(sample.command.roll) <= RELEASE_NEUTRAL &&
            Math.abs(sample.command.yaw) <= RELEASE_NEUTRAL &&
            Math.abs(sample.command.throttle) <= RELEASE_NEUTRAL;
          if (released) armed.releasedAt = nowMs;
        }
        settled = armed.releasedAt !== null && nowMs - armed.releasedAt >= RELEASE_SETTLE_S * 1000;
      }
      const judgement = judgeAcceptance(key, sample, settled);
      this.acceptancePending.set(key, judgement.detail);
      this.renderAcceptance();
      if (judgement.verdict !== 'pending') {
        this.finishAcceptance(key, judgement.verdict, judgement.detail, judgement.numbers);
        continue;
      }
      if (nowMs - armed.startedAt > ACCEPTANCE_TIMEOUT_MS) {
        this.finishAcceptance(
          key,
          'fail',
          `逾時未完成（${(ACCEPTANCE_TIMEOUT_MS / 1000).toFixed(0)} 秒）。若是機體不動，請先解鎖並起飛。`,
          judgement.numbers,
        );
      }
    }
  }

  private finishAcceptance(key: AcceptanceKey, verdict: 'pass' | 'fail', detail: string, numbers: Record<string, number>): void {
    this.acceptanceArmed.delete(key);
    this.acceptancePending.delete(key);
    this.acceptanceRecords.set(key, {
      key,
      verdict,
      detail,
      numbers,
      at: new Date().toISOString(),
    });
    this.renderAcceptance();
    const item = ACCEPTANCE_LABELS.find((candidate) => candidate.key === key);
    this.setHint(`${item?.label ?? key}：${verdict === 'pass' ? '通過' : '失敗'} — ${detail}`);
  }

  private renderAcceptance(): void {
    for (const { key } of ACCEPTANCE_LABELS) {
      const resultEl = this.acceptanceResultEls.get(key);
      if (!resultEl) continue;
      const armed = this.acceptanceArmed.has(key);
      const record = this.acceptanceRecords.get(key);
      if (armed) {
        resultEl.textContent = this.acceptancePending.get(key) ?? '測試中…';
        resultEl.dataset.verdict = 'pending';
        continue;
      }
      resultEl.textContent = record ? `${record.verdict === 'pass' ? '✓ 通過' : '✗ 失敗'}：${record.detail}` : '—';
      resultEl.dataset.verdict = record ? record.verdict : 'idle';
    }
  }

  private exportAcceptance(): void {
    if (this.acceptanceRecords.size === 0) {
      this.setHint('尚無驗收結果可匯出，請先按各項「開始測試」。');
      return;
    }
    const info = this.getActiveProfileInfo();
    const report = buildAcceptanceReport({
      capturedAt: new Date().toISOString(),
      deviceId: this.deviceId,
      mapping: info ? describeAxisMapping(info.profile) : null,
      records: [...this.acceptanceRecords.values()],
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = this.doc.createElement('a');
    anchor.href = url;
    anchor.download = `fde-direction-acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setHint('已匯出方向驗收結果 JSON。');
  }

  private toggleCapture(button: HTMLButtonElement): void {
    const value = button.dataset.capture ?? '';
    const [fn, field] = value.split(':') as [keyof AxisBindings, AxisCaptureField];
    const next = this.capturing && this.capturing.fn === fn && this.capturing.field === field ? null : { fn, field };
    this.capturing = next;
    this.options.root.querySelectorAll('[data-capture]').forEach((candidate) => {
      candidate.classList.toggle('capturing', candidate === button && next !== null);
    });
  }

  private async tick(): Promise<void> {
    const nowMs = this.now();
    let raw: RawPilotInput;
    try {
      raw = this.options.adapter.poll(nowMs);
    } catch {
      raw = { timestampMs: nowMs, channels: [], buttons: [], connected: false };
    }

    this.connected = raw.connected;
    this.lastRaw = raw;
    this.trackAxes(raw);
    this.updateStatus(raw);
    this.updateChannelMonitor(raw);
    this.updateActiveProfileDisplay();

    if (raw.connected) {
      if (!this.draft) this.ensureDraft();
      if (this.draft) this.feedCaptures(raw);
      this.guidedTick(raw);
      this.probeTick(raw);
      this.recordSample(raw);
      this.updateDrift(raw);
      this.acceptanceTick();
    } else {
      this.clearDraft();
      this.renderStickProbe();
      this.centerOffsets = null;
      this.acceptanceArmed.clear();
      this.acceptancePending.clear();
      this.renderAcceptance();
    }
  }

  private ensureDraft(): void {
    const profile = createMode2Profile(this.options.adapter.id);
    this.setOrigin({ kind: 'draft', file: '', savedAtMs: 0 });
    this.loadProfile(profile);
    void this.tryUpgradeFromStore(profile.id);
  }

  private async tryUpgradeFromStore(id: string): Promise<void> {
    if (this.upgrading) return;
    this.upgrading = true;
    try {
      const stored = await this.options.store.read(id);
      if (stored && this.deviceId === id) {
        await this.upgradeIfNewerOnline(stored, id);
        return;
      }
      await this.tryAutoImport(id);
    } catch {
      // A failed read should not break the live wizard; keep the default draft.
    } finally {
      this.upgrading = false;
    }
  }

  /**
   * The store already holds a profile for this controller. A manual save is
   * normally final, but a NEWER ground-truth capture on the server (the teacher
   * re-ran the guided calibration with the physics of the remote in hand) must
   * win: its `savedAtMs` is older than any local manual save yet, which keeps
   * the "manual always wins" promise while healing stale/incorrect captures
   * that were auto-imported before the mapping was verified.
   */
  private async upgradeIfNewerOnline(stored: StoredProfileResult, id: string): Promise<void> {
    let payload: LatestProfilePayload | null = null;
    if (this.options.autoProfileSource) {
      try {
        payload = parseLatestProfileResponse(await this.options.autoProfileSource(id));
      } catch {
        payload = null; // 網路失敗不得影響飛行：沿用本機檔。
      }
    }

    if (
      payload &&
      this.deviceId === id &&
      shouldAutoApply(null, payload.profile, id) &&
      shouldUpgradeStoredProfile(stored.savedAtMs, payload.source.savedAtMs)
    ) {
      // 以擷取檔自身的 savedAtMs 落庫：保留來源時間，
      // 之後更新的擷取檔才能繼續覆蓋這份舊的自動匯入。
      await this.options.store.write(payload.profile, payload.source.savedAtMs, {
        kind: payload.origin === 'bundled' ? 'bundled' : 'live',
        ...(payload.source.file ? { file: payload.source.file } : {}),
      });
      this.setOrigin({
        kind: payload.origin ?? 'live',
        file: payload.source.file,
        savedAtMs: payload.source.savedAtMs,
      });
      this.loadProfile(payload.profile);
      this.options.onProfileApplied?.(payload.profile, this.origin);
      const origin = payload.source.file ? `（文件：${payload.source.file}）` : '';
      this.setHint(`已更新為最新標定${origin}，可直接飛行；如需重新標定可覆蓋後儲存。`);
      return;
    }

    // 本機檔以時間戳勝出。若伺服器上的最新擷取檔綁定了不同的軸，必須明說：
    // 「本機檔贏了」與「本機檔是對的」是兩件事。
    const conflict = payload !== null && !sameAxisMapping(payload.profile, stored.profile);
    this.setOrigin({
      ...this.originFromStored(stored),
      ...(conflict
        ? { conflict: true, conflictMapping: describeAxisMapping(payload!.profile) }
        : {}),
    });
    this.loadProfile(stored.profile);
    if (conflict) {
      this.setHint(
        `注意：本機標定與伺服器最新擷取檔的軸映射不同（擷取檔為 ${describeAxisMapping(payload!.profile)}）。` +
          `目前仍使用本機檔；若要用擷取檔，請按「清除本機標定並重新載入」。`,
      );
    }
  }

  /**
   * 本機檔勝出時，用落庫時記下的來源回答「這是哪來的一份」。
   * 舊文件沒有 origin 欄位時退回 `stored`（IndexedDB 本機）。
   */
  private originFromStored(stored: StoredProfileResult): ProfileOriginInfo {
    const origin = stored.origin;
    if (!origin) return { kind: 'stored', file: '', savedAtMs: stored.savedAtMs };
    return {
      kind: origin.kind,
      file: origin.file ?? '',
      savedAtMs: stored.savedAtMs,
    };
  }

  /**
   * Second chance: import the newest online capture for this exact controller.
   * Only runs when the local store had nothing, so a manual calibration always
   * wins. The import is persisted so a later reload keeps flying with it.
   */
  private async tryAutoImport(id: string): Promise<void> {
    if (!this.options.autoProfileSource) return;
    try {
      const payload = parseLatestProfileResponse(await this.options.autoProfileSource(id));
      if (!payload) return;
      if (this.deviceId !== id || !shouldAutoApply(null, payload.profile, id)) return;
      await this.options.store.write(payload.profile, payload.source.savedAtMs, {
        kind: payload.origin === 'bundled' ? 'bundled' : 'live',
        ...(payload.source.file ? { file: payload.source.file } : {}),
      });
      this.setOrigin({
        kind: payload.origin ?? 'live',
        file: payload.source.file,
        savedAtMs: payload.source.savedAtMs,
      });
      this.loadProfile(payload.profile);
      this.options.onProfileApplied?.(payload.profile, this.origin);
      const origin = payload.source.file ? `（文件：${payload.source.file}）` : '';
      this.setHint(`已自動匯入最新標定${origin}，可直接飛行；如需重新標定可覆蓋後儲存。`);
    } catch {
      // A failed auto import must never break the live wizard.
    }
  }

  private loadProfile(profile: DeviceProfile): void {
    // 映射一變，先前的軸向判定就不再代表目前綁定，直接清掉避免誤導。
    this.probeResults.clear();
    this.probeArmed = null;
    this.recordingSuggestion = null;
    this.recordingReport = null;
    this.recordingSamples = [];
    this.acceptanceRecords.clear();
    this.acceptanceArmed.clear();
    this.acceptancePending.clear();
    this.centerWatch.clear();
    this.centerOffsets = null;
    this.deviceId = profile.id;
    this.gimbal = profile.gimbal ?? null;
    this.armButton = profile.armButton ?? null;

    const draft = new Map<keyof AxisBindings, FunctionState>();
    for (const { key } of FUNCTION_META) {
      const binding = profile.axes[key];
      draft.set(key, { binding, capture: createAxisCapture(binding.calibration) });
    }
    this.draft = draft;
    this.syncControlsFromDraft();
    this.updateActiveProfileDisplay();
    this.updateGuidedDisplay();
    this.renderStickProbe();
    this.renderRecordingReset();
    this.renderAcceptance();
  }

  /** 換綁定後把錄製/建議區與驗收區清回初始狀態（舊結論不得留在畫面上）。 */
  private renderRecordingReset(): void {
    if (this.recordSuggestionEl) {
      this.recordSuggestionEl.textContent = '—';
      this.recordSuggestionEl.dataset.verdict = 'idle';
    }
    if (this.recordResultsEl) this.recordResultsEl.textContent = '—';
    if (this.recordApplyEl) this.recordApplyEl.hidden = true;
    if (this.recordExportEl) this.recordExportEl.hidden = true;
    if (this.driftCenterEl) {
      this.driftCenterEl.hidden = true;
      this.driftCenterEl.textContent = '';
    }
  }

  private clearDraft(): void {
    this.draft = null;
    this.deviceId = null;
    this.capturing = null;
    this.resetAxisTracking();
    this.options.root.querySelectorAll('[data-capture]').forEach((candidate) => candidate.classList.remove('capturing'));
    for (const calEl of this.calEls.values()) calEl.textContent = '-1.00 / 0.00 / 1.00';
  }

  private syncControlsFromDraft(): void {
    if (!this.draft) return;
    for (const { key } of FUNCTION_META) {
      const state = this.draft.get(key);
      if (!state) continue;
      const source = this.options.root.querySelector<HTMLSelectElement>(`[data-source="${key}"]`);
      if (source) source.value = String(state.binding.source);
      const kind = this.options.root.querySelector<HTMLSelectElement>(`[data-kind="${key}"]`);
      if (kind) kind.value = state.binding.kind;
      const reverse = this.options.root.querySelector<HTMLInputElement>(`[data-reverse="${key}"]`);
      if (reverse) reverse.checked = state.binding.calibration.reverse;
      const deadzone = this.options.root.querySelector<HTMLInputElement>(`[data-deadzone="${key}"]`);
      if (deadzone) deadzone.value = String(state.binding.calibration.deadzone);
      const expo = this.options.root.querySelector<HTMLInputElement>(`[data-expo="${key}"]`);
      if (expo) expo.value = String(state.binding.calibration.expo);
      this.updateCalReadout(key);
    }
  }

  private updateCalReadout(key: keyof AxisBindings): void {
    const state = this.draft?.get(key);
    const calEl = this.calEls.get(key);
    if (!state || !calEl) return;
    const fmt = (value: number): string => value.toFixed(2);
    calEl.textContent = `${fmt(state.capture.min)} / ${fmt(state.capture.center)} / ${fmt(state.capture.max)}`;
  }

  private feedCaptures(raw: RawPilotInput): void {
    if (!this.capturing || !this.draft) return;
    const { fn, field } = this.capturing;
    const state = this.draft.get(fn);
    if (!state) return;
    const value = raw.channels[state.binding.source] ?? 0;
    state.capture = feedAxisCapture(state.capture, field, value);
    state.binding = { ...state.binding, calibration: captureToCalibration(state.capture, state.binding.calibration) };
    this.updateCalReadout(fn);
  }

  private updateStatus(raw: RawPilotInput): void {
    if (!this.statusEl) return;
    if (raw.connected) {
      const mapping = this.options.adapter.isConnected ? this.mappingNote() : '';
      this.statusEl.textContent = `已連線：${this.options.adapter.id}${mapping}`;
      this.statusEl.dataset.state = 'connected';
    } else {
      this.statusEl.textContent = '未檢測到外部遙控器，當前使用鍵盤教學。';
      this.statusEl.dataset.state = 'disconnected';
    }
  }

  // --- 目前生效標定 ---------------------------------------------------------

  private setOrigin(origin: ProfileOriginInfo): void {
    this.origin = origin;
  }

  /**
   * Renders which capture is actually in effect (file / savedAtMs / origin /
   * device id / compact mapping). Called every tick so the answer is always
   * live - after an auto-import, a manual save, a guided calibration or the
   * clear-and-reload button.
   */
  private updateActiveProfileDisplay(): void {
    if (this.activeFileEl) {
      const file = this.origin.file?.trim();
      this.activeFileEl.textContent = file && file.length > 0 ? file : '—（本機，無擷取檔）';
    }
    if (this.activeSavedEl) {
      const savedAtMs = this.origin.savedAtMs ?? 0;
      this.activeSavedEl.textContent =
        savedAtMs > 0 ? `${new Date(savedAtMs).toLocaleString('zh-Hant')}（${savedAtMs}）` : '—';
    }
    if (this.activeOriginEl) {
      const conflict = this.origin.conflict ? '　⚠ 與伺服器擷取檔映射不同' : '';
      this.activeOriginEl.textContent = ORIGIN_LABEL[this.origin.kind] + conflict;
      this.activeOriginEl.dataset.conflict = this.origin.conflict ? 'true' : 'false';
    }
    if (this.activeDeviceEl) {
      this.activeDeviceEl.textContent = this.deviceId ?? '（未連接）';
    }
    if (this.activeMappingEl) {
      if (!this.draft) {
        this.activeMappingEl.textContent = '—（未連接）';
      } else {
        const parts: string[] = [];
        for (const { key, short } of FUNCTION_META) {
          const state = this.draft.get(key);
          if (!state) continue;
          const reverse = state.binding.calibration.reverse ? '（反）' : '';
          parts.push(`${short}←axis${state.binding.source}${reverse}`);
        }
        this.activeMappingEl.textContent = `對應：${parts.join(' · ')}`;
      }
    }
    this.emitActiveProfile();
  }

  /**
   * 生效標定一變就通知外部（飛行畫面 HUD）。用簽名去重，避免每 60ms 觸發。
   */
  private emitActiveProfile(): void {
    const callback = this.options.onActiveProfileChange;
    if (!callback) return;
    const info = this.getActiveProfileInfo();
    const signature = info
      ? [
          info.deviceId ?? '',
          info.origin.kind,
          info.origin.file ?? '',
          info.origin.savedAtMs ?? 0,
          info.origin.conflict ? 1 : 0,
          info.profile.axes.roll.source,
          info.profile.axes.pitch.source,
          info.profile.axes.yaw.source,
          info.profile.axes.throttle.source,
          info.profile.axes.roll.calibration.reverse ? 1 : 0,
          info.profile.axes.pitch.calibration.reverse ? 1 : 0,
          info.profile.axes.yaw.calibration.reverse ? 1 : 0,
          info.profile.axes.throttle.calibration.reverse ? 1 : 0,
        ].join('|')
      : 'none';
    if (signature === this.lastActiveSignature) return;
    this.lastActiveSignature = signature;
    callback(info);
  }

  /**
   * 清除本機標定並重新載入：刪掉 IndexedDB 裡這個裝置的 profile，
   * 重新跑完整導入鏈（在线 API → 靜態回退 → 預設草稿）。
   * 公開給飛行畫面的 HUD 按鈕呼叫。
   */
  async clearLocalProfile(): Promise<void> {
    const id = this.deviceId ?? this.options.adapter.id;
    if (!id) {
      this.setHint('尚未連接遙控器，無本機標定可清除。');
      return;
    }
    try {
      await this.options.store.remove(id);
      this.setOrigin({ kind: 'draft', file: '', savedAtMs: 0 });
      this.clearDraft();
      // draft=null 後下一個 tick 會重新 ensureDraft → 重跑導入鏈。
      this.updateActiveProfileDisplay();
      this.updateGuidedDisplay();
      this.setHint(`已清除本機標定（${id}），正在重新載入最新標定檔…`);
    } catch (error) {
      this.setHint(`清除失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private mappingNote(): string {
    const adapter = this.options.adapter as unknown as { isStandardMapped?: boolean };
    if (typeof adapter.isStandardMapped === 'boolean') {
      return adapter.isStandardMapped ? '（標準對應）' : '（非標準對應，請使用標定）';
    }
    return '';
  }

  /**
   * 即時通道：每個原始軸的原始值、被分配到哪個功能、是否反向、歸一化值。
   * 動一根桿就能直接看出映射與方向是否正確。
   */
  private updateChannelMonitor(raw: RawPilotInput): void {
    // axis -> [function labels using it]
    const mapping = new Map<number, string[]>();
    const normalizedByAxis = new Map<number, number>();
    if (this.draft) {
      for (const { key, short } of FUNCTION_META) {
        const state = this.draft.get(key);
        if (!state) continue;
        const source = state.binding.source;
        const reverse = state.binding.calibration.reverse ? '（反）' : '';
        const labels = mapping.get(source) ?? [];
        labels.push(`${short}${reverse}`);
        mapping.set(source, labels);
        if (source < raw.channels.length) {
          const value = this.normalizer.normalizeAxis(
            raw.channels[source],
            state.binding.calibration,
            state.binding.kind,
          );
          // 同一軸被多功能共享時顯示第一個的歸一化值（引導標定會阻止這種情況）。
          if (!normalizedByAxis.has(source)) normalizedByAxis.set(source, value);
        }
      }
    }

    for (let index = 0; index < MAX_MONITOR_CHANNELS; index += 1) {
      const value = raw.channels[index];
      const available = typeof value === 'number' && Number.isFinite(value);
      const rawEl = this.channelRawEls[index];
      const barEl = this.channelBarEls[index];
      const mapEl = this.channelMapEls[index];
      const normEl = this.channelNormEls[index];
      if (rawEl) rawEl.textContent = available ? (value as number).toFixed(3) : '—';
      if (barEl) {
        const percent = available ? Math.min(Math.max(((value as number) + 1) / 2, 0), 1) * 100 : 50;
        barEl.style.width = `${percent}%`;
      }
      if (mapEl) {
        const labels = mapping.get(index);
        mapEl.textContent = labels && labels.length > 0 ? labels.join(' / ') : '未使用';
        mapEl.dataset.mapped = labels && labels.length > 0 ? 'true' : 'false';
      }
      if (normEl) {
        const normalized = normalizedByAxis.get(index);
        normEl.textContent = normalized === undefined ? '—' : (normalized >= 0 ? '+' : '') + normalized.toFixed(2);
      }
    }
  }

  /**
   * 記錄真機自連接以來每個原始軸的休止值與極值。
   * 純觀測：不做任何映射推論，供「下載測量記錄」把實測數字帶出畫面。
   */
  private trackAxes(raw: RawPilotInput): void {
    if (!raw.connected || raw.channels.length === 0) return;
    if (!this.restAxes || this.restAxes.length !== raw.channels.length) {
      this.restAxes = raw.channels.slice();
      this.axisMin = raw.channels.slice();
      this.axisMax = raw.channels.slice();
      return;
    }
    for (let index = 0; index < raw.channels.length; index += 1) {
      const value = raw.channels[index];
      if (!Number.isFinite(value)) continue;
      this.axisMin[index] = Math.min(this.axisMin[index] ?? value, value);
      this.axisMax[index] = Math.max(this.axisMax[index] ?? value, value);
    }
  }

  /** 清空軸極值統計（重新開始一次測量時呼叫）。 */
  resetAxisTracking(): void {
    this.restAxes = null;
    this.axisMin = [];
    this.axisMax = [];
  }

  /** 目前這台裝置的實測快照：休止值 + 各軸極值 + 生效中的映射。 */
  getMeasurementSnapshot(): {
    deviceId: string | null;
    origin: ProfileOriginInfo;
    rest: number[] | null;
    axes: Array<{ axis: number; rest: number | null; min: number | null; max: number | null; span: number | null }>;
    mapping: Array<{ fn: string; source: number; kind: string; reverse: boolean }>;
  } {
    const count = this.restAxes?.length ?? 0;
    const axes = [];
    for (let index = 0; index < count; index += 1) {
      const rest = this.restAxes?.[index] ?? null;
      const min = this.axisMin[index] ?? null;
      const max = this.axisMax[index] ?? null;
      axes.push({
        axis: index,
        rest,
        min,
        max,
        span: min !== null && max !== null ? Number((max - min).toFixed(4)) : null,
      });
    }
    const mapping: Array<{ fn: string; source: number; kind: string; reverse: boolean }> = [];
    if (this.draft) {
      for (const { key } of FUNCTION_META) {
        const state = this.draft.get(key);
        if (!state) continue;
        mapping.push({
          fn: key,
          source: state.binding.source,
          kind: state.binding.kind,
          reverse: state.binding.calibration.reverse,
        });
      }
    }
    return { deviceId: this.deviceId, origin: this.origin, rest: this.restAxes, axes, mapping };
  }

  private async save(): Promise<void> {
    const profile = this.getProfile();
    if (!profile) {
      this.setHint('未連接遙控器，無法儲存標定。');
      return;
    }
    try {
      const savedAtMs = Date.now();
      await this.options.store.write(profile, savedAtMs, { kind: 'manual' });
      // 手動儲存永遠帶當前時間：任何擷取檔都蓋不掉它。
      this.setOrigin({ kind: 'manual', file: '', savedAtMs });
      this.options.onProfileApplied?.(profile, this.origin);
      this.updateActiveProfileDisplay();
      this.setHint(`已儲存標定：${profile.label}`);
    } catch (error) {
      this.setHint(`儲存失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private exportProfile(): void {
    const profile = this.getProfile();
    if (!profile) {
      this.setHint('未連接遙控器，無法匯出。');
      return;
    }
    const text = serializeStoredProfile(profile, Date.now());
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = this.doc.createElement('a');
    anchor.href = url;
    anchor.download = `${profile.id}.fde-device-profile.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setHint('已匯出標定檔案。');
  }

  /**
   * 匯出「真機測量記錄」：裝置 ID、生效檔、各軸休止值與極值、目前映射。
   * 用途：把實測數字原樣帶出畫面，不必靠轉述。
   */
  exportMeasurement(): void {
    const snapshot = this.getMeasurementSnapshot();
    const text = JSON.stringify(
      {
        schema: 'fde.rc-measurement/1',
        capturedAt: new Date().toISOString(),
        ...snapshot,
      },
      null,
      2,
    );
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = this.doc.createElement('a');
    anchor.href = url;
    anchor.download = `fde-rc-measurement-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setHint('已匯出真機測量記錄（各軸休止值與極值）。');
  }

  private async importProfile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const profile = parseStoredProfile(text);
      if (!profile) {
        this.setHint('匯入失敗：檔案格式無效或不是有效的設備標定檔案。');
        return;
      }
      this.setOrigin({ kind: 'imported', file: input.files?.[0]?.name ?? '', savedAtMs: Date.now() });
      this.loadProfile(profile);
      this.setHint(`已載入匯入的標定：${profile.label}（點擊「儲存標定」以套用）`);
    } catch (error) {
      this.setHint(`匯入失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.value = '';
    }
  }

  private setHint(message: string): void {
    if (this.hintEl) this.hintEl.textContent = message;
  }
}
