import { VirtualStickAdapter } from './VirtualStickAdapter';
import { blobToSticks, findBlob, sampleTarget, smooth, type Blob, type ColorTarget, type StickSample } from '../pen/pen-tracker';

/**
 * 原子筆搖桿（筆電鏡頭偵測）2026-11-07
 *
 * 操作方式：
 *   1. 開啟鏡頭 → 在預覽畫面上點一下「有顏色的筆蓋／筆尖」→ 記住這個顏色
 *   2. 把筆放在舒服的位置按「設為中心」（第一次選色時會自動以當下位置為中心）
 *   3. 筆往上／下／左／右移＝右搖桿（前進、後退、左移、右移）
 *   4. 油門與轉向沿用鍵盤：R 上升、F 下降、Q 左轉、E 右轉
 *      （也可開啟「遠近控油門」：筆靠近鏡頭上升、遠離下降）
 * 筆離開畫面超過 0.25 秒 → 自動懸停（沿用既有斷訊保護）。
 * 影像只在本機瀏覽器計算，不錄影、不上傳。
 */
export type PenStatus = 'off' | 'starting' | 'need-color' | 'tracking' | 'lost' | 'error';

export interface PenState {
  status: PenStatus;
  blob: Blob | null;
  center: { x: number; y: number } | null;
  sticks: StickSample;
  message: string;
}

const W = 160;
const H = 120;

export class PenCameraInputAdapter extends VirtualStickAdapter {
  readonly id = 'camera-pen';
  readonly type = 'camera-pen' as const;
  readonly label = '原子筆（鏡頭）';

  readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private target: ColorTarget | null = null;
  private center: { x: number; y: number } | null = null;
  private centerArea = 0;
  private blob: Blob | null = null;
  private smoothed: StickSample | null = null;
  private status: PenStatus = 'off';
  private readonly keys = new Set<string>();
  /** 遠近控油門（預設關閉；開啟後筆靠近鏡頭＝上升） */
  depthThrottle = false;
  /** 筆移動多遠算「推到底」（畫面比例） */
  range = 0.22;

  constructor(private readonly onState?: (state: PenState) => void) {
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
    this.setStatus(this.target ? 'tracking' : 'need-color');
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

  /** 使用者在預覽畫面點選筆尖（nx, ny 為「原始影像」的 0..1 座標，鏡像已由畫面層換算） */
  pickColorAt(nx: number, ny: number): boolean {
    const frame = this.grab();
    if (!frame) return false;
    const t = sampleTarget(frame, W, H, Math.round(nx * (W - 1)), Math.round(ny * (H - 1)));
    if (!t) {
      this.emit('這裡顏色太淡（灰白黑無法追蹤），請點有顏色的筆蓋或筆尖');
      return false;
    }
    this.target = t;
    this.center = null; // 下一格看到筆時自動設為中心
    this.smoothed = null;
    this.setStatus('tracking');
    return true;
  }

  /** 以筆目前的位置為中心（搖桿回正位置） */
  recenter(): void {
    if (this.blob) {
      this.center = { x: this.blob.x, y: this.blob.y };
      this.centerArea = this.blob.area;
      this.smoothed = null;
    }
  }

  resetColor(): void {
    this.target = null;
    this.center = null;
    this.active = false;
    this.setStatus(this.stream ? 'need-color' : 'off');
  }

  state(): PenState {
    return { status: this.status, blob: this.blob, center: this.center, sticks: this.smoothed ?? { roll: 0, pitch: 0 }, message: this.error ?? '' };
  }

  private grab(): Uint8ClampedArray | null {
    if (!this.ctx || this.video.readyState < 2) return null;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    return this.ctx.getImageData(0, 0, W, H).data;
  }

  private readonly loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.target) return;
    const frame = this.grab();
    if (!frame) return;
    const now = performance.now();
    this.blob = findBlob(frame, W, H, this.target);
    if (!this.blob) {
      // 看不到筆：不更新時間戳 → 0.25 秒後管線自動判定斷訊並懸停
      if (this.status !== 'lost') this.setStatus('lost');
      return;
    }
    if (!this.center) this.recenter();
    const raw = blobToSticks(this.blob, this.center!, this.range, true);
    this.smoothed = smooth(this.smoothed, raw);
    const k = (key: string): number => Number(this.keys.has(key));
    let throttle = 0.5 + 0.25 * (k('r') - k('f'));
    if (this.depthThrottle && this.centerArea > 0) {
      // 色塊面積比中心時大 → 筆靠近 → 上升（變化 ±50% 對應油門 0.25..0.75）
      const ratio = this.blob.area / this.centerArea - 1;
      throttle = 0.5 + Math.max(-0.25, Math.min(0.25, ratio * 0.5));
    }
    this.active = true;
    this.push({ roll: this.smoothed.roll, pitch: this.smoothed.pitch, yaw: k('e') - k('q'), throttle }, now);
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
    if (message !== undefined) this.error = message;
    this.onState?.(this.state());
  }

  private fail(message: string): void {
    this.error = message;
    this.active = false;
    this.setStatus('error');
  }
}
