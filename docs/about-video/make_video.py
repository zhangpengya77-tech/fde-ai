# -*- coding: utf-8 -*-
"""合成「關於我們」介紹影片：逐格畫面＋旁白（依場景時間對齊）＋背景音樂（說話時自動壓低）→ MP4
用法：python make_video.py <畫面資料夾> <旁白資料夾> <背景音樂 wav> <輸出 mp4>
"""
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

frames, voice_dir, bgm, out = (Path(a) for a in sys.argv[1:5])
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
timing = json.loads((voice_dir / 'timing.json').read_text(encoding='utf-8'))
lead = timing['lead']
total = timing['total']

# 每段旁白的開始時間＝前面場景長度總和＋淡入留白
inputs, filters, labels, start = [], [], [], 0.0
for i, sc in enumerate(timing['scenes']):
    wav = voice_dir / f'{i}_{sc["id"]}.wav'
    inputs += ['-i', str(wav)]
    ms = int((start + lead) * 1000)
    filters.append(f'[{i + 2}:a]adelay={ms}|{ms},volume=1.6[v{i}]')
    labels.append(f'[v{i}]')
    start += sc['scene_sec']

n = len(labels)
filter_complex = ';'.join(filters) + ';' + \
    f'{"".join(labels)}amix=inputs={n}:normalize=0:duration=longest,apad[voice];' + \
    '[voice]asplit=2[voice1][voice2];' + \
    f'[1:a]atrim=0:{total:.2f},volume=0.55[bgm];' + \
    '[bgm][voice1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];' + \
    f'[duck][voice2]amix=inputs=2:normalize=0:duration=first,afade=t=out:st={total - 2.0:.2f}:d=2.0,atrim=0:{total:.2f}[aout]'

cmd = [FFMPEG, '-y', '-loglevel', 'error',
       '-framerate', '30', '-i', str(frames / 'f%05d.jpg'),
       '-i', str(bgm), *inputs,
       '-filter_complex', filter_complex,
       '-map', '0:v', '-map', '[aout]',
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
       '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
       '-movflags', '+faststart', '-shortest', str(out)]
subprocess.run(cmd, check=True)
# 封面圖（給網頁 <video poster>）：取開場第 4 秒
subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-ss', '4', '-i', str(out), '-frames:v', '1', '-q:v', '3', str(out.with_suffix('.jpg'))], check=True)
print(f'影片完成：{out}（約 {total:.1f} 秒）')
