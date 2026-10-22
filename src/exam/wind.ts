/**
 * 風場與安全宣告（CAA 專業基本級術科考場模擬，general.wind p4）。
 *
 * 門檻（AC 107-005D p4，config.wind）：
 *  - 平均風達 7.5 m/s（15 節）或
 *  - 瞬間陣風達 10 m/s（20 節）
 *  → 監評人員應對應考人進行安全宣告，並由應考人自行評估是否繼續執行測驗。
 *
 * 本模組僅做風場模擬（平均風 + 隨時間擾動的陣風）與門檻判定；是否「繼續」
 * 由應考人（或本模擬的操作者）決定，模擬不代為決策。
 *
 * 數值：mean/gust 預設取自 config.wind（m/s 欄位為準，1 節=0.514444
 * m/s 官方同時給出兩種單位，這裡以 m/s 為權威）；方向為教學自設（模擬假設）。
 */

import type { Vector3Like } from '../flight/types';
import type { ExamConfig } from './config';
import type { WindState } from './types';

/** 陣風振盪週期（秒，模擬假設）。 */
const DEFAULT_GUST_PERIOD_S = 8;

export interface WindFieldOptions {
  /** 平均風速（m/s）。預設取 config.wind.meanWindMps。 */
  meanWindMps?: number;
  /** 陣風峰值（m/s）。預設取 config.wind.gustMps。 */
  gustMps?: number;
  /** 風向（度）：風吹向的方向（場平面角，0=+X，90=+Z）。預設 0（向 +X）。 */
  directionDeg?: number;
  /** 陣風週期（秒）。 */
  gustPeriodS?: number;
}

export class WindField {
  private meanWindMps: number;
  private gustMps: number;
  private readonly directionRad: number;
  private readonly gustPeriodS: number;
  private readonly declarationText: string;
  /** 安全宣告門檻（m/s），來自 config。 */
  private readonly meanThresholdMps: number;
  private readonly gustThresholdMps: number;

  private timeS = 0;
  private gustMagnitudeMps = 0;

  constructor(config: ExamConfig, options: WindFieldOptions = {}) {
    this.meanWindMps = options.meanWindMps ?? config.wind.meanWindMps;
    this.gustMps = options.gustMps ?? config.wind.gustMps;
    this.directionRad = ((options.directionDeg ?? 0) * Math.PI) / 180;
    this.gustPeriodS = options.gustPeriodS ?? DEFAULT_GUST_PERIOD_S;
    this.declarationText = config.wind.declarationText;
    this.meanThresholdMps = 7.5;
    this.gustThresholdMps = 10;
  }

  /** 推進風場時間，更新陣風振幅（0..gustMps 之間振盪）。 */
  step(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.timeS += delta;
    // 陣風振幅隨時間在 0..gustMps 間振盪（|sin|）。
    this.gustMagnitudeMps =
      this.gustMps * Math.abs(Math.sin((2 * Math.PI * this.timeS) / this.gustPeriodS));
  }

  /** 當前合風向量（平均 + 陣風，世界 XZ）。供飛控 applyWind 使用。 */
  currentVector(): Vector3Like {
    const dirX = Math.cos(this.directionRad);
    const dirZ = Math.sin(this.directionRad);
    return {
      x: dirX * (this.meanWindMps + this.gustMagnitudeMps),
      y: 0,
      z: dirZ * (this.meanWindMps + this.gustMagnitudeMps),
    };
  }

  getState(): WindState {
    const dirX = Math.cos(this.directionRad);
    const dirZ = Math.sin(this.directionRad);
    const mean: Vector3Like = { x: dirX * this.meanWindMps, y: 0, z: dirZ * this.meanWindMps };
    const gust: Vector3Like = { x: dirX * this.gustMagnitudeMps, y: 0, z: dirZ * this.gustMagnitudeMps };
    const total = this.currentVector();
    return {
      mean,
      gust,
      speedMps: Math.hypot(total.x, total.z),
      meanSpeedMps: this.meanWindMps,
      gustSpeedMps: this.gustMagnitudeMps,
    };
  }

  /** 平均風速（m/s）。 */
  getMeanWindMps(): number {
    return this.meanWindMps;
  }

  /** 當前陣風振幅（m/s，隨時間變化）。 */
  getGustMagnitudeMps(): number {
    return this.gustMagnitudeMps;
  }

  /**
   * 是否需要安全宣告（p4）：平均風 ≥ 7.5 m/s 或 瞬間陣風 ≥ 10 m/s。
   * 陣風以當前振幅（隨時間變化）比對門檻。
   */
  needsSafetyDeclaration(): boolean {
    return this.meanWindMps >= this.meanThresholdMps || this.gustMagnitudeMps >= this.gustThresholdMps;
  }

  /** 安全宣告文字（config.wind.declarationText）。 */
  getDeclarationText(): string {
    return this.declarationText;
  }

  /** 設定平均風速（m/s，教學/UI 調整用）。 */
  setMeanWind(mps: number): void {
    this.meanWindMps = Math.max(0, mps);
  }

  /** 設定陣風峰值（m/s）。 */
  setGust(mps: number): void {
    this.gustMps = Math.max(0, mps);
  }
}

/**
 * 純函式門檻判定（供單元測試與 UI 預覽，不依賴時間）。
 * 平均風達 meanThreshold 或陣風達 gustThreshold 即需宣告。
 */
export function needsSafetyDeclaration(
  meanWindMps: number,
  gustMps: number,
  meanThresholdMps = 7.5,
  gustThresholdMps = 10,
): boolean {
  return meanWindMps >= meanThresholdMps || gustMps >= gustThresholdMps;
}

/** 門檻常數（供 UI 標註）。 */
export const SAFETY_DECLARATION = {
  meanWindMps: 7.5,
  gustMps: 10,
} as const;
