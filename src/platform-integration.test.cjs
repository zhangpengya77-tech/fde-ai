const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = require('./vision-client.js');

const root = path.join(__dirname, '..');
const readFile = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  impl.calls = calls;
  return impl;
}

const okResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });

// ---------- 1. Homepage Build CTA → F450 Main-12 /live/ ----------
{
  const html = readFile('index.html');
  assert.match(html, /id="buildMain12Entry"[^>]*href="\/live\/"/, 'Build CTA 必須存在並指向 /live/');
  assert.match(html, /src="\.\/src\/vision-client\.js\?v=1\.0\.3-mobile-speech"/, '手機端必須載入最新 Vision client，避免 Safari 沿用舊快取');
  assert.match(html, /build-legacy-note/, 'legacy F450 必須保留為次級入口');
  assert.ok(/id="build"/.test(html) && /assistantQuestion/.test(html), 'legacy 1.0 build 內容必須保留');
  console.log('✓ Build CTA → /live/，legacy 保留');
}

// ---------- 6. Flight Health homepage link preserved ----------
{
  const html = readFile('index.html');
  assert.match(html, /href="\.\/flight-health\/"/, 'Flight Health 首頁入口必須保留');
  assert.match(html, /id="flight-health-entry"/, 'Flight Health 首頁區塊必須保留');
  console.log('✓ Flight Health 首頁入口未被破壞');
}

// ---------- 2. Assess PROP → official Vision API contract ----------
(async () => {
  const payload = {
    rule_version: 'prop-1.0',
    positions: {
      M1: { detected: 'CCW_F', expected: 'CCW_F', blade_face: 'FRONT', confidence: 0.93, result: 'PASS', reason: '方向與槳面正確' },
      M2: { detected: 'CCW_F', expected: 'CCW_F', blade_face: 'FRONT', confidence: 0.9, result: 'PASS', reason: '方向與槳面正確' },
      M3: { detected: 'CW_F', expected: 'CW_F', blade_face: 'FRONT', confidence: 0.88, result: 'PASS', reason: '方向與槳面正確' },
      M4: { detected: 'CW_B', expected: 'CW_F', blade_face: 'BACK', confidence: 0.8, result: 'NG', reason: '方向正確、槳面錯誤' },
    },
    final_result: 'NG',
    model: { model_id: 'PROP-1', model_version: 'v1' },
  };
  const fetchImpl = mockFetch(() => okResponse(payload));
  const result = await client.propCheck({
    fetchImpl,
    base: 'http://127.0.0.1:8030',
    imageDataUrl: 'data:image/jpeg;base64,AAAABBBB',
    imageWidth: 1280,
    imageHeight: 720,
    fileName: 'f450-top.jpg',
  });
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:8030/api/v1/vision/prop-check');
  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.image_base64, 'AAAABBBB', '必須送出純 base64（移除 data URL 前綴）');
  assert.equal(body.image_width, 1280);
  assert.equal(body.image_height, 720);
  assert.equal(result.finalResult, 'NG');
  assert.equal(result.motorChecks.length, 4);
  assert.equal(result.motorChecks[3].result, 'NG');
  console.log('✓ Assess PROP → /api/v1/vision/prop-check 正式合約');

  // 沒有 ACTIVE model → 明確「目前尚無可用模型」
  const noModel = mockFetch(() => okResponse({ final_result: 'CHECK', positions: {}, model: null }));
  await assert.rejects(
    () => client.propCheck({ fetchImpl: noModel, base: 'http://x', imageDataUrl: 'data:image/jpeg;base64,AA', imageWidth: 1, imageHeight: 1, fileName: 'a.jpg' }),
    (error) => {
      assert.equal(error.code, 'VISION_NO_ACTIVE_MODEL');
      assert.equal(error.message, client.NO_MODEL_MESSAGE);
      return true;
    },
  );
  console.log('✓ PROP 無 ACTIVE model → 明確提示，不回傳結果');
})();

