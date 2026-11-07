// REA 考照模擬器：示範語音解說（台灣女聲）與槳葉聲音的自動測試（2026-11-08）
import { describe, expect, it } from 'vitest';
import { SUBJECTS } from '../../src/rea/courses';
import { introNarration, pickVoice, stepNarration, toSpeech } from '../../src/rea/narrator';
import { rotorTarget } from '../../src/rea/rotor-audio';
import type { Command } from '../../src/rea/physics';

const v = (name: string, lang: string) => ({ name, lang });

describe('挑選解說聲音', () => {
  it('Windows 有曉臻（台灣女聲）時選曉臻，不選男聲或大陸聲音', () => {
    const voices = [v('Microsoft Yunjhe - Chinese (Taiwan)', 'zh-TW'), v('Microsoft Xiaoxiao - Chinese (Mainland)', 'zh-CN'), v('Microsoft HsiaoChen Online - Chinese (Taiwan)', 'zh-TW')];
    expect(pickVoice(voices)?.name).toContain('HsiaoChen');
  });
  it('Apple 裝置選美佳、Android 選 Google 國語（臺灣）', () => {
    expect(pickVoice([v('Ting-Ting', 'zh-CN'), v('Mei-Jia', 'zh-TW')])?.name).toBe('Mei-Jia');
    expect(pickVoice([v('Google 普通话（中国大陆）', 'zh-CN'), v('Google 國語（臺灣）', 'zh-TW')])?.name).toBe('Google 國語（臺灣）');
  });
  it('沒有已知女聲時：避開男聲，選其他台灣聲音；都沒有就用任何中文聲音', () => {
    expect(pickVoice([v('Microsoft Zhiwei', 'zh-TW'), v('Some TW Voice', 'zh_TW')])?.name).toBe('Some TW Voice');
    expect(pickVoice([v('Ting-Ting', 'zh-CN'), v('Samantha', 'en-US')])?.name).toBe('Ting-Ting');
    expect(pickVoice([v('Samantha', 'en-US')])).toBeNull();
  });
});

describe('示範解說文字', () => {
  it('每個已實作科目的每一步都有中文解說，不含英文程式字樣', () => {
    for (const s of SUBJECTS.filter((x) => x.implemented)) {
      expect(introNarration(s)).toContain(s.name);
      for (const st of s.steps) {
        const text = stepNarration(st);
        expect(text.length).toBeGreaterThan(8);
        expect(text).not.toMatch(/undefined|NaN|kind|heading/);
      }
    }
  });
  it('停懸步驟說明停幾秒與機頭方向；念出來時數字轉成中文', () => {
    const t = stepNarration({ kind: 'hold', seconds: 5, heading: 90, label: '朝右停 5 秒' });
    expect(t).toContain('朝右停穩五秒');
    expect(toSpeech(t)).not.toMatch(/\d/);
  });
  it('念法：P1–P4、12×5 m、1.5 公尺都轉成自然中文', () => {
    expect(toSpeech('沿 P1–P4 的 12×5 m 長方形，每個角錐停 5 秒')).toBe('沿 P1 到 P4 的 十二乘五公尺 長方形，每個角錐停 五秒');
    expect(toSpeech('高度 1.5 公尺')).toBe('高度 一點五公尺');
  });
});

describe('槳葉聲音', () => {
  const cmd = (throttle: number, yaw = 0): Command => ({ throttle, pitch: 0, roll: 0, yaw });
  const air = { armed: true, landed: false, crashed: false, pitchDeg: 0, rollDeg: 0 };

  it('未解鎖或墜機時不出聲', () => {
    expect(rotorTarget('quad-4kg', cmd(0.8), { ...air, armed: false }).gain).toBe(0);
    expect(rotorTarget('quad-4kg', cmd(0.8), { ...air, crashed: true }).gain).toBe(0);
  });
  it('推油門轉速變高、收油門變低；地面怠速比懸停低', () => {
    const hover = rotorTarget('quad-4kg', cmd(0.5), air);
    const up = rotorTarget('quad-4kg', cmd(1), air);
    const down = rotorTarget('quad-4kg', cmd(0), air);
    const idle = rotorTarget('quad-4kg', cmd(0), { ...air, landed: true });
    expect(up.freq).toBeGreaterThan(hover.freq);
    expect(down.freq).toBeLessThan(hover.freq);
    expect(idle.spin).toBeLessThan(hover.spin);
    expect(idle.gain).toBeGreaterThan(0);
  });
  it('機型越大音高越低（800 g > 4 kg > 18 kg 六軸）', () => {
    const f = (id: 'quad-800g' | 'quad-4kg' | 'hexa-18kg') => rotorTarget(id, cmd(0.5), air).freq;
    expect(f('quad-800g')).toBeGreaterThan(f('quad-4kg'));
    expect(f('quad-4kg')).toBeGreaterThan(f('hexa-18kg'));
  });
  it('傾斜飛行需要更多推力，轉速比懸停高', () => {
    expect(rotorTarget('quad-4kg', cmd(0.5), { ...air, pitchDeg: 20 }).spin).toBeGreaterThan(rotorTarget('quad-4kg', cmd(0.5), air).spin);
  });
});
