const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const clientPath = path.join(__dirname, 'rag-client.js');

function loadClient() {
  if (!existsSync(clientPath)) assert.fail('Unified RAG API client is not implemented');
  return require(clientPath);
}

function okResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test('posts only the question to the local F450 RAG API and returns the public result fields', async () => {
  const { createRagClient } = loadClient();
  const calls = [];
  const client = createRagClient({ RAG_API_MODE: 'local', RAG_API_BASE_URL: 'http://127.0.0.1:8770' }, async (url, options) => {
    calls.push({ url, options });
    return okResponse({ answer: 'CW 是順時針槳。', source_type: 'rag', score: 0.9, sources: [{ ref: 'private' }], version: 'f450_v1' });
  }, { protocol: 'http:', hostname: 'localhost' });

  const result = await client.askRag('CW 是什麼？');

  assert.equal(calls[0].url, 'http://127.0.0.1:8770/api/rag/ask');
  assert.deepEqual(JSON.parse(calls[0].options.body), { question: 'CW 是什麼？' });
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.deepEqual(result, { answer: 'CW 是順時針槳。', source_type: 'rag', version: 'f450_v1' });
});

test('preserves the original question so the RAG service can normalize it without losing the transcript', async () => {
  const { createRagClient } = loadClient();
  let requestBody;
  const client = createRagClient({ RAG_API_MODE: 'local', RAG_API_BASE_URL: 'http://127.0.0.1:8770' }, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return okResponse({ answer: '先看槳葉標示和弧面。', source_type: 'rag', version: 'f450_v1' });
  }, { protocol: 'http:', hostname: 'localhost' });

  await client.askRag('f450的講業正反面如何區分');

  assert.deepEqual(requestBody, { question: 'f450的講業正反面如何區分' });
});

test('uses only the public HTTPS API from a non-local page', async () => {
  const { createRagClient } = loadClient();
  const calls = [];
  const client = createRagClient({
    RAG_API_MODE: 'auto',
    RAG_API_BASE_URL: 'http://127.0.0.1:8770',
    PUBLIC_RAG_API_URL: 'https://rag.example.test'
  }, async (url) => {
    calls.push(url);
    if (url.startsWith('http://127.0.0.1')) throw new TypeError('Failed to fetch');
    return okResponse({ answer: '知識庫回答', source_type: 'rag', version: 'f450_v1' });
  }, { protocol: 'https:', hostname: 'zhangpengya77-tech.github.io' });

  const result = await client.askRag('F450 問題');

  assert.deepEqual(calls, ['https://rag.example.test/api/rag/ask']);
  assert.equal(result.source_type, 'rag');
});

test('does not fall back to a local HTTP API from a non-local HTTPS page', async () => {
  const { createRagClient } = loadClient();
  const calls = [];
  const client = createRagClient({
    RAG_API_MODE: 'auto',
    RAG_API_BASE_URL: 'http://127.0.0.1:8770',
    PUBLIC_RAG_API_URL: 'http://rag.example.test'
  }, async (url) => {
    calls.push(url);
    throw new TypeError('Failed to fetch');
  }, { protocol: 'https:', hostname: 'zhangpengya77-tech.github.io' });

  await assert.rejects(client.askRag('F450 問題'), { code: 'RAG_API_UNAVAILABLE' });
  assert.deepEqual(calls, []);
});

test('times out an unresponsive API request', async () => {
  const { createRagClient } = loadClient();
  const client = createRagClient({
    RAG_API_MODE: 'local',
    RAG_API_BASE_URL: 'http://127.0.0.1:8770',
    RAG_API_TIMEOUT_MS: 5
  }, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }), { protocol: 'http:', hostname: 'localhost' });

  await assert.rejects(client.askRag('F450 問題'), { code: 'RAG_API_UNAVAILABLE' });
});