// ---------- 3. Assess FOUR_SIDE_HOVER → official Vision API contract ----------
(async () => {
  const payload = {
    rule_version: 'hover-1.0', calibration_status: 'CALIBRATION_REQUIRED', directions: {},
    unknown_frames: 2, outside_time_seconds: 1.5, max_continuous_outside_seconds: 0.8,
    average_center_offset_m: 0.21, max_center_offset_m: 0.4, position_variation_m: 0.1,
    score: 72.5, result: 'NG', failure_reasons: ['MISSING_DIRECTION'],
  };
  const fetchImpl = mockFetch(() => okResponse(payload));
  const result = await client.hoverAnalyze({
    fetchImpl, base: 'http://127.0.0.1:8030', fileDataUrl: 'data:video/mp4;base64,VIDEO', fileName: 'hover.mp4',
  });
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:8030/api/v1/vision/hover-video');
  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.file_name, 'hover.mp4');
  assert.equal(body.file_base64, 'VIDEO');
  assert.equal(result.score, 72.5);
  assert.equal(result.summary.includes('尚未完成'), true);
  // 學生視圖不得暴露 Registry / Dataset / Golden Set / Benchmark 等資訊
  const rendered = JSON.stringify(result);
  for (const forbidden of ['golden', 'benchmark', 'dataset', 'candidate', 'registry', 'ACTIVE', 'provider']) {
    assert.equal(rendered.includes(forbidden), false, `學生結果不得暴露 ${forbidden}`);
  }
  console.log('✓ Assess HOVER → /api/v1/vision/hover-video 正式合約');

  // 後端無 ACTIVE model（422 active_model_required）→ 明確提示
  const rejected = mockFetch(() => ({ ok: false, status: 422, json: async () => ({ error: 'active_model_required' }) }));
  await assert.rejects(
    () => client.hoverAnalyze({ fetchImpl: rejected, base: 'http://x', fileDataUrl: 'data:video/mp4;base64,V', fileName: 'h.mp4' }),
    (error) => {
      assert.equal(error.code, 'VISION_NO_ACTIVE_MODEL');
      assert.equal(error.message, client.NO_MODEL_MESSAGE);
      return true;
    },
  );
  // 不支援的檔案格式 → 明確格式提示，不是模擬結果
  await assert.rejects(
    () => client.hoverAnalyze({ fetchImpl: mockFetch(() => okResponse({})), base: 'http://x', fileDataUrl: 'x', fileName: 'clip.txt' }),
    (error) => error.code === 'VISION_UNSUPPORTED_FILE',
  );
  console.log('✓ HOVER 無模型 / 格式錯誤 → 明確提示，非模擬');
})();

// ---------- 4. Production student flow：模擬不得冒充真實結果 ----------
{
  const appSource = readFile(path.join('src', 'app.js'));
  assert.ok(!/simulate/.test(readFile('src/vision-client.js')), '正式 vision client 不得包含任何模擬邏輯');
  for (const name of ['simulatePropellerAssessment', 'simulateHoverAssessment']) {
    const pattern = new RegExp(`${name}\\(`, 'g');
    let match;
    while ((match = pattern.exec(appSource)) !== null) {
      const before = appSource.slice(Math.max(0, match.index - 400), match.index);
      assert.match(before, /assessDevMode\(\)/, `${name} 必須只在 DEV MODE 中使用`);
    }
  }
  console.log('✓ 模擬僅限 DEV MODE，正式流程不冒充真實結果');
}

// ---------- Vision base URL resolution ----------
{
  const base = client.visionApiBase(
    { VISION_API_MODE: 'auto', VISION_API_BASE_URL: 'http://127.0.0.1:8030', PUBLIC_VISION_API_URL: '' },
    { protocol: 'http:', hostname: '127.0.0.1' },
  );
  assert.equal(base, 'http://127.0.0.1:8030');
  const publicBase = client.visionApiBase(
    { VISION_API_MODE: 'auto', VISION_API_BASE_URL: 'http://127.0.0.1:8030', PUBLIC_VISION_API_URL: 'https://vision.example.test' },
    { protocol: 'https:', hostname: 'fde.example.test', origin: 'https://fde.example.test' },
  );
  assert.equal(publicBase, 'https://vision.example.test');
  const lanBase = client.visionApiBase(
    { VISION_API_MODE: 'auto', VISION_API_BASE_URL: 'http://127.0.0.1:8030', PUBLIC_VISION_API_URL: '' },
    { protocol: 'http:', hostname: '192.168.1.114', origin: 'http://192.168.1.114:8111' },
  );
  assert.equal(lanBase, 'http://192.168.1.114:8111');
  console.log('✓ Vision API base 解析正確');
}

console.log('\n所有 Platform Integration 前端測試通過。');
