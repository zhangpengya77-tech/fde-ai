import { VirtualStickAdapter } from './VirtualStickAdapter';
import { assignHands, handToStick, isFist, palmCenter, type Landmark, type Point } from '../gesture/hand-math';

/**
 * 手勢搖桿（筆電鏡頭＋手部辨識）2026-11-07
 *
 * 不用筆，直接對鏡頭伸手：
 *   - 一隻手：手掌位置＝右搖桿（上下＝前進後退、左右＝左右移）；升降轉向用鍵盤 R/F、Q/E
 *   - 兩隻手：右手＝前後左右；左手上下＝升降、左右＝轉向
 *   - 任一手握拳＝懸停（搖桿回中）
 *   - 看不到手超過 0.25 秒＝自動懸停
 * 手部辨識用 Google MediaPipe（Apache-2.0），模型與程式都放在本站、第一次開啟時才下載（約 17MB）；
 * 影像只在本機瀏覽器計算，不錄影、不上傳。
 */
export type GestureStatus = 'off' | 'loading' | 'no-hand' | 'tracking' | 'fist' | 'error';

export interface GestureState {
  status: GestureStatus;
  /** 目前看到的手（原始影像 0..1 座標），給畫面標示用 */
  hands: Landmark[][];
  rightNeutral: Point | null;
  leftNeutral: Point | null;
  twoHands: boolean;
  message: string;
}

interface HandLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks: Landmark[][] };
  close(): void;
}

/** MediaPipe 檔案位置：與模擬器同資料夾的 mediapipe/（建置時由 public/ 複製） */
function assetBase(): string {
  return new URL('./mediapipe/', document.baseURI).toString();
}

export class HandGestureInputAdapter extends VirtualStickAdapter {
  readonly id = 'hand-gesture';
  readonly type = 'camera-pen' as const;
  readonly label = '手勢（鏡頭）';

  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarkerLike | null = null;
  private raf = 0;
  private lastDetect = 0;
  private status: GestureStatus = 'off';
  private hands: Landmark[][] = [];
  private rightNeutral: Point | null = null;
  private leftNeutral: Point | null = null;
  private readonly keys = new Set<string>();
  range = 0.18;

  constructor(public onState?: (state: GestureState) => void) {
    super();
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  state(): GestureState {
    return {
      status: this.status,
      hands: this.hands,
      rightNeutral: this.rightNeutral,
      leftNeutral: this.leftNeutral,
      twoHands: this.hands.length >= 2,
      message: this.error ?? '',
    };
  }

  async connect(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) return this.fail('這個瀏覽器不支援鏡頭（請用 Chrome／Edge，並透過 https 開啟）');
    this.set('loading', '正在載入手部辨識模型（第一次約 17MB，請稍候）…');
    try {
      if (!this.landmarker) {
        // 只有開啟手勢時才載入（不影響模擬器平常的開啟速度）
        const { FilesetResolver, HandLandmarker } = await import('../../vendor/mediapipe/vision_bundle.mjs');
        const fileset = await FilesetResolver.forVisionTasks(assetBase());
        const make = (delegate: 'GPU' | 'CPU') =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${assetBase()}hand_landmarker.task`, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
          });
        // 先試顯示卡加速，不支援時改用處理器
        this.landmarker = (await make('GPU').catch(() => make('CPU'))) as unknown as HandLandmarkerLike;
      }
    } catch {
      return this.fail('手部辨識模型載入失敗，請重新整理後再試。');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      return this.fail(name === 'NotAllowedError' ? '鏡頭權限被拒絕：請在網址列左側允許使用相機' : '找不到可用的鏡頭（或正被原子筆搖桿使用中）');
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.set('no-hand', '');
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
    this.hands = [];
    this.rightNeutral = null;
    this.leftNeutral = null;
    if (this.status !== 'off') this.set('off', '');
  }

  /** 以目前手的位置為中心（搖桿回正位置） */
  recenter(): void {
    const { right, left } = assignHands(this.hands);
    if (right) this.rightNeutral = palmCenter(right);
    if (left) this.leftNeutral = palmCenter(left);
  }

  private readonly loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    // 約每秒 30 次辨識就足夠（省電、不卡畫面）
    if (!this.landmarker || this.video.readyState < 2 || now - this.lastDetect < 33) return;
    this.lastDetect = now;
    let result: { landmarks: Landmark[][] };
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch {
      return;
    }
    this.hands = result.landmarks ?? [];
    const { right, left } = assignHands(this.hands);
    if (!right) {
      // 看不到手：不更新時間戳 → 0.25 秒後自動懸停；中心也重設，下次伸手時以新位置為中心
      this.rightNeutral = null;
      this.leftNeutral = null;
      if (this.status !== 'no-hand') this.set('no-hand', '');
      return;
    }
    this.active = true;
    if ([right, left].some((h) => h && isFist(h))) {
      // 握拳＝懸停：搖桿全部回中（仍持續送新樣本，代表「操作者在場、要求停住」）
      this.push({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 }, now);
      if (this.status !== 'fist') this.set('fist', '');
      return;
    }
    this.rightNeutral ??= palmCenter(right);
    const r = handToStick(palmCenter(right), this.rightNeutral, this.range, true);
    const k = (key: string): number => Number(this.keys.has(key));
    let yaw = k('e') - k('q');
    let throttle = 0.5 + 0.25 * (k('r') - k('f'));
    if (left) {
      this.leftNeutral ??= palmCenter(left);
      const l = handToStick(palmCenter(left), this.leftNeutral, this.range, true);
      yaw = l.x;
      throttle = 0.5 + 0.5 * l.y;
    } else {
      this.leftNeutral = null;
    }
    this.push({ roll: r.x, pitch: r.y, yaw, throttle }, now);
    if (this.status !== 'tracking') this.set('tracking', '');
    else this.onState?.(this.state());
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if ('rfqe'.includes(key) && key.length === 1) this.keys.add(key);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private set(status: GestureStatus, message: string): void {
    this.status = status;
    this.error = message || null;
    this.onState?.(this.state());
  }

  private fail(message: string): void {
    this.active = false;
    this.set('error', message);
  }
}
