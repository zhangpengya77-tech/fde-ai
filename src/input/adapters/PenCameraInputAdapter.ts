import { VirtualStickAdapter } from './VirtualStickAdapter';
import { blobToSticks, findBlob, hueDistance, sampleTarget, smooth, type Blob, type ColorTarget, type StickSample } from '../pen/pen-tracker';

/**
 * 原子筆搖桿（筆電鏡頭偵測）2026-11-07
 *
 * 單筆模式（右手一支筆）：
 *   筆往上／下／左／右移＝右搖桿（前進、後退、左移、右移）；升降轉向用鍵盤 R/F、Q/E，
 *   或開啟「遠近控油門」（筆靠近鏡頭＝上升）。
 * 雙筆四軸模式（再加左手一支「不同顏色」的筆）：
 *   左手筆上下＝升降、左右＝轉向，完全不用碰鍵盤（美國手 Mode 2）。
 * 任何一支正在使用的筆離開畫面超過 0.25 秒 → 自動懸停（沿用既有斷訊保護）。
 * 影像只在本機瀏覽器計算，不錄影、不上傳。
 */
export type PenStatus = 'off' | 'starting' | 'need-color' | 'tracking' | 'lost' | 'error';
export type PenSide = 'right' | 'left';

export interface PenSlotState {
  blob: Blob | null;
  center: { x: number; y: number } | null;
  sticks: StickSample;
  hasColor: boolean;
}

export interface PenState {
  status: PenStatus;
  /** 下一次點擊畫面要設定哪一支筆的顏色 */
  picking: PenSide | null;
  right: PenSlotState;
  left: PenSlotState | null;
  message: string;
  /** 相容舊介面：右手筆 */
  blob: Blob | null;
  center: { x: number; y: number } | null;
  sticks: StickSample;
}

interface Slot {
  target: ColorTarget | null;
  center: { x: number; y: number } | null;
  centerArea: number;
  blob: Blob | null;
  smoothed: StickSample | null;
}

const W = 160;
const H = 120;
const emptySlot = (): Slot => ({ target: null, center: null, centerArea: 0, blob: null, smoothed: null });

export class PenCameraInputAdapter extends VirtualStickAdapter {
  readonly id = 'camera-pen';
  readonly type = 'camera-pen' as const;
  readonly label = '原子筆（鏡頭）';

  readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private readonly slots: Record<PenSide, Slot> = { right: emptySlot(), left: emptySlot() };
  /** 是否啟用左手第二支筆 */
  private dual = false;
  private picking: PenSide | null = 'right';
  private status: PenStatus = 'off';
  private readonly keys = new Set<string>();
  /** 遠近控油門（單筆模式用；預設關閉，開啟後筆靠近鏡頭＝上升） */
  depthThrottle = false;
  /** 筆移動多遠算「推到底」（畫面比例） */
  range = 0.22;

