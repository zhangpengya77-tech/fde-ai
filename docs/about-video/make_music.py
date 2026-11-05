# -*- coding: utf-8 -*-
"""FDE-AI 介紹動畫背景音樂（自行合成，無版權問題，2026-11-06）

風格：淡淡的科技感氛圍音樂——柔和的和弦鋪底（Am–F–C–G）、輕輕的琶音脈衝、低頻與緩慢的濾波掃頻。
音量刻意壓低，作為旁白底下的背景。
用法：python make_music.py <秒數> <輸出 wav>
"""
import sys
import wave

import numpy as np

SR = 44100
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 56.0
OUT = sys.argv[2] if len(sys.argv) > 2 else 'bgm.wav'
t = np.arange(int(SR * DUR)) / SR


def note(n):
    """MIDI 音號 → 頻率"""
    return 440.0 * 2 ** ((n - 69) / 12)


def soft_saw(freq, tt, harmonics=6):
    """柔和鋸齒波（少量泛音，聽起來溫暖不刺耳）"""
    out = np.zeros_like(tt)
    for k in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * freq * k * tt) / (k ** 1.6)
    return out


def adsr(n, a, r):
    """簡單的淡入淡出包絡（秒）"""
    env = np.ones(n)
    ai, ri = int(a * SR), int(r * SR)
    env[:ai] = np.linspace(0, 1, ai)
    env[-ri:] *= np.linspace(1, 0, ri)
    return env


# 和弦進行（每個和弦 4 秒）：Am – F – C – G，循環
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]]
BAR = 4.0
pad = np.zeros_like(t)
arp = np.zeros_like(t)
bass = np.zeros_like(t)
for b in range(int(np.ceil(DUR / BAR))):
    s0, s1 = int(b * BAR * SR), min(len(t), int((b + 1) * BAR * SR))
    if s0 >= len(t):
        break
    seg = t[s0:s1] - b * BAR
    chord = CHORDS[b % 4]
    n = s1 - s0
    # 鋪底和弦：三個音＋微微走音（雙聲部）營造寬度
    for m in chord:
        f = note(m)
        pad[s0:s1] += (soft_saw(f, seg) + 0.7 * soft_saw(f * 1.003, seg)) * adsr(n, 1.2, 1.2) * 0.06
    # 低音：和弦根音低八度的正弦
    bass[s0:s1] += np.sin(2 * np.pi * note(chord[0] - 12) * seg) * adsr(n, 0.4, 0.8) * 0.12
    # 琶音：每 0.25 秒一個音，短促、帶點回音感
    for k in range(int(BAR / 0.25)):
        m = chord[k % 3] + (12 if k % 8 >= 4 else 0) + 12
        a0 = s0 + int(k * 0.25 * SR)
        ln = int(0.22 * SR)
        if a0 + ln > len(t):
            break
        tt = np.arange(ln) / SR
        tone = np.sin(2 * np.pi * note(m) * tt) * np.exp(-tt * 14) * 0.05
        arp[a0:a0 + ln] += tone
        d = a0 + int(0.375 * SR)                       # 簡單回音（3/8 秒後、音量 35%）
        if d + ln < len(t):
            arp[d:d + ln] += tone * 0.35

# 緩慢的「掃頻」空氣聲：低通濾波過的雜訊，音量隨時間緩慢起伏
rng = np.random.default_rng(7)
noise = rng.standard_normal(len(t))
kernel = np.ones(400) / 400
air = np.convolve(noise, kernel, mode='same') * (0.5 + 0.5 * np.sin(2 * np.pi * t / 16)) * 0.35

mix = pad + arp + bass + air
# 開頭 2 秒淡入、結尾 3 秒淡出
mix *= adsr(len(t), 2.0, 3.0)
# 立體聲：琶音左右輕微交錯，增加空間感
left = mix + 0.3 * np.roll(arp, int(0.012 * SR))
right = mix - 0.1 * arp
stereo = np.stack([left, right], axis=1)
stereo /= np.max(np.abs(stereo)) + 1e-9
stereo *= 0.5                                             # 背景音量，保留旁白空間
pcm = (stereo * 32767).astype(np.int16)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'背景音樂完成：{OUT}（{DUR:.1f} 秒）')
