"""從相機膠卷影片抽 frame，做 contact sheet，以尋找真實槳葉照片。

唯讀來源（Camera Roll），輸出寫入本階段工作區。
"""

from __future__ import annotations

import os

import cv2
import numpy as np

SRC = r"C:\Users\admin\Pictures\Camera Roll"
OUT = r"D:\FDE-AI-UAS-v2.0\ops\launch-20261029\evidence\camroll"
os.makedirs(OUT, exist_ok=True)


def main() -> int:
    videos = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".mp4"))
    for name in videos:
        path = os.path.join(SRC, name)
        cap = cv2.VideoCapture(path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        dur = total / fps if fps else 0
        print(f"{name}: {w}x{h} frames={total} fps={fps:.2f} dur={dur:.1f}s")
        if total <= 0:
            cap.release()
            continue
        picks = np.linspace(0, max(total - 1, 0), min(12, total)).astype(int)
        tiles = []
        for idx in picks:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if not ok:
                continue
            scale = 320 / max(frame.shape[1], 1)
            frame = cv2.resize(frame, (320, int(frame.shape[0] * scale)))
            cv2.putText(frame, f"f{int(idx)}", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
            tiles.append(frame)
        cap.release()
        if not tiles:
            continue
        cols = 4
        rows = (len(tiles) + cols - 1) // cols
        th = max(t.shape[0] for t in tiles)
        tw = max(t.shape[1] for t in tiles)
        sheet = np.zeros((rows * th, cols * tw, 3), dtype=np.uint8)
        for i, t in enumerate(tiles):
            r, c = divmod(i, cols)
            sheet[r * th:r * th + t.shape[0], c * tw:c * tw + t.shape[1]] = t
        out = os.path.join(OUT, name.replace(".mp4", "_sheet.jpg"))
        cv2.imwrite(out, sheet, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        print("   ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
