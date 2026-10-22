import { describe, expect, it } from 'vitest';
import {
  applySuggestionToProfile,
  axisPeaks,
  describeSuggestion,
  segmentMeanDeviations,
  suggestFromRecording,
  suggestionChanges,
  SUGGESTION_MIN_PEAK,
} from '../../src/ui/recording-suggestion';
import { createMode2Profile, type DeviceProfile } from '../../src/input/device-profile';
import type { AxisBinding } from '../../src/input/InputNormalizer';

/**
 * 依「右桿畫圈：上 → 右 → 下 → 左」錄製出的假樣本。
 * @param vertical 上下動的軸、@param verticalUpSign 推上時該軸的符號
 * @param horizontal 左右動的軸、@param horizontalRightSign 右打時該軸的符號
 * @param peak 推動幅度（0..1）
 */
function circleSamples(options: {
  vertical: number;
  verticalUpSign: number;
  horizontal: number;
  horizontalRightSign: number;
  peak: number;
  framesPerSegment?: number;
  leadRestFrames?: number;
}): number[][] {
  const per = options.framesPerSegment ?? 12;
  const lead = options.leadRestFrames ?? 4;
  const samples: number[][] = [];
  // 前幾幀靜止：模擬「按下錄製後才開始畫圈」，峰值才有意義的基準。
  for (let index = 0; index < lead; index += 1) samples.push([0, 0, -1, 0, 0, 0, 0, 0]);
  for (let phase = 0; phase < 4; phase += 1) {
    for (let index = 0; index < per; index += 1) {
      const sample = [0, 0, -1, 0, 0, 0, 0, 0];
      const up = options.verticalUpSign * options.peak;
      const right = options.horizontalRightSign * options.peak;
      if (phase === 0) sample[options.vertical] = up;
      if (phase === 1) sample[options.horizontal] = right;
      if (phase === 2) sample[options.vertical] = -up;
      if (phase === 3) sample[options.horizontal] = -right;
      samples.push(sample);
    }
  }
  return samples;
}

function currentBindings(profile: DeviceProfile): { pitch: AxisBinding; roll: AxisBinding } {
  return { pitch: profile.axes.pitch, roll: profile.axes.roll };
}

/**
 * 目前生效的美國手標定：roll←a0、pitch←a1、yaw←a3、throttle←a2。
 * 2026-10-22 真機實測 axis1 推上為正，歷史紀錄 -1 已不適用，預設草稿的 pitch
 * 因此是 reverse=false；`mode2(true)` 用來重現修正前（reverse=true）的舊綁定。
 */
function mode2(pitchReverse = false): DeviceProfile {
  const profile = createMode2Profile('Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)');
  if (pitchReverse === profile.axes.pitch.calibration.reverse) return profile;
  return {
    ...profile,
    axes: {
      ...profile.axes,
      pitch: {
        ...profile.axes.pitch,
        calibration: { ...profile.axes.pitch.calibration, reverse: pitchReverse },
      },
    },
  };
}

describe('axisPeaks / segmentMeanDeviations', () => {
  it('峰值取 max |值 − 起始值|，段落平均偏離依 上/右/下/左 分段', () => {
    const samples = circleSamples({ vertical: 1, verticalUpSign: -1, horizontal: 0, horizontalRightSign: 1, peak: 0.98 });
    const peaks = axisPeaks(samples);
    expect(peaks[1]).toBeCloseTo(0.98, 6);
    expect(peaks[0]).toBeCloseTo(0.98, 6);
    expect(peaks[2]).toBe(0); // 油門靜止在底部，整段沒動

    const segments = segmentMeanDeviations(samples);
    // 上推 = 負 → 第 0 段（上）平均偏離為負（前導靜止幀會稀釋，故只斷言方向與量級）
    expect(segments[1][0]).toBeLessThan(-0.5);
    expect(segments[1][2]).toBeGreaterThan(0.5);
    // 右打 = 正 → 第 1 段（右）平均偏離為正
    expect(segments[0][1]).toBeGreaterThan(0.5);
    expect(segments[0][3]).toBeLessThan(-0.5);
  });
});

