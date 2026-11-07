/**
 * REA 考照模擬器：考場風況（風向、風力、陣風、風向擺動）。
 * 介面選項比照參考網站可見的設定項目；數值換算為自行定義，非原站數值。
 */

import type { Vec2 } from './courses';

/** 風從哪個方向吹來（相對考生）。 */
export type WindFrom = 'front' | 'front-right' | 'right' | 'back-right' | 'back' | 'back-left' | 'left' | 'front-left';

export const WIND_FROM_LABELS: Record<WindFrom, string> = {
  front: '前方（遠離考生那一側）', 'front-right': '右前方', right: '右邊', 'back-right': '右後方',
  back: '後方（考生背後）', 'back-left': '左後方', left: '左邊', 'front-left': '左前方',
};

const FROM_DEG: Record<WindFrom, number> = {
  front: 0, 'front-right': 45, right: 90, 'back-right': 135, back: 180, 'back-left': 225, left: 270, 'front-left': 315,
};

export interface WindSettings {
  from: WindFrom;
  /** 風力 0–5 級（訓練用級距）。 */
  level: number;
  /** 陣風 0–8。 */
  gust: number;
  /** 風向擺動：小／中／大／瘋狂。 */
  sway: 'small' | 'medium' | 'large' | 'crazy';
}

export const DEFAULT_WIND: WindSettings = { from: 'front', level: 0, gust: 0, sway: 'small' };

/** 風力級 → 平均風速（m/s）。5 級 = 7.5 m/s，對應規範「平均風 7.5 m/s 監評做安全宣告」門檻。 */
export function levelToSpeed(level: number): number {
  return [0, 1.5, 3, 4.5, 6, 7.5][Math.max(0, Math.min(5, Math.round(level)))];
}

const SWAY_DEG = { small: 8, medium: 20, large: 40, crazy: 90 } as const;

/** 可重現的平滑雜訊（多個不可公度正弦疊加），測試時結果固定。 */
function smoothNoise(t: number, seed: number): number {
  return (
    0.5 * Math.sin(t * 0.61 + seed) +
    0.3 * Math.sin(t * 1.37 + seed * 2.1) +
    0.2 * Math.sin(t * 2.93 + seed * 3.7)
  );
}

export class Wind {
  constructor(public settings: WindSettings = { ...DEFAULT_WIND }, private seed = 1.234) {}

  /** t 秒時的風速向量（場地座標，空氣流動方向）。 */
  at(t: number): Vec2 {
    const base = levelToSpeed(this.settings.level);
    const gustAmp = this.settings.gust * 0.6; // 每級陣風約 +0.6 m/s 峰值
    const speed = Math.max(0, base + gustAmp * Math.max(0, smoothNoise(t, this.seed)));
    if (speed === 0) return { x: 0, y: 0 };
    const fromDeg = FROM_DEG[this.settings.from] + SWAY_DEG[this.settings.sway] * smoothNoise(t * 0.4, this.seed + 7);
    // 風「從」fromDeg 吹來 → 空氣往 fromDeg+180 流動
    const toRad = ((fromDeg + 180) * Math.PI) / 180;
    return { x: speed * Math.sin(toRad), y: speed * Math.cos(toRad) };
  }

  /** 是否達到規範的「安全宣告」門檻（平均風 ≥ 7.5 m/s 或陣風峰值 ≥ 10 m/s）。 */
  safetyDeclaration(): boolean {
    const base = levelToSpeed(this.settings.level);
    return base >= 7.5 || base + this.settings.gust * 0.6 >= 10;
  }
}
