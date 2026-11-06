import type { PilotInputAdapter, PilotInputType, RawPilotInput } from '../PilotInputAdapter';
import { createMode2Profile, type DeviceProfile } from '../device-profile';

/**
 * 「虛擬搖桿」共用底層（2026-11-07）：原子筆鏡頭搖桿、手機遙控器都用它。
 *
 * 這兩種裝置本身就直接給出四軸數值（-1..1），所以把它們包成和實體遙控器
 * 一樣的原始通道（美國手 Mode 2 排列），接到既有的輸入管線：
 *   通道 0 = 橫滾 roll、1 = 俯仰 pitch、2 = 油門（-1 底部 … +1 頂部）、3 = 偏航 yaw
 * 好處：既有的安全規則完全沿用——樣本超過 250 毫秒沒更新（筆離開畫面、手機斷線、
 * 分頁被切到背景）就自動懸停，油門保持不歸零。
 */
export interface VirtualSticks {
  roll: number;
  pitch: number;
  yaw: number;
  /** 0..1；0.5 = 保持高度 */
  throttle: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

export abstract class VirtualStickAdapter implements PilotInputAdapter {
  abstract readonly id: string;
  abstract readonly type: PilotInputType;
  /** 顯示在畫面「輸入來源」的名稱 */
  abstract readonly label: string;

  protected sticks: VirtualSticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 };
  /** 最後一次「真的」收到新樣本的時間；超過 250 毫秒未更新就會被判定為斷訊 */
  protected sampleAtMs = -Infinity;
  /** 是否已啟用並校正完成（未完成時讓位給鍵盤） */
  protected active = false;
  protected error: string | null = null;

  abstract connect(): Promise<void>;
  abstract disconnect(): void;

  get isConnected(): boolean {
    return this.active;
  }

  get lastError(): string | null {
    return this.error;
  }

  /** 子類別收到新數值時呼叫 */
  protected push(next: Partial<VirtualSticks>, atMs: number): void {
    this.sticks = {
      roll: clamp(next.roll ?? this.sticks.roll, -1, 1),
      pitch: clamp(next.pitch ?? this.sticks.pitch, -1, 1),
      yaw: clamp(next.yaw ?? this.sticks.yaw, -1, 1),
      throttle: clamp(next.throttle ?? this.sticks.throttle, 0, 1),
    };
    this.sampleAtMs = atMs;
  }

  poll(_timestampMs: number): RawPilotInput {
    const s = this.sticks;
    return {
      // 用「真正收到樣本的時間」而不是現在時間，這樣斷訊時管線才會判定過期而懸停
      timestampMs: this.sampleAtMs,
      channels: [s.roll, s.pitch, s.throttle * 2 - 1, s.yaw],
      buttons: [],
      connected: this.active,
    };
  }

  private cachedProfile: DeviceProfile | null = null;

  /**
   * 這類裝置的通道排列固定，直接用美國手預設設定檔即可，不需要校正精靈。
   * 必須回傳「同一個」物件：管線以設定檔身分判斷是否沿用映射器，
   * 每次新建會讓映射器重設，斷訊時就記不住最後油門（會掉到 0）。
   */
  profile(): DeviceProfile {
    this.cachedProfile ??= createMode2Profile(this.id, { label: this.label, type: this.type });
    return this.cachedProfile;
  }

  /** 目前四軸數值（給畫面顯示用） */
  current(): VirtualSticks {
    return { ...this.sticks };
  }
}
