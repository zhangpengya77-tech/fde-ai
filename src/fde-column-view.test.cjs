const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, 'fde-column.js');
const moduleExists = fs.existsSync(modulePath);
const FdeColumn = moduleExists ? require(modulePath) : null;
const fixtureVideos = [
  {
    id: 'yolo-card',
    title: 'YOLO <script>alert(1)</script>',
    description: '目標檢測示範',
    category: 'yolo',
    tags: ['FDE-AI', 'YOLO'],
    youtubeUrl: 'https://www.youtube.com/watch?v=AbCdEfGhI12'
  },
  {
    id: 'rag-card',
    title: 'RAG 知識庫',
    description: '專欄佔位內容',
    category: 'rag',
    tags: ['RAG'],
    youtubeUrl: ''
  }
];

test('FDE column rendering and playback helpers', async (t) => {
  assert.ok(moduleExists, 'FDE column view helpers should exist');

  await t.test('filters the real video list by category and keeps all categories visible', () => {
    assert.deepEqual(FdeColumn.filterVideos('all', fixtureVideos).map(({ id }) => id), ['yolo-card', 'rag-card']);
    assert.deepEqual(FdeColumn.filterVideos('yolo', fixtureVideos).map(({ id }) => id), ['yolo-card']);
    assert.deepEqual(FdeColumn.filterVideos('unknown', fixtureVideos), []);
  });

  await t.test('parses supported YouTube URLs but rejects unrelated hosts', () => {
    assert.equal(FdeColumn.getYoutubeVideoId('https://www.youtube.com/watch?v=AbCdEfGhI12'), 'AbCdEfGhI12');
    assert.equal(FdeColumn.getYoutubeVideoId('https://youtu.be/AbCdEfGhI12'), 'AbCdEfGhI12');
    assert.equal(FdeColumn.getYoutubeVideoId('https://youtube.com/shorts/AbCdEfGhI12'), 'AbCdEfGhI12');
    assert.equal(FdeColumn.getYoutubeVideoId('https://example.com/watch?v=AbCdEfGhI12'), null);
  });

  await t.test('renders escaped card text, lazy thumbnails, and no iframe before playback', () => {
    const card = FdeColumn.renderVideoCard(fixtureVideos[0]);

    assert.match(card, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(card, /https:\/\/i\.ytimg\.com\/vi\/AbCdEfGhI12\/hqdefault\.jpg/);
    assert.match(card, /loading="lazy"/);
    assert.match(card, /data-play-video="AbCdEfGhI12"/);
    assert.doesNotMatch(card, /<iframe/i);
  });

  await t.test('keeps URL-less placeholders non-playable without loading external media', () => {
    const card = FdeColumn.renderVideoCard(fixtureVideos[1]);

    assert.match(card, /YouTube 連結待提供/);
    assert.match(card, /disabled/);
    assert.doesNotMatch(card, /<iframe|ytimg\.com/i);
  });

  await t.test('creates privacy-enhanced video and playlist embeds only on request', () => {
    assert.match(FdeColumn.renderVideoPlayer('AbCdEfGhI12'), /youtube-nocookie\.com\/embed\/AbCdEfGhI12\?autoplay=1/);
    assert.match(FdeColumn.renderVideoPlayer('AbCdEfGhI12'), /loading="lazy"/);
    assert.equal(FdeColumn.renderVideoPlayer('invalid'), '');
    assert.equal(FdeColumn.renderPlaylistPlayer(''), '');
    assert.match(FdeColumn.renderPlaylistPlayer('PLabc_123'), /youtube-nocookie\.com\/embed\/videoseries\?list=PLabc_123/);
  });
});
