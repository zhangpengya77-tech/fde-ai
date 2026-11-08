// 把測試畫面（JPEG）組成 Chrome 假鏡頭用的 .mjpeg 影片（連續 JPEG），放在 test-results/live-camera/fixtures
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_DIR = resolve(fileURLToPath(new URL('../../test-results/live-camera/fixtures/', import.meta.url)));

export default function globalSetup() {
  const frames = process.env.PROP_LIVE_FRAMES;
  if (!frames || !existsSync(frames)) throw new Error('請設定 PROP_LIVE_FRAMES 指向測試畫面資料夾');
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const jpg = (name) => readFileSync(join(frames, `frame_${name}.jpg`));
  const repeat = (buffer, n) => Buffer.concat(Array(n).fill(buffer));
  // 單一畫面重複；修正流程：先 15 秒全反、再 15 秒正確（Chrome 以 30fps 播放）
  writeFileSync(join(FIXTURE_DIR, 'correct.mjpeg'), repeat(jpg('IMG_8415'), 60));
  writeFileSync(join(FIXTURE_DIR, 'reversed.mjpeg'), repeat(jpg('IMG_8258'), 60));
  writeFileSync(join(FIXTURE_DIR, 'uncertain.mjpeg'), repeat(jpg('IMG_8173'), 60));
  writeFileSync(join(FIXTURE_DIR, 'fix-sequence.mjpeg'), Buffer.concat([repeat(jpg('IMG_8258'), 450), repeat(jpg('IMG_8415'), 450)]));
}
