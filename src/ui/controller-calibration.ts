import type { PilotInputAdapter, PilotInputType, RawPilotInput } from '../input/PilotInputAdapter';
import type {
  AxisBinding,
  AxisBindings,
  AxisCalibration,
  AxisRangeKind,
} from '../input/InputNormalizer';
import { createMode2Profile, type DeviceProfile } from '../input/device-profile';
import { parseStoredProfile, serializeStoredProfile, type ProfileStore } from './profile-store';

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

const FUNCTION_META: ReadonlyArray<{ key: keyof AxisBindings; name: string }> = [
  { key: 'roll', name: '横滚 Roll' },
  { key: 'pitch', name: '俯仰 Pitch' },
  { key: 'yaw', name: '偏航 Yaw' },
  { key: 'throttle', name: '油门 Throttle' },
];

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
  onProfileApplied?: (profile: DeviceProfile) => void;
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

  private interval: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private deviceId: string | null = null;
  private draft: Map<keyof AxisBindings, FunctionState> | null = null;
  private gimbal: { yaw: AxisBinding; pitch: AxisBinding } | null = null;
  private armButton: number | null = null;
  private capturing: { fn: keyof AxisBindings; field: AxisCaptureField } | null = null;
  private upgrading = false;

  private channelRawEls: HTMLElement[] = [];
  private channelBarEls: HTMLElement[] = [];
  private calEls = new Map<keyof AxisBindings, HTMLElement>();
  private statusEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;

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
        el(doc, 'p', { class: 'eyebrow' }, ['遥控器']),
        el(doc, 'h2', {}, ['USB 控制器标定']),
      ]),
    ]);

    this.statusEl = el(doc, 'p', { class: 'calibration-status' }, ['未检测到外部遥控器']);
    const monitor = el(doc, 'div', { class: 'channel-monitor', 'data-channel-monitor': '' });
    for (let index = 0; index < MAX_MONITOR_CHANNELS; index += 1) {
      const rawEl = el(doc, 'span', { class: 'channel-value', 'data-channel-raw': String(index) }, ['0.000']);
      const bar = el(doc, 'i', { 'data-channel-bar': String(index) });
      this.channelRawEls.push(rawEl);
      this.channelBarEls.push(bar);
      monitor.append(
        el(doc, 'div', { class: 'channel-row' }, [
          el(doc, 'span', { class: 'channel-name' }, [`CH${index + 1}`]),
          rawEl,
          el(doc, 'span', { class: 'channel-bar' }, [bar]),
        ]),
      );
    }

    const bindings = el(doc, 'div', { class: 'calibration-bindings', 'data-calibration-bindings': '' });
    for (const { key, name } of FUNCTION_META) {
      bindings.append(this.buildBindingRow(key, name));
    }

    const actions = el(doc, 'div', { class: 'calibration-actions' }, [
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'save' }, ['保存标定']),
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'export' }, ['导出']),
      el(doc, 'button', { type: 'button', 'data-calibration-action': 'import' }, ['导入']),
      el(doc, 'input', { type: 'file', hidden: '', accept: 'application/json', 'data-calibration-import': '' }),
    ]);

    this.hintEl = el(doc, 'p', { class: 'calibration-hint' }, [
      '首次使用遥控器请先逐项捕获 最小 / 中位 / 最大，再保存。无遥控器时系统使用键盘教学。',
    ]);

    root.append(
      el(doc, 'section', { class: 'panel calibration-panel', 'data-calibration-panel': '' }, [
        heading,
        this.statusEl,
        el(doc, 'p', { class: 'calibration-subhead' }, ['实时通道（拨动摇杆观察对应 CH 变化）']),
        monitor,
        bindings,
        actions,
        this.hintEl,
      ]),
    );

    this.wireActions();
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
      el(doc, 'label', {}, ['通道', el(doc, 'select', { 'data-source': key }, sourceOptions)]),
      el(doc, 'label', {}, [
        '类型',
        el(doc, 'select', { 'data-kind': key }, [
          el(doc, 'option', { value: 'bipolar' }, ['双向']),
          el(doc, 'option', { value: 'unipolar' }, ['单向']),
        ]),
      ]),
      el(doc, 'label', {}, ['反向', el(doc, 'input', { type: 'checkbox', 'data-reverse': key })]),
      el(doc, 'label', {}, ['死区', el(doc, 'input', { type: 'range', min: '0', max: '0.9', step: '0.05', 'data-deadzone': key })]),
      el(doc, 'label', {}, ['指数', el(doc, 'input', { type: 'range', min: '0', max: '1', step: '0.05', 'data-expo': key })]),
      calEl,
      el(doc, 'div', { class: 'capture-buttons' }, [
        el(doc, 'button', { type: 'button', 'data-capture': `${key}:min` }, ['捕获最小']),
        el(doc, 'button', { type: 'button', 'data-capture': `${key}:center` }, ['捕获中位']),
        el(doc, 'button', { type: 'button', 'data-capture': `${key}:max` }, ['捕获最大']),
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
    this.updateStatus(raw);
    this.updateChannelMonitor(raw);

    if (raw.connected) {
      if (!this.draft) this.ensureDraft();
      if (this.draft) this.feedCaptures(raw);
    } else {
      this.clearDraft();
    }
  }

  private ensureDraft(): void {
    const profile = createMode2Profile(this.options.adapter.id);
    this.loadProfile(profile);
    void this.tryUpgradeFromStore(profile.id);
  }

  private async tryUpgradeFromStore(id: string): Promise<void> {
    if (this.upgrading) return;
    this.upgrading = true;
    try {
      const stored = await this.options.store.read(id);
      if (stored && this.deviceId === id) this.loadProfile(stored);
    } catch {
      // A failed read should not break the live wizard; keep the default draft.
    } finally {
      this.upgrading = false;
    }
  }

  private loadProfile(profile: DeviceProfile): void {
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
  }

  private clearDraft(): void {
    this.draft = null;
    this.deviceId = null;
    this.capturing = null;
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
      this.statusEl.textContent = `已连接：${this.options.adapter.id}${mapping}`;
      this.statusEl.dataset.state = 'connected';
    } else {
      this.statusEl.textContent = '未检测到外部遥控器，当前使用键盘教学。';
      this.statusEl.dataset.state = 'disconnected';
    }
  }

  private mappingNote(): string {
    const adapter = this.options.adapter as unknown as { isStandardMapped?: boolean };
    if (typeof adapter.isStandardMapped === 'boolean') {
      return adapter.isStandardMapped ? '（标准映射）' : '（非标准映射，请使用标定）';
    }
    return '';
  }

  private updateChannelMonitor(raw: RawPilotInput): void {
    for (let index = 0; index < MAX_MONITOR_CHANNELS; index += 1) {
      const value = raw.channels[index] ?? 0;
      const rawEl = this.channelRawEls[index];
      const barEl = this.channelBarEls[index];
      if (rawEl) rawEl.textContent = value.toFixed(3);
      if (barEl) {
        const percent = Math.min(Math.max((value + 1) / 2, 0), 1) * 100;
        barEl.style.width = `${percent}%`;
      }
    }
  }

  private async save(): Promise<void> {
    const profile = this.getProfile();
    if (!profile) {
      this.setHint('未连接遥控器，无法保存标定。');
      return;
    }
    try {
      await this.options.store.write(profile);
      this.options.onProfileApplied?.(profile);
      this.setHint(`已保存标定：${profile.label}`);
    } catch (error) {
      this.setHint(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private exportProfile(): void {
    const profile = this.getProfile();
    if (!profile) {
      this.setHint('未连接遥控器，无法导出。');
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
    this.setHint('已导出标定文件。');
  }

  private async importProfile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const profile = parseStoredProfile(text);
      if (!profile) {
        this.setHint('导入失败：文件格式无效或不是有效的设备标定文件。');
        return;
      }
      this.loadProfile(profile);
      this.setHint(`已载入导入的标定：${profile.label}（点击“保存标定”以应用）`);
    } catch (error) {
      this.setHint(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.value = '';
    }
  }

  private setHint(message: string): void {
    if (this.hintEl) this.hintEl.textContent = message;
  }
}
