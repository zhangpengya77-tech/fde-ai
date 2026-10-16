import type { PilotInputAdapter, PilotInputType, RawPilotInput } from '../PilotInputAdapter';

/** One physical controller as the browser Gamepad API reports it. */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { value: number; pressed: boolean }[];
}

/**
 * Injected Gamepad API surface. Tests and any future non-browser host supply
 * their own, so the adapter never depends on a browser global to be testable.
 */
export interface GamepadSource {
  getGamepads?: () => (GamepadLike | null)[];
  addEventListener?: (type: string, listener: (event: never) => void) => void;
  removeEventListener?: (type: string, listener: (event: never) => void) => void;
}

/** Length of the neutral snapshot returned while a controller is gone. */
const NEUTRAL_CHANNEL_COUNT = 6;

function neutralChannels(): number[] {
  return new Array(NEUTRAL_CHANNEL_COUNT).fill(0);
}

function neutralSnapshot(timestampMs: number): RawPilotInput {
  return { timestampMs, channels: neutralChannels(), buttons: [], connected: false };
}

function createBrowserGamepadSource(): GamepadSource {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & {
    getGamepads?: () => (GamepadLike | null)[];
  };
  const bound = typeof nav.getGamepads === 'function' ? nav.getGamepads.bind(nav) : undefined;
  return {
    getGamepads: bound as GamepadSource['getGamepads'],
    addEventListener: (type, listener) =>
      window.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) =>
      window.removeEventListener(type, listener as EventListener),
  };
}

/**
 * Adapts a generic USB joystick / gamepad to the brand-neutral pilot contract.
 *
 * RadioMaster EdgeTX USB joystick, the RadioLink AT9S simulator dongle and any
 * unknown teaching dongle all arrive through this class unchanged: it reports
 * raw channels and buttons only, and never teaches the flight core about a
 * brand.
 *
 * The browser only exposes a gamepad after a button press, so `poll()` re-scans
 * `getGamepads()` on every call exactly as the API intends.
 */
export class GamepadInputAdapter implements PilotInputAdapter {
  readonly type: PilotInputType = 'gamepad';

  private gamepad: GamepadLike | null = null;
  private connected = false;
  private detached = false;
  private error: string | null = null;

  private readonly handleConnected = (): void => {
    this.gamepad = this.locate();
    this.connected = this.gamepad !== null;
  };

  private readonly handleDisconnected = (): void => {
    this.gamepad = null;
    this.connected = false;
  };

  constructor(
    private readonly index: number,
    private readonly source: GamepadSource = createBrowserGamepadSource(),
  ) {}

  /** `Gamepad.id` when present; device profiles are keyed by this exact string. */
  get id(): string {
    return this.gamepad?.id ?? `gamepad-${this.index}`;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get lastError(): string | null {
    return this.error;
  }

  /** True when the browser reports a standard mapping for this controller. */
  get isStandardMapped(): boolean {
    return this.gamepad?.mapping === 'standard';
  }

  async connect(): Promise<void> {
    if (typeof this.source.getGamepads !== 'function') {
      this.error = '此浏览器不支持 Gamepad API，无法连接外部遥控器。';
      this.connected = false;
      throw new Error('此浏览器不支持 Gamepad API，无法连接外部遥控器。');
    }

    this.detached = false;
    this.source.addEventListener?.('gamepadconnected', this.handleConnected as (event: never) => void);
    this.source.addEventListener?.('gamepaddisconnected', this.handleDisconnected as (event: never) => void);

    this.gamepad = this.locate();
    this.connected = this.gamepad !== null;
    this.error = this.connected ? null : '未检测到外部遥控器，请确认设备已连接并按下任一按键唤醒。';
  }

  disconnect(): void {
    this.detached = true;
    this.connected = false;
    this.gamepad = null;
    this.source.removeEventListener?.('gamepadconnected', this.handleConnected as (event: never) => void);
    this.source.removeEventListener?.('gamepaddisconnected', this.handleDisconnected as (event: never) => void);
  }

  poll(timestampMs: number): RawPilotInput {
    if (this.detached || typeof this.source.getGamepads !== 'function') {
      return { ...neutralSnapshot(timestampMs), channels: neutralChannels() };
    }

    const pad = this.locate();
    if (!pad) {
      this.gamepad = null;
      this.connected = false;
      return { ...neutralSnapshot(timestampMs), channels: neutralChannels() };
    }

    this.gamepad = pad;
    this.connected = true;
    this.error = null;

    return {
      timestampMs,
      channels: Array.from(pad.axes, (value) => (Number.isFinite(value) ? value : 0)),
      buttons: pad.buttons.map((button) => (Number.isFinite(button.value) ? button.value : button.pressed ? 1 : 0)),
      connected: true,
    };
  }

  private locate(): GamepadLike | null {
    const pads = this.source.getGamepads?.() ?? [];
    const pad = pads[this.index];
    return pad && pad.connected ? pad : null;
  }
}