describe('suggestFromRecording — 三種情況', () => {
  it('映射正確：上推為正 → 建議 pitch←a1(reverse=false)，與目前綁定一致', () => {
    const profile = mode2();
    const suggestion = suggestFromRecording(
      circleSamples({ vertical: 1, verticalUpSign: 1, horizontal: 0, horizontalRightSign: 1, peak: 0.98 }),
      currentBindings(profile),
    );
    expect(suggestion.ok).toBe(true);
    expect(suggestion.pitch).toMatchObject({ axis: 1, reverse: false, sign: 1, valid: true });
    expect(suggestion.roll).toMatchObject({ axis: 0, reverse: false, sign: 1, valid: true });
    expect(suggestion.matches).toEqual({ pitch: true, roll: true });
    expect(describeSuggestion(suggestion)).toContain('右桿上下 = axis1，推上為正');
    expect(describeSuggestion(suggestion)).toContain('建議 pitch ← axis1（reverse=false）');
    expect(describeSuggestion(suggestion)).toContain('一致');
    // 兩組都一致 → 不需要套用，也不改任何通道
    expect(suggestionChanges(suggestion)).toEqual([]);
    expect(applySuggestionToProfile(profile, suggestion)).toBeNull();
  });

  it('source 綁錯（上下/左右互換）：建議各自換回正確的軸', () => {
    // 模擬 08-20 那份 roll/pitch 互換的舊檔
    const profile = mode2();
    const swapped: DeviceProfile = {
      ...profile,
      axes: {
        ...profile.axes,
        roll: { ...profile.axes.roll, source: 1 },
        pitch: { ...profile.axes.pitch, source: 0, calibration: { ...profile.axes.pitch.calibration, reverse: false } },
      },
    };
    const suggestion = suggestFromRecording(
      circleSamples({ vertical: 1, verticalUpSign: 1, horizontal: 0, horizontalRightSign: 1, peak: 0.98 }),
      currentBindings(swapped),
    );
    expect(suggestion.ok).toBe(true);
    expect(suggestion.pitch).toMatchObject({ axis: 1, reverse: false });
    expect(suggestion.roll).toMatchObject({ axis: 0, reverse: false });
    expect(suggestion.matches).toEqual({ pitch: false, roll: false });
    expect(describeSuggestion(suggestion)).toContain('不一致');

    const next = applySuggestionToProfile(swapped, suggestion);
    expect(next).not.toBeNull();
    expect(next!.axes.pitch.source).toBe(1);
    expect(next!.axes.pitch.calibration.reverse).toBe(false);
    expect(next!.axes.roll.source).toBe(0);
    expect(next!.axes.roll.calibration.reverse).toBe(false);
    // 只改 pitch / roll：偏航、油門與其他校正欄位原樣
    expect(next!.axes.yaw).toEqual(swapped.axes.yaw);
    expect(next!.axes.throttle).toEqual(swapped.axes.throttle);
    expect(next!.axes.pitch.calibration.deadzone).toBe(swapped.axes.pitch.calibration.deadzone);
    expect(suggestionChanges(suggestion)).toEqual(['pitch', 'roll']);
  });

  it('方向反（軸對但推上為負）：建議翻 reverse，不改 source', () => {
    // 目前綁定 reverse=false（真機推上為正），錄製卻顯示推上為負 → 建議翻成 true。
    const profile = mode2();
    expect(profile.axes.pitch.calibration.reverse).toBe(false);
    const suggestion = suggestFromRecording(
      circleSamples({ vertical: 1, verticalUpSign: -1, horizontal: 0, horizontalRightSign: 1, peak: 0.98 }),
      currentBindings(profile),
    );
    expect(suggestion.ok).toBe(true);
    expect(suggestion.pitch).toMatchObject({ axis: 1, sign: -1, reverse: true });
    expect(suggestion.matches).toEqual({ pitch: false, roll: true });

    const next = applySuggestionToProfile(profile, suggestion)!;
    // source 不變、只翻 reverse
    expect(next.axes.pitch.source).toBe(1);
    expect(next.axes.pitch.calibration.reverse).toBe(true);
    expect(next.axes.roll).toEqual(profile.axes.roll);
    // 只有 pitch 需要改：roll 已驗證正確，完全不碰
    expect(suggestionChanges(suggestion)).toEqual(['pitch']);
  });

  it('2026-10-22 實際修正：舊檔 reverse=true + 真機推上為正 → 建議翻成 false', () => {
    // 迴歸釘：pitchroll-restore 檔（reverse=true）上線後真機前推變後退，
    // 軸向探針實測推上為正，錄製建議必須是 reverse=false 且只改 pitch。
    const profile = mode2(true);
    expect(profile.axes.pitch.calibration.reverse).toBe(true);
    const suggestion = suggestFromRecording(
      circleSamples({ vertical: 1, verticalUpSign: 1, horizontal: 0, horizontalRightSign: 1, peak: 0.98 }),
      currentBindings(profile),
    );
    expect(suggestion.ok).toBe(true);
    expect(suggestion.pitch).toMatchObject({ axis: 1, sign: 1, reverse: false });
    expect(suggestion.matches).toEqual({ pitch: false, roll: true });

    const next = applySuggestionToProfile(profile, suggestion)!;
    expect(next.axes.pitch.source).toBe(1);
    expect(next.axes.pitch.calibration.reverse).toBe(false);
    expect(next.axes.roll).toEqual(profile.axes.roll);
    expect(suggestionChanges(suggestion)).toEqual(['pitch']);
  });

  it('roll 已驗證正確時，套用建議不會碰到 roll', () => {
    const profile = mode2();
    // pitch 目前綁錯（綁到 axis0），roll 已是實測正確的 a0/false
    const wrongPitchOnly: DeviceProfile = {
      ...profile,
      axes: {
        ...profile.axes,
        pitch: { ...profile.axes.pitch, source: 0, calibration: { ...profile.axes.pitch.calibration, reverse: false } },
      },
    };
    const suggestion = suggestFromRecording(
      circleSamples({ vertical: 1, verticalUpSign: 1, horizontal: 0, horizontalRightSign: 1, peak: 0.98 }),
      currentBindings(wrongPitchOnly),
    );
    expect(suggestion.matches).toEqual({ pitch: false, roll: true });
    const next = applySuggestionToProfile(wrongPitchOnly, suggestion)!;
    expect(next.axes.pitch.source).toBe(1);
    expect(next.axes.pitch.calibration.reverse).toBe(false);
    expect(next.axes.roll).toBe(wrongPitchOnly.axes.roll);
  });
});

