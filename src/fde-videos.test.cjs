const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dataPath = path.join(__dirname, 'data', 'fdeVideos.js');

test('FDE column metadata defines supported categories and editable playlist settings', () => {
  assert.ok(fs.existsSync(dataPath), 'FDE video metadata should be stored outside the UI component');
  const { FDE_VIDEO_CATEGORIES, FDE_VIDEO_FILTERS, FDE_VIDEOS, YOUTUBE_PLAYLIST_ID } = require(dataPath);

  assert.deepEqual(FDE_VIDEO_CATEGORIES, {
    fde: 'FDE-AI',
    ai: 'AI 應用',
    yolo: 'YOLO 目標檢測',
    rag: 'RAG 知識庫',
    f450: 'F450',
    'flight-control': '飛控',
    inspection: '無人機巡檢',
    industry: '產業應用',
    tutorial: '教學'
  });
  assert.deepEqual(FDE_VIDEO_FILTERS.map(({ id }) => id), [
    'all', 'ai', 'yolo', 'rag', 'f450', 'flight-control', 'inspection', 'industry'
  ]);
  assert.equal(YOUTUBE_PLAYLIST_ID, '');
  assert.ok(FDE_VIDEOS.length >= 6);
  assert.equal(new Set(FDE_VIDEOS.map(({ id }) => id)).size, FDE_VIDEOS.length);
  assert.ok(FDE_VIDEOS.every((video) =>
    video.id && video.title && video.description && video.tags.length > 0 &&
    Object.hasOwn(FDE_VIDEO_CATEGORIES, video.category) && typeof video.youtubeUrl === 'string'
  ));
});

test('FDE-AI column includes the provided enterprise RAG video', () => {
  const { FDE_VIDEOS } = require(dataPath);
  const video = FDE_VIDEOS.find(({ id }) => id === 'enterprise-rag-knowledge-base');

  assert.ok(video);
  assert.equal(video.title, '企業 RAG 知識庫搭建解析（FDE-AI）');
  assert.equal(video.youtubeUrl, 'https://youtu.be/ajWnFJSM_BU?si=aU3E3hNoRwgIZl2E');
  assert.equal(video.videoId, 'ajWnFJSM_BU');
  assert.equal(video.category, 'fde');
});
