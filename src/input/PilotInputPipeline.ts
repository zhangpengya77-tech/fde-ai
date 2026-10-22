import { ChannelMapper } from './ChannelMapper';
import { InputNormalizer, type NormalizedChannels } from './InputNormalizer';
import type { DeviceProfile } from './device-profile';
import type { PilotInputAdapter } from './PilotInputAdapter';
import type { PilotCommand } from '../flight/types';

export type PilotInputSource =
  | { kind: 'keyboard'; label: string }
  | { kind: 'adapter'; id: string; label: string; adapterId: string };

export interface PipelineResult {
  command: PilotCommand;
  source: PilotInputSource;
  /**
   * 診斷用中間值：raw 通道 → 歸一化 → 指令。
   *
   * 只為了讓 HUD 能「一眼看出哪一層出錯」而存在：raw 與 norm 都對、只有
   * command 反了 → 問題在映射；command 對但機體往別的方向走 → 問題在飛控
   * 的航向旋轉或場景。鍵盤來源沒有這個欄位（鍵盤本來就直接產生指令）。
   */
  trace?: PipelineTrace;
}

export interface PipelineTrace {
  /** 裝置回報的原始通道值（未校正、未歸一化）。 */
  readonly rawChannels: readonly number[];
  readonly normalized: NormalizedChannels;
  readonly profile: DeviceProfile;
  /** 這筆樣本是否已判定為斷線/過期（過期時 command 會被強制成懸停）。 */
  readonly stale: boolean;
}

export interface PilotInputPipelineOptions {
  /** Sources in priority order. The first connected, fresh source wins. */
  adapters?: PilotInputAdapter[];
  /** Keyboard fallback used whenever no radio controller is live. */
  keyboard: () => PilotCommand;
  /** Synchronous resolver from an adapter id to its device profile. */
  profileFor: (adapterId: string) => DeviceProfile | null;
  /** Clock for stale detection; defaults to performance.now(). */
  now?: () => number;
}

/**
 * Unifies keyboard and generic radio controllers into one flight command.
 *
 * Brand neutrality is preserved end-to-end: the pipeline only knows device
 * profiles, never controller brands. The radio adapter that wins is whichever
 * is connected and reporting fresh samples; otherwise the keyboard takes over.
 *
 * Safety: a controller whose samples carry a timestamp older than
 * `STALE_INPUT_MS` (measured inside the ChannelMapper) is treated as a lost
 * link and commands hover - the throttle is held, never zeroed. This protects
 * against a starved render loop (hidden tab, blocked main thread) exactly as a
 * dropped cable would. The pipeline forwards the adapter's own sample
 * timestamp, so staleness always reflects what the device actually reported.
 */
export class PilotInputPipeline {
  private readonly normalizer = new InputNormalizer();
  private readonly mappers = new Map<string, { profile: DeviceProfile; mapper: ChannelMapper }>();
  private lastError: string | null = null;

  constructor(private readonly options: PilotInputPipelineOptions) {}

  /** Last non-fatal diagnostic (e.g. a binding that no longer fits the device). */
  getLastError(): string | null {
    return this.lastError;
  }

  poll(nowMs?: number): PipelineResult {
    const clock = this.options.now ?? (() => performance.now());
    const now = typeof nowMs === 'number' ? nowMs : clock();
    this.lastError = null;

    for (const adapter of this.options.adapters ?? []) {
      const raw = adapter.poll(now);
      if (!raw.connected) continue;

      const key = adapter.id;
      const profile = this.options.profileFor(key);
      if (!profile) continue;

      let normalized;
      try {
        normalized = this.normalizer.normalizeChannels(raw, profile.axes);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      const mapper = this.mapperFor(key, profile);
      const command = mapper.map({ raw, normalized, profile, nowMs: now });
      return {
        command,
        source: { kind: 'adapter', id: key, label: profile.label, adapterId: key },
        trace: {
          rawChannels: raw.channels,
          normalized,
          profile,
          stale: mapper.isStale({ raw, normalized, profile, nowMs: now }),
        },
      };
    }

    return {
      command: this.options.keyboard(),
      source: { kind: 'keyboard', label: '鍵盤' },
    };
  }

  private mapperFor(key: string, profile: DeviceProfile): ChannelMapper {
    const existing = this.mappers.get(key);
    if (existing && existing.profile === profile) return existing.mapper;
    const mapper = new ChannelMapper(profile);
    this.mappers.set(key, { profile, mapper });
    return mapper;
  }
}
