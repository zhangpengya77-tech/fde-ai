/**
 * 風場與安全宣告（CAA 專業基本級術科考場模擬，general.wind p4）。
 *
 * 語意（2026-10-23 修正，教師核准）：
 *  - `gustMps` 是「瞬時風速的峰值上限（陣峰）」，必須 ≥ 平均風；
 *  - 瞬時風速在「平均風」與「陣峰」之間波動：`v(t) = mean + (peak − mean)·|sin|`；
 *  - **不得**把陣風再疊加在平均風之上（舊版 `mean + gust` 會讓峰值變成
 *    7.5 + 10 = 17.5 m/s，超過定位保持可補償上限，機體一起飛就被吹走）。
 *
 * 安全宣告門檻（官方，AC 107-005D p4，維持不變）：
 *  - 平均風達 7.5 m/s（15 節）或
 *  - 瞬間陣風達 10 m/s（20 節）
 *  → 監評人員應對應考人進行安全宣告，並由應考人自行評估是否繼續執行測驗。
 *
 * 預設風況為「無風」；「微風」「接近門檻」為模擬假設（非官方），定義在
 * `config/caa-exam.json` → `simAssist.windPresets`，可於畫面切換。
 *
 * 本模組僅做風場模擬與門檻判定；是否「繼續」由應考人（或本模擬的操作者）決定，
 * 模擬不代為決策。風向為教學自設（模擬假設）。
 */

import type { Vector3Like } from '../flight/types';
import type { ExamConfig } from './config';
import type { WindState } from './types';

/** 陣風振盪週期（秒，模擬假設）。 */
const DEFAULT_GUST_PERIOD_S = 8;

/** 風況選項（來自 config.simAssist.windPresets）。 */
export interface WindPreset {
  key: string;
  label: string;
  /** 平均風（m/s）。 */
  meanMps: number;
  /** 陣風峰值上限（m/s，≥ meanMps）。 */
  gustMps: number;
  /** true = 官方數值；false = 模擬假設（非官方）。 */
  official: boolean;
  note?: string;
}

export interface WindFieldOptions {
  /** 風況選項 key（calm／breeze／nearThreshold／declaration）。優先於 mean/gust。 */
  preset?: string;
  /** 平均風速（m/s）。給定即視為自訂風況。 */
  meanWindMps?: number;
  /** 陣風峰值（m/s，上限；小於平均風時自動抬到平均風）。 */
  gustMps?: number;
  /** 風向（度）：風吹向的方向（場平面角，0=+X，90=+Z）。預設 0（向 +X）。 */
  directionDeg?: number;
  /** 陣風週期（秒）。 */
  gustPeriodS?: number;
}

/** 讀出 config 內的風況選項清單（缺漏時給安全的 0/0 後備）。 */
export function readWindPresets(config: ExamConfig): { presets: WindPreset[]; defaultPreset: string } {
  const raw = config.simAssist?.windPresets;
  const presets: WindPreset[] = (raw?.presets ?? []).map((p) => ({
    key: p.key,
    label: p.label,
    meanMps: Math.max(0, p.meanMps),
    // 陣峰不得低於平均風。
    gustMps: Math.max(Math.max(0, p.gustMps), Math.max(0, p.meanMps)),
    official: p.official,
    note: p.note,
  }));
  if (presets.length === 0) {
    presets.push({ key: 'calm', label: '無風', meanMps: 0, gustMps: 0, official: true });
  }
  const fallback = presets[0].key;
  const wanted = raw?.defaultPreset ?? fallback;
  const defaultPreset = presets.some((p) => p.key === wanted) ? wanted : fallback;
  return { presets, defaultPreset };
}

export class WindField {
  private meanWindMps: number;
  /** 陣風峰值上限（瞬時風速的上界）。 */
  private gustPeakMps: number;
  private readonly directionRad: number;
  private readonly gustPeriodS: number;
  private readonly declarationText: string;
  /** 安全宣告門檻（m/s），官方值。 */
  private readonly meanThresholdMps: number;
  private readonly gustThresholdMps: number;
  /** 可切換的風況清單。 */
  private readonly presets: WindPreset[];

  private presetKey: string;
  private timeS = 0;
  /** 當前瞬時風速（m/s），介於 mean 與 peak 之間。 */
  private instantMps = 0;

  constructor(config: ExamConfig, options: WindFieldOptions = {}) {
    const { presets, defaultPreset } = readWindPresets(config);
    this.presets = presets;
    const chosen = presets.find((p) => p.key === options.preset);
    const fallback = presets.find((p) => p.key === defaultPreset) ?? presets[0];

    const custom = options.meanWindMps !== undefined || options.gustMps !== undefined;
    const mean = options.meanWindMps ?? chosen?.meanMps ?? fallback.meanMps;
    this.meanWindMps = Math.max(0, mean);
    this.gustPeakMps = Math.max(0, options.gustMps ?? chosen?.gustMps ?? fallback.gustMps);
    // 陣峰不得低於平均風（自訂風況給 gust=0 時視為定風）。
    if (this.gustPeakMps < this.meanWindMps) this.gustPeakMps = this.meanWindMps;
    this.presetKey = custom ? 'custom' : (chosen?.key ?? fallback.key);
    this.instantMps = this.meanWindMps;

    this.directionRad = ((options.directionDeg ?? 0) * Math.PI) / 180;
    this.gustPeriodS = options.gustPeriodS ?? DEFAULT_GUST_PERIOD_S;
    this.declarationText = config.wind.declarationText;
    this.meanThresholdMps = SAFETY_DECLARATION.meanWindMps;
    this.gustThresholdMps = SAFETY_DECLARATION.gustMps;
  }