  /** 狀態變化回呼（「連線方式」面板建立時會自動掛上） */
  constructor(public onState?: (state: PenState) => void) {
    super();
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async connect(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('這個瀏覽器不支援鏡頭（請用 Chrome／Edge，並透過 https 或 localhost 開啟）');
      return;
    }
    this.setStatus('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      this.fail(name === 'NotAllowedError' ? '鏡頭權限被拒絕：請在網址列左側允許使用相機' : '找不到可用的鏡頭');
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.error = null;
    this.setStatus(this.slots.right.target ? 'tracking' : 'need-color');
    this.loop();
  }

  disconnect(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
    this.active = false;
    this.setStatus('off');
  }

  /** 開啟／關閉左手第二支筆（四軸模式）；開啟後下一次點擊畫面＝選左手筆的顏色 */
  setDual(on: boolean): void {
    this.dual = on;
    this.slots.left = emptySlot();
    this.picking = on ? 'left' : this.slots.right.target ? null : 'right';
    this.emit(on ? '請在畫面上點一下「左手」那支筆的筆蓋（顏色要和右手筆不同）' : '');
  }

  get isDual(): boolean {
    return this.dual;
  }

  /** 使用者在預覽畫面點選筆尖（nx, ny 為「原始影像」的 0..1 座標，鏡像已由畫面層換算） */
  pickColorAt(nx: number, ny: number): boolean {
    const frame = this.grab();
    if (!frame) return false;
    const side: PenSide = this.picking ?? 'right';
    const t = sampleTarget(frame, W, H, Math.round(nx * (W - 1)), Math.round(ny * (H - 1)));
    if (!t) {
      this.emit('這裡顏色太淡（灰白黑無法追蹤），請點有顏色的筆蓋或筆尖');
      return false;
    }
    // 兩支筆顏色太接近會互相干擾，必須換一支
    const other = this.slots[side === 'right' ? 'left' : 'right'].target;
    if (other && hueDistance(other.h, t.h) < other.hueTolerance + t.hueTolerance) {
      this.emit('兩支筆的顏色太接近，請換一支不同顏色的筆（例如一紅一藍）');
      return false;
    }
    this.slots[side] = { ...emptySlot(), target: t };
    // 右手筆選好後，若開了雙筆模式但左手還沒選 → 接著選左手；否則結束選色
    this.picking = side === 'right' && this.dual && !this.slots.left.target ? 'left' : null;
    this.error = null;
    this.setStatus('tracking');
    return true;
  }

  /** 以筆目前的位置為中心（搖桿回正位置） */
  recenter(): void {
    for (const side of ['right', 'left'] as const) {
      const s = this.slots[side];
      if (s.blob) {
        s.center = { x: s.blob.x, y: s.blob.y };
        s.centerArea = s.blob.area;
        s.smoothed = null;
      }
    }
  }

  resetColor(): void {
    this.slots.right = emptySlot();
    this.slots.left = emptySlot();
    this.picking = 'right';
    this.active = false;
    this.setStatus(this.stream ? 'need-color' : 'off');
  }

  state(): PenState {
    const view = (s: Slot): PenSlotState => ({
      blob: s.blob,
      center: s.center,
      sticks: s.smoothed ?? { roll: 0, pitch: 0 },
      hasColor: !!s.target,
    });
    const right = view(this.slots.right);
    return {
      status: this.status,
      picking: this.picking,
      right,
      left: this.dual ? view(this.slots.left) : null,
      message: this.error ?? '',
      blob: right.blob,
      center: right.center,
      sticks: right.sticks,
    };
  }

  private grab(): Uint8ClampedArray | null {
    if (!this.ctx || this.video.readyState < 2) return null;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    return this.ctx.getImageData(0, 0, W, H).data;
  }

  /** 追蹤一支筆；回傳是否看得到 */
  private track(slot: Slot, frame: Uint8ClampedArray): boolean {
    if (!slot.target) return false;
    slot.blob = findBlob(frame, W, H, slot.target);
    if (!slot.blob) return false;
    if (!slot.center) {
      slot.center = { x: slot.blob.x, y: slot.blob.y };
      slot.centerArea = slot.blob.area;
    }
    slot.smoothed = smooth(slot.smoothed, blobToSticks(slot.blob, slot.center, this.range, true));
    return true;
  }

  private readonly loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const right = this.slots.right;
    if (!right.target) return;
    const frame = this.grab();
    if (!frame) return;
    const now = performance.now();
    const seeRight = this.track(right, frame);
    const useLeft = this.dual && !!this.slots.left.target;
    const seeLeft = useLeft ? this.track(this.slots.left, frame) : true;
    if (!seeRight || !seeLeft) {
      // 看不到正在使用的筆：不更新時間戳 → 0.25 秒後管線自動判定斷訊並懸停
      if (this.status !== 'lost') this.setStatus('lost');
      return;
    }
    const k = (key: string): number => Number(this.keys.has(key));
    let throttle = 0.5 + 0.25 * (k('r') - k('f'));
    let yaw = k('e') - k('q');
    if (useLeft) {
      // 左手筆：上下＝升降（中心＝保持高度）、左右＝轉向
      const l = this.slots.left.smoothed ?? { roll: 0, pitch: 0 };
      throttle = 0.5 + 0.5 * l.pitch;
      yaw = l.roll;
    } else if (this.depthThrottle && right.centerArea > 0 && right.blob) {
      // 色塊面積比中心時大 → 筆靠近 → 上升（變化 ±50% 對應油門 0.25..0.75）
      const ratio = right.blob.area / right.centerArea - 1;
      throttle = 0.5 + Math.max(-0.25, Math.min(0.25, ratio * 0.5));
    }
    const r = right.smoothed ?? { roll: 0, pitch: 0 };
    this.active = true;
    this.push({ roll: r.roll, pitch: r.pitch, yaw, throttle }, now);
    if (this.status !== 'tracking') this.setStatus('tracking');
    else this.onState?.(this.state());
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if ('rfqe'.includes(key) && key.length === 1) this.keys.add(key);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private setStatus(s: PenStatus): void {
    this.status = s;
    this.emit();
  }

  private emit(message?: string): void {
    if (message !== undefined) this.error = message || null;
    this.onState?.(this.state());
  }

  private fail(message: string): void {
    this.error = message;
    this.active = false;
    this.setStatus('error');
  }
}
