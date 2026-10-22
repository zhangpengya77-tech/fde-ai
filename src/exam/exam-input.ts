/**
 * 考試模式輸入來源（CAA 專業基本級術科模擬）。
 *
 * 硬約束（使用者指定）：
 *  - 必須複用「現有標定檔與輸入管線」InputNormalizer → ChannelMapper，
 *    不得另寫一套映射、不得改標定檔；
 *  - 輸入來源可切換（搖桿／鍵盤），預設有搖桿就用搖桿，鍵盤為備援；
 *  - 搖桿油門語意與考試機一致（ChannelMapper 輸出 throttle∈[0,1]，
 *    回中 0.5 → 定位／姿態模式維持高度；斷線時保持油門不回零）。
 *
 * 本模組只「讀取」既有標定生態：ProfileStore（IndexedDB，標定向導寫入的
 * 同一份）、auto-profile 的自動匯入／升級純函式、GamepadInputAdapter 與
 * KeyboardInputAdapter，完全不改寫映射或標定邏輯。
 */

import { GamepadInputAdapter } from '../input/adapters/GamepadInputAdapter';
import { KeyboardInputAdapter } from '../input/adapters/KeyboardInputAdapter';
import type { PilotInputAdapter } from '../input/PilotInputAdapter';
import { PilotInputPipeline, type PipelineResult } from '../input/PilotInputPipeline';
import { resolveProfileStore, type ProfileStore } from '../ui/profile-store';
import {
  BUNDLED_RC_PROFILE_ENDPOINT,
  describeAxisMapping,
  fetchLatestRcProfile,
  parseLatestProfileResponse,
  sameAxisMapping,
  shouldAutoApply,
  shouldUpgradeStoredProfile,
} from '../input/auto-profile';
import type { DeviceProfile } from '../input/device-profile';

/** HUD 顯示用：目前輸入來源與生效標定。 */
export interface ExamInputInfo {
  /** 目前實際生效的來源（搖桿連線且有標定才算 adapter）。 */
  sourceKind: 'keyboard' | 'adapter';
  /** 來源標籤（例：搖桿裝置 id／鍵盤）。 */
  sourceLabel: string;
  /** 使用者偏好（auto=有搖桿就用搖桿；keyboard=強制鍵盤）。 */
  preference: 'auto' | 'keyboard';
  /** 生效標定是否存在。 */
  hasProfile: boolean;
  /** 生效標定名稱（profile.label）。 */
  profileLabel: string;
  /** 標定檔來源種類（給 HUD 顯示）。 */
  profileOrigin: string;
  /** 標定檔名（live/bundled 擷取檔；本機檔為空）。 */
  profileFile: string;
  /** 四軸映射摘要（describeAxisMapping）。 */
  mapping: string;
  /** 本機檔與伺服器最新擷取檔軸映射不同時為真（僅提示，不自動改）。 */
  conflict: boolean;
  conflictMapping: string;
  /** 搖桿已連線但尚無生效標定（因此仍在用鍵盤）。 */
  connectedWithoutProfile: boolean;
}

export interface ExamInputOptions {
  /** 測試縫：搖桿來源。預設 GamepadInputAdapter(0)。 */
  adapters?: PilotInputAdapter[];
  /** 測試縫：鍵盤事件目標。預設 window。 */
  keyboardTarget?: Window;
  /** 測試縫：標定儲存。預設 resolveProfileStore()（IndexedDB）。 */
  store?: ProfileStore;
  /** 測試縫：自動匯入來源。預設 fetchLatestRcProfile（live → 靜態備援）。 */
  autoProfileSource?: (deviceId: string) => Promise<unknown>;
}

interface ProfileMeta {
  origin: string;
  file: string;
  savedAtMs: number;
}

const EMPTY_INFO: ExamInputInfo = {
  sourceKind: 'keyboard',
  sourceLabel: '鍵盤',
  preference: 'auto',
  hasProfile: false,
  profileLabel: '—',
  profileOrigin: '—',
  profileFile: '',
  mapping: '—',
  conflict: false,
  conflictMapping: '',
  connectedWithoutProfile: false,
};

export class ExamInput {
  readonly gamepad: PilotInputAdapter;

  private readonly keyboard: KeyboardInputAdapter;
  private readonly store: ProfileStore;
  private readonly autoProfileSource: (deviceId: string) => Promise<unknown>;
  /** 由 device id 對應的生效標定（與標定向導寫入的標定檔同一份儲存）。 */
  private readonly deviceProfiles = new Map<string, DeviceProfile>();
  private readonly profileMeta = new Map<string, ProfileMeta>();
  private readonly conflictCache = new Map<string, string>();
  private readonly adapters: PilotInputAdapter[];

  private readonly pipeline: PilotInputPipeline;

