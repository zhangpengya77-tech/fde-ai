/**
 * Brand-neutral pilot input contract.
 *
 * Every supported controller - keyboard/touch, generic USB joystick, RadioMaster
 * EdgeTX USB joystick, RadioLink AT9S simulator dongle, a future DJI FPV Remote
 * Controller 3 and a future CRSF/ELRS receiver bridge - is adapted into the same
 * `RawPilotInput` shape. Nothing downstream of this boundary may branch on a
 * controller brand.
 */

// 2026-11-07：新增 camera-pen（筆電鏡頭＋原子筆當搖桿）與 phone-link（手機當遙控器）
export type PilotInputType = 'keyboard-touch' | 'gamepad' | 'receiver-bridge' | 'camera-pen' | 'phone-link';

/** One unfiltered sample exactly as a physical device reported it. */
export interface RawPilotInput {
  /** When this sample was actually obtained, in milliseconds. */
  readonly timestampMs: number;
  /** Raw analog channel values in device order. */
  readonly channels: readonly number[];
  /** Raw button values; 0..1 for analog, 0/1 for digital. */
  readonly buttons: readonly number[];
  /** False once the device is known to be gone or unusable. */
  readonly connected: boolean;
}

/**
 * The single contract every pilot input source implements.
 *
 * `poll()` must never invent motion: when no fresh data exists it returns the
 * last known snapshot with `connected: false` and the current timestamp.
 */
export interface PilotInputAdapter {
  /** Stable device identity, normally `Gamepad.id`, used to key device profiles. */
  readonly id: string;
  readonly type: PilotInputType;
  connect(): Promise<void>;
  disconnect(): void;
  poll(timestampMs: number): RawPilotInput;
  /** Present when the last `connect()` failed; never thrown into the render loop. */
  readonly lastError?: string | null;
  /** True once a device is connected and providing samples. */
  readonly isConnected?: boolean;
}

/**
 * Input older than this is treated as lost control and the aircraft must fall
 * back to hover. This is a safety contract, not a tuning parameter.
 */
export const STALE_INPUT_MS = 250;

/**
 * CRSF / ELRS would arrive through this interface once a `ReceiverBridgeInputAdapter`
 * exists. V1 deliberately requests no WebSerial or WebHID permission, so only the
 * contract is declared here - there is intentionally no implementation yet.
 */
export interface ReceiverBridgeInputAdapter extends PilotInputAdapter {
  readonly type: 'receiver-bridge';
}
