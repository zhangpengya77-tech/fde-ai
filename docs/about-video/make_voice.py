# -*- coding: utf-8 -*-
"""依 script.json 產生每一段台灣口音旁白（edge-tts，zh-TW-HsiaoChenNeural），並算出每個場景長度
（旁白長度＋前後留白），輸出 timing.txt 給動畫頁使用（?timing=…）。
用法：python make_voice.py <輸出資料夾>
"""
import asyncio
import json
import subprocess
import sys
import wave
from pathlib import Path

import edge_tts
import imageio_ffmpeg

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'voice')
OUT.mkdir(parents=True, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = 'zh-TW-HsiaoChenNeural'
LEAD, TAIL = 0.6, 0.7          # 每段旁白前留 0.6 秒（場景淡入）、後留 0.7 秒（換場）

script = json.loads((HERE / 'script.json').read_text(encoding='utf-8'))


async def tts(text, mp3):
    await edge_tts.Communicate(text, VOICE, rate='+4%').save(str(mp3))


timings = []
for i, sc in enumerate(script['scenes']):
    mp3 = OUT / f'{i}_{sc["id"]}.mp3'
    wav = OUT / f'{i}_{sc["id"]}.wav'
    asyncio.run(tts(sc['text'], mp3))
    # 轉成 44.1kHz 立體聲 wav，方便量長度與後續混音
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(mp3), '-ar', '44100', '-ac', '2', str(wav)], check=True)
    with wave.open(str(wav)) as w:
        sec = w.getnframes() / w.getframerate()
    dur = round(LEAD + sec + TAIL, 2)
    timings.append({'id': sc['id'], 'voice_sec': round(sec, 2), 'scene_sec': dur})
    print(f'{sc["id"]}: 旁白 {sec:.2f} 秒 → 場景 {dur:.2f} 秒')

total = sum(x['scene_sec'] for x in timings)
(OUT / 'timing.json').write_text(json.dumps({'lead': LEAD, 'scenes': timings, 'total': total}, ensure_ascii=False, indent=2), encoding='utf-8')
(OUT / 'timing.txt').write_text(','.join(str(x['scene_sec']) for x in timings), encoding='utf-8')
print(f'總長 {total:.2f} 秒')