  /**
   * 推進風場時間，更新瞬時風速。
   *
   * 瞬時風速 = 平均風 + (陣峰 − 平均風) × (1 − cos(2πt/T))/2，
   * 因此恆落在 [平均風, 陣峰] 區間內；平均風＝陣峰時為定風。
   *
   * 用 (1−cos)/2 而非 |sin|：|sin| 在 t=0、T/2 有尖角（風速瞬間折返），
   * 會讓「頂風維持定點」的操作出現對地速度突波（實測 0.5 m/s 以上），
   * 把懸停平台切碎。餘弦過渡在兩端導數為 0，較符合實際陣風的連續變化。
   */
  step(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.timeS += delta;
    const amplitude = this.gustPeakMps - this.meanWindMps;
    const wave = (1 - Math.cos((2 * Math.PI * this.timeS) / this.gustPeriodS)) / 2;
    this.instantMps = this.meanWindMps + amplitude * wave;
    // 數值收斂保護：浮點誤差不得讓瞬時風超出 [mean, peak]。
    if (this.instantMps < this.meanWindMps) this.instantMps = this.meanWindMps;
    if (this.instantMps > this.gustPeakMps) this.instantMps = this.gustPeakMps;
  }

  /** 當前風向量（瞬時風速，世界 XZ）。供飛控 applyWind 使用。 */
  currentVector(): Vector3Like {
    const dirX = Math.cos(this.directionRad);
    const dirZ = Math.sin(this.directionRad);
    return { x: dirX * this.instantMps, y: 0, z: dirZ * this.instantMps };
  }

  getState(): WindState {
    const dirX = Math.cos(this.directionRad);
    const dirZ = Math.sin(this.directionRad);
    const fluctuation = Math.max(0, this.instantMps - this.meanWindMps);
    return {
      mean: { x: dirX * this.meanWindMps, y: 0, z: dirZ * this.meanWindMps },
      // 陣風增量（瞬時 − 平均），非峰值；峰值見 gustSpeedMps。
      gust: { x: dirX * fluctuation, y: 0, z: dirZ * fluctuation },
      speedMps: this.instantMps,
      meanSpeedMps: this.meanWindMps,
      gustSpeedMps: this.gustPeakMps,
      instantSpeedMps: this.instantMps,
    };
  }

  /** 平均風速（m/s）。 */
  getMeanWindMps(): number {
    return this.meanWindMps;
  }

  /** 陣風峰值上限（m/s）。 */
  getGustPeakMps(): number {
    return this.gustPeakMps;
  }

  /** 當前瞬時風速（m/s）。 */
  getInstantSpeedMps(): number {
    return this.instantMps;
  }

  /** 當前陣風增量（瞬時 − 平均，m/s）。 */
  getGustAmplitudeMps(): number {
    return Math.max(0, this.instantMps - this.meanWindMps);
  }

  /**
   * 是否需要安全宣告（p4，官方門檻）：平均風 ≥ 7.5 m/s 或 陣風峰值 ≥ 10 m/s。
   *
   * 以「陣峰」比對而非瞬時值：陣峰是風況的定義值，宣告與否不應隨正弦波動閃爍。
   */
  needsSafetyDeclaration(): boolean {
    return this.meanWindMps >= this.meanThresholdMps || this.gustPeakMps >= this.gustThresholdMps;
  }

  /** 安全宣告文字（config.wind.declarationText）。 */
  getDeclarationText(): string {
    return this.declarationText;
  }

  /** 目前風況 key（自訂風況為 'custom'）。 */
  getPresetKey(): string {
    return this.presetKey;
  }

  /** 可切換的風況清單。 */
  getPresets(): readonly WindPreset[] {
    return this.presets;
  }

  /** 目前風況（自訂風況回傳以當前數值組出的物件）。 */
  getPreset(): WindPreset {
    return (
      this.presets.find((p) => p.key === this.presetKey) ?? {
        key: this.presetKey,
        label: '自訂',
        meanMps: this.meanWindMps,
        gustMps: this.gustPeakMps,
        official: false,
      }
    );
  }

  /** 切換風況（不改飛行狀態；下一帧起飛控即吃到新風）。回傳是否成功。 */
  setPreset(key: string): boolean {
    const preset = this.presets.find((p) => p.key === key);
    if (!preset) return false;
    this.presetKey = preset.key;
    this.meanWindMps = preset.meanMps;
    this.gustPeakMps = preset.gustMps;
    this.instantMps = this.meanWindMps;
    return true;
  }

  /** 設定平均風速（m/s，教學/UI 調整用）。 */
  setMeanWind(mps: number): void {
    this.meanWindMps = Math.max(0, mps);
    if (this.gustPeakMps < this.meanWindMps) this.gustPeakMps = this.meanWindMps;
    this.presetKey = 'custom';
  }

  /** 設定陣風峰值（m/s；小於平均風時抬到平均風）。 */
  setGustPeak(mps: number): void {
    this.gustPeakMps = Math.max(this.meanWindMps, mps);
    this.presetKey = 'custom';
  }
}

/**
 * 純函式門檻判定（供單元測試與 UI 預覽，不依賴時間）。
 *
 * @param meanWindMps 平均風（m/s）
 * @param gustPeakMps 陣風峰值（m/s，瞬時風速的上限；不是「加在平均風上的振幅」）
 */
export function needsSafetyDeclaration(
  meanWindMps: number,
  gustPeakMps: number,
  meanThresholdMps = SAFETY_DECLARATION.meanWindMps,
  gustThresholdMps = SAFETY_DECLARATION.gustMps,
): boolean {
  return meanWindMps >= meanThresholdMps || gustPeakMps >= gustThresholdMps;
}

/** 門檻常數（官方值，供 UI 標註）。 */
export const SAFETY_DECLARATION = {
  meanWindMps: 7.5,
  gustMps: 10,
} as const;