describe('suggestFromRecording — 無效錄製', () => {
  it('峰值低於 0.7 → 結論無效，不得給出任何建議', () => {
    const profile = mode2();
    const suggestion = suggestFromRecording(
      circleSamples({ vertical: 1, verticalUpSign: -1, horizontal: 0, horizontalRightSign: 1, peak: 0.079 }),
      currentBindings(profile),
    );
    expect(suggestion.ok).toBe(false);
    expect(suggestion.pitch.valid).toBe(false);
    expect(suggestion.pitch.axis).toBeNull();
    expect(suggestion.pitch.reason).toContain('請推到底重錄');
    expect(suggestion.retryHint).toContain(String(SUGGESTION_MIN_PEAK.toFixed(2)));
    expect(applySuggestionToProfile(profile, suggestion)).toBeNull();
    expect(suggestionChanges(suggestion)).toEqual([]);
  });

  it('只有一根軸在動（另一組沒有對應軸）→ 無效並要求重錄', () => {
    const profile = mode2();
    // 只推上下：左右段沒有任何軸達到峰值門檻
    const samples: number[][] = [];
    for (let index = 0; index < 4; index += 1) samples.push([0, 0, -1, 0, 0, 0, 0, 0]);
    for (let index = 0; index < 48; index += 1) {
      const segment = Math.floor(index / 12);
      const sample = [0, 0, -1, 0, 0, 0, 0, 0];
      if (segment === 0) sample[1] = -0.98;
      if (segment === 2) sample[1] = 0.98;
      samples.push(sample);
    }
    const suggestion = suggestFromRecording(samples, currentBindings(profile));
    expect(suggestion.ok).toBe(false);
    expect(suggestion.pitch.valid).toBe(true);
    expect(suggestion.roll.valid).toBe(false);
    expect(suggestion.roll.reason).toContain('右桿左右');
    expect(suggestion.retryHint).toContain('重錄');
  });

  it('樣本不足 → 無效', () => {
    const profile = mode2();
    const suggestion = suggestFromRecording([[0, 0, -1, 0]], currentBindings(profile));
    expect(suggestion.ok).toBe(false);
    expect(suggestion.retryHint).toContain('樣本不足');
  });
});