  private preference: 'auto' | 'keyboard' = 'auto';
  private resolvedId: string | null = null;
  private info: ExamInputInfo = { ...EMPTY_INFO };
  private started = false;
  /** 最近一次 tick 的上下文，供非同步標定解析完成後重算 HUD 資訊。 */
  private lastConnectedId: string | null = null;
  private lastUsingAdapter = false;
  private lastSourceLabel = '鍵盤';

  constructor(options: ExamInputOptions = {}) {
    this.gamepad = options.adapters?.[0] ?? new GamepadInputAdapter(0);
    this.adapters = options.adapters ? [...options.adapters] : [this.gamepad];
    this.keyboard = new KeyboardInputAdapter(options.keyboardTarget ?? window);
    this.store = options.store ?? resolveProfileStore().store;
    this.autoProfileSource =
      options.autoProfileSource ??
      ((deviceId: string) =>
        fetchLatestRcProfile({ deviceId, fallbackEndpoint: BUNDLED_RC_PROFILE_ENDPOINT }));
    this.pipeline = new PilotInputPipeline({
      adapters: this.adapters,
      keyboard: () => this.keyboard.poll(),
      profileFor: (id) => this.deviceProfiles.get(id) ?? null,
    });
  }

  /**
   * 啟動：連接搖桿、載入本機已存標定。自動匯入在 tick() 偵測到裝置 id 時
   * 非同步進行（瀏覽器要按過按鍵才會暴露 gamepad，無法在建構時取得 id）。
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    void Promise.resolve(this.gamepad.connect()).catch(() => undefined);
    try {
      const list = await this.store.list();
      await Promise.all(
        list.map(async (profile) => {
          this.deviceProfiles.set(profile.id, profile);
          try {
            const stored = await this.store.read(profile.id);
            if (stored) {
              this.profileMeta.set(profile.id, {
                origin: stored.origin?.kind ?? 'local',
                file: stored.origin?.file ?? '',
                savedAtMs: stored.savedAtMs,
              });
            }
          } catch {
            /* 讀不到來源資訊不影響飛行：僅 HUD 顯示較粗略。 */
          }
        }),
      );
    } catch {
      /* IndexedDB 不可用時（無痕／隱私模式）僅用鍵盤，不得阻擋教學。 */
    }
  }

  /** 每幀呼叫：取得本帧指令（走既有輸入管線）。 */
  tick(nowMs?: number): PipelineResult {
    const result = this.pipeline.poll(nowMs);

    // 以「搖桿是否連線」為準觸發標定解析，而不是以「管線是否已選用搖桿」
    // 為準：標定尚未載入時管線會回退鍵盤，但仍須觸發自動匯入，否則永遠拿不到
    // 標定（先有雞還是先有蛋的死結）。
    const connectedId = this.connectedDeviceId();
    if (connectedId !== null && connectedId !== this.resolvedId) {
      this.resolvedId = connectedId;
      void this.ensureProfile(connectedId);
    }

    if (result.source.kind === 'adapter') {
      this.lastConnectedId = result.source.adapterId;
      this.lastUsingAdapter = true;
      this.lastSourceLabel = result.source.label;
    } else {
      this.lastConnectedId = connectedId;
      this.lastUsingAdapter = false;
      this.lastSourceLabel = '鍵盤';
    }
    this.info = this.buildInfo(this.lastConnectedId, {
      usingAdapter: this.lastUsingAdapter,
      adapterConnected: this.lastConnectedId !== null,
      sourceLabel: this.lastSourceLabel,
    });
    return result;
  }

  /** 非同步標定解析完成後重算 HUD 資訊（否則要等下一幀才反映新標定／衝突）。 */
  private refreshInfo(): void {
    this.info = this.buildInfo(this.lastConnectedId, {
      usingAdapter: this.lastUsingAdapter,
      adapterConnected: this.lastConnectedId !== null,
      sourceLabel: this.lastSourceLabel,
    });
  }

  /** 目前連線中的搖桿裝置 id（沒有則 null）。 */
  private connectedDeviceId(): string | null {
    for (const adapter of this.adapters) {
      if (adapter.isConnected === true) return adapter.id;
    }
    return null;
  }

  /** 切換輸入來源偏好：auto（有搖桿就用搖桿）／keyboard（強制鍵盤備援）。 */
  setPreference(preference: 'auto' | 'keyboard'): void {
    this.preference = preference;
    if (preference === 'keyboard') this.adapters.length = 0;
    else if (this.adapters.length === 0) this.adapters.push(this.gamepad);
    this.info = { ...this.info, preference };
  }

  togglePreference(): void {
    this.setPreference(this.preference === 'auto' ? 'keyboard' : 'auto');
  }

  getPreference(): 'auto' | 'keyboard' {
    return this.preference;
  }

  getInfo(): ExamInputInfo {
    return this.info;
  }

  dispose(): void {
    this.gamepad.disconnect();
    this.keyboard.dispose();
  }

  // ---------------------------------------------------------------- private

  private buildInfo(
    deviceId: string | null,
    opts: { usingAdapter: boolean; adapterConnected: boolean; sourceLabel: string },
  ): ExamInputInfo {
    const profile = deviceId ? this.deviceProfiles.get(deviceId) ?? null : null;
    const meta = deviceId ? this.profileMeta.get(deviceId) : undefined;
    const conflict = deviceId ? this.conflictCache.get(deviceId) ?? '' : '';
    return {
      sourceKind: opts.usingAdapter ? 'adapter' : 'keyboard',
      sourceLabel: opts.usingAdapter ? opts.sourceLabel : '鍵盤',
      preference: this.preference,
      hasProfile: profile !== null,
      profileLabel: profile?.label ?? '—',
      profileOrigin: meta?.origin ?? '—',
      profileFile: meta?.file ?? '',
      mapping: profile ? describeAxisMapping(profile) : '—',
      conflict: conflict !== '',
      conflictMapping: conflict,
      connectedWithoutProfile: opts.adapterConnected && profile === null,
    };
  }

  /**
   * 解析指定裝置的生效標定（沿用 controller-calibration 的同一套規則）：
   *  - 本機已有標定 → 以本機檔為準，但若伺服器有更新的擷取檔則自動升級
   *    （以擷取檔自身 savedAtMs 落庫，保留「手動儲存永遠最新」語意）；
   *  - 本機沒有標定 → 嘗試自動匯入最新擷取檔（live → 靜態備援）。
   * 網路或儲存失敗一律沿用現況，不影響飛行。
   */
  private async ensureProfile(deviceId: string): Promise<void> {
    try {
      const stored = await this.store.read(deviceId);
      if (stored) {
        this.deviceProfiles.set(deviceId, stored.profile);
        this.profileMeta.set(deviceId, {
          origin: stored.origin?.kind ?? 'local',
          file: stored.origin?.file ?? '',
          savedAtMs: stored.savedAtMs,
        });
        await this.upgradeIfNewerOnline(stored, deviceId);
        return;
      }
      await this.autoImport(deviceId);
    } catch {
      /* 不得影響飛行：留空 → 管線回退鍵盤。 */
    } finally {
      this.refreshInfo();
    }
  }

  private async autoImport(deviceId: string): Promise<void> {
    const payload = parseLatestProfileResponse(await this.fetchSafely(deviceId));
    if (payload && shouldAutoApply(null, payload.profile, deviceId)) {
      // 以擷取檔自身的 savedAtMs 落庫：保留來源時間，
      // 之後更新的擷取檔才能繼續覆蓋這份舊的自動匯入。
      await this.store.write(payload.profile, payload.source.savedAtMs, {
        kind: payload.origin === 'bundled' ? 'bundled' : 'live',
        ...(payload.source.file ? { file: payload.source.file } : {}),
      });
      this.deviceProfiles.set(deviceId, payload.profile);
      this.profileMeta.set(deviceId, {
        origin: payload.origin === 'bundled' ? 'bundled' : 'live',
        file: payload.source.file,
        savedAtMs: payload.source.savedAtMs,
      });
    }
  }

  private async upgradeIfNewerOnline(
    stored: { profile: DeviceProfile; savedAtMs: number },
    deviceId: string,
  ): Promise<void> {
    const payload = parseLatestProfileResponse(await this.fetchSafely(deviceId));
    if (
      payload &&
      shouldAutoApply(null, payload.profile, deviceId) &&
      shouldUpgradeStoredProfile(stored.savedAtMs, payload.source.savedAtMs)
    ) {
      await this.store.write(payload.profile, payload.source.savedAtMs, {
        kind: payload.origin === 'bundled' ? 'bundled' : 'live',
        ...(payload.source.file ? { file: payload.source.file } : {}),
      });
      this.deviceProfiles.set(deviceId, payload.profile);
      this.profileMeta.set(deviceId, {
        origin: payload.origin === 'bundled' ? 'bundled' : 'live',
        file: payload.source.file,
        savedAtMs: payload.source.savedAtMs,
      });
      this.conflictCache.delete(deviceId);
      return;
    }

    // 本機檔以時間戳勝出；若伺服器最新擷取檔綁定不同軸，明說但不自動改。
    if (payload && !sameAxisMapping(payload.profile, stored.profile)) {
      this.conflictCache.set(deviceId, describeAxisMapping(payload.profile));
    } else {
      this.conflictCache.delete(deviceId);
    }
  }

  private async fetchSafely(deviceId: string): Promise<unknown> {
    try {
      return await this.autoProfileSource(deviceId);
    } catch {
      return null; // 網路失敗不得影響飛行：沿用本機檔／鍵盤。
    }
  }
}