test('rejects HTTP errors, malformed JSON, and empty answers', async (context) => {
  const { createRagClient } = loadClient();
  const cases = [
    ['HTTP 404', async () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['HTTP 500', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['invalid JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })],
    ['empty answer', async () => okResponse({ answer: '  ', source_type: 'rag' })]
  ];

  for (const [name, fetchImpl] of cases) {
    await context.test(name, async () => {
      const client = createRagClient({ RAG_API_MODE: 'local', RAG_API_BASE_URL: 'http://127.0.0.1:8770' }, fetchImpl,
        { protocol: 'http:', hostname: 'localhost' });
      await assert.rejects(client.askRag('F450 問題'), { code: 'RAG_API_UNAVAILABLE' });
    });
  }
});

test('maps all API source types to short student-facing labels', () => {
  const { sourceLabel } = loadClient();
  assert.equal(sourceLabel('rag'), 'F450 知识库');
  assert.equal(sourceLabel('rag_plus_llm'), 'F450 知识库 + AI 补充');
  assert.equal(sourceLabel('common_knowledge'), 'AI 常识补充');
  assert.equal(sourceLabel('refuse'), 'F450 AI 助教');
});

test('routes student chat and Eagle detection through the same RAG client with structured errors', async () => {
  const { createF450AssistantService } = loadClient();
  const questions = [];
  const service = createF450AssistantService({
    askRag: async (question) => {
      questions.push(question);
      return { answer: '依標準更換槳葉後重新檢測。', source_type: 'rag', version: 'f450_v1' };
    }
  });
  const detection = {
    task: 'f450_propeller_check',
    status: 'NG',
    errors: [
      { motor: 'M1', status: 'NG', error_code: 'WRONG_BLADE_DIRECTION', detected: 'CW', expected: 'CCW' },
      { motor: 'M4', status: 'NG', error_code: 'WRONG_BLADE_DIRECTION', detected: 'CCW', expected: 'CW' }
    ]
  };

  await service.askF450Assistant('槳葉方向怎麼看？', null, 'student_chat');
  const result = await service.askF450Assistant('', detection, 'eagle_detection');

  assert.equal(questions.length, 2);
  assert.equal(questions[0], '槳葉方向怎麼看？');
  assert.match(questions[1], /M1.*CW.*CCW/);
  assert.match(questions[1], /M4.*CCW.*CW/);
  assert.match(questions[1], /F450 知識庫/);
  assert.doesNotMatch(questions[1], /[CDE]:\\/i);
  assert.match(result.answer, /M1 檢測 CW，標準 CCW；M4 檢測 CCW，標準 CW/);
  assert.match(result.answer, /依標準更換槳葉後重新檢測/);
});

test('does not query RAG for a PASS inspection result', async () => {
  const { createF450AssistantService } = loadClient();
  let calls = 0;
  const service = createF450AssistantService({ askRag: async () => { calls += 1; } });

  const result = await service.askF450Assistant('', { task: 'f450_propeller_check', status: 'PASS', errors: [] }, 'eagle_detection');

  assert.deepEqual(result, { skipped: true });
  assert.equal(calls, 0);
});

test('keeps uncertain CHECK fields explicit instead of inventing blade direction', async () => {
  const { createF450AssistantService } = loadClient();
  let query = '';
  const service = createF450AssistantService({
    askRag: async (question) => {
      query = question;
      return { answer: '依馬達旋轉方向安裝。', source_type: 'rag', version: 'f450_v1' };
    }
  });

  const result = await service.askF450Assistant('', {
    task: 'f450_propeller_check', status: 'CHECK',
    errors: [{ motor: 'M2', status: 'CHECK', error_code: 'LOW_CONFIDENCE', detected: null, expected: 'CCW' }]
  }, 'eagle_detection');

  assert.match(query, /M2.*CHECK/);
  assert.match(query, /標準 CCW/);
  assert.doesNotMatch(query, /LOW_CONFIDENCE/);
  assert.doesNotMatch(query, /檢測 CW|檢測 CCW/);
  assert.match(result.answer, /M2 檢測方向未能確認，標準 CCW/);
});

test('connects F450 chat and Eagle correction to the same assistant service', () => {
  const app = readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fallbackHtml = readFileSync(path.join(__dirname, '..', '404.html'), 'utf8');

  assert.match(app, /assistantService\.askF450Assistant\(topic, null, 'student_chat'\)/);
  assert.match(app, /runVoiceAssistantQuestion\(topic\)/);
  assert.match(app, /assistantService\.askF450Assistant\('', inspectionAssistantContext\(result\), 'eagle_detection'\)/);
  assert.doesNotMatch(app, /runVoiceAssistantQuestion\(inspectionQuestion\(result\)\)/);
  assert.match(app, /finalResult\.status === 'PASS'/);
  assert.ok(html.indexOf('rag-config.js') < html.indexOf('rag-client.js'));
  assert.match(html, /document\.write\([\s\S]*rag-config\.js[\s\S]*Date\.now\(\)/);
  assert.ok(html.indexOf('rag-client.js') < html.indexOf('app.js?v=1.2-eagle-rag'));
  assert.doesNotMatch(html, /f450-rag\.js/);
  assert.ok(fallbackHtml.indexOf('rag-config.js') < fallbackHtml.indexOf('rag-client.js'));
  assert.match(fallbackHtml, /document\.write\([\s\S]*rag-config\.js[\s\S]*Date\.now\(\)/);
  assert.ok(fallbackHtml.indexOf('rag-client.js') < fallbackHtml.indexOf('app.js?v=1.2-eagle-rag'));
});

test('renders the RAG source label through the exported client helper', () => {
  const app = readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(app, /window\.FdeRagClient\.sourceLabel\(result\.source_type\)/);
  assert.doesNotMatch(app, /ragClient\.sourceLabel\(result\.source_type\)/);
});

test('frontend JavaScript contains no local absolute drive paths', () => {
  const files = ['platform.js', 'platform-browser.js', 'app.js', 'rag-client.js', 'rag-config.js'];
  for (const file of files) {
    const fullPath = path.join(__dirname, file);
    if (!existsSync(fullPath)) continue;
    assert.doesNotMatch(readFileSync(fullPath, 'utf8'), /\b[CDE]:\\/i, `${file} leaks a local drive path`);
  }
  for (const file of ['index.html', '404.html']) {
    assert.doesNotMatch(readFileSync(path.join(__dirname, '..', file), 'utf8'), /\b[CDE]:\\/i, `${file} leaks a local drive path`);
  }
});

test('keeps LOCAL RAG enabled without pinning an expiring public tunnel URL in source', () => {
  const config = readFileSync(path.join(__dirname, 'rag-config.js'), 'utf8');
  assert.match(config, /FDE_RAG_V1_ENABLED:\s*true/);
  assert.match(config, /RAG_API_BASE_URL:\s*'http:\/\/127\.0\.0\.1:8770'/);
  assert.match(config, /PUBLIC_RAG_API_URL:\s*''/);
});
