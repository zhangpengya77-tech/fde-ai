const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'static', 'learning', 'public-platform.js');
const ragConfigPath = path.join(__dirname, '..', '..', '..', 'src', 'rag-config.js');
const publicRagConfigPath = path.join(__dirname, '..', 'static', 'learning', 'public-rag-config.js');
const ragClientPath = path.join(__dirname, '..', '..', '..', 'src', 'rag-client.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const ragConfigSource = fs.readFileSync(ragConfigPath, 'utf8');
const publicRagConfigSource = fs.readFileSync(publicRagConfigPath, 'utf8');
const ragClientSource = fs.readFileSync(ragClientPath, 'utf8');
const calls = [];
const context = {
  FdePlatform: { hero: { actions: [] } },
  location: { origin: 'https://fde.example.test', href: 'https://fde.example.test/', protocol: 'https:' },
  fetch: async (...args) => {
    calls.push(args);
    return {
      ok: true,
      json: async () => ({ answer: '從同源服務返回', source_type: 'rag', version: 'test' })
    };
  },
  document: {
    cookie: 'csrftoken=csrf-test-token',
    getElementById: (id) => id === 'fde-public-context'
      ? { textContent: '{"role":"anonymous","growthUrl":"/student/growth/"}' }
      : null,
    addEventListener: () => {}
  },
  Headers,
  Request,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  console
};
context.window = context;

vm.runInNewContext(source, context, { filename: scriptPath });
vm.runInNewContext(ragConfigSource, context, { filename: ragConfigPath });
vm.runInNewContext(publicRagConfigSource, context, { filename: publicRagConfigPath });
vm.runInNewContext(ragClientSource, context, { filename: ragClientPath });

assert.equal(context.FdePlatform.hero.actions[0].label, '我的學習成長日誌');
assert.equal(context.FdePlatform.hero.actions[0].target, '/student/growth/');
assert.equal(context.FdeRagConfig.RAG_API_MODE, 'public');
assert.equal(context.FdeRagConfig.PUBLIC_RAG_API_URL, 'https://fde.example.test');

const localConfigContext = {
  window: {
    location: { origin: 'http://127.0.0.1:8025', protocol: 'http:', hostname: '127.0.0.1' },
    FdeRagConfig: { RAG_API_BASE_URL: 'http://127.0.0.1:8770' }
  }
};
vm.runInNewContext(publicRagConfigSource, localConfigContext, { filename: publicRagConfigPath });
assert.equal(localConfigContext.window.FdeRagConfig.RAG_API_MODE, 'local');
assert.equal(localConfigContext.window.FdeRagConfig.RAG_API_BASE_URL, 'http://127.0.0.1:8025');

context.fetch('http://127.0.0.1:8770/api/rag/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  body: '{"question":"檢查槳葉"}'
});
context.fetch('https://fde.example.test/api/rag/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  body: '{"question":"飛控校準"}'
});

(async () => {
  const rag = context.FdeRagClient.createRagClient(context.FdeRagConfig, context.fetch, context.location);
  const answer = await rag.askRag('飛控校準');

  assert.equal(calls[0][0], '/api/public/rag/ask/');
  assert.equal(calls[0][1].headers.get('X-CSRFToken'), 'csrf-test-token');
  assert.equal(calls[1][0], '/api/public/rag/ask/');
  assert.equal(calls[2][0], '/api/public/rag/ask/');
  assert.equal(answer.answer, '從同源服務返回');
  await context.fetch('http://127.0.0.1:8765/api/voice/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"question":"飛控方向","locale":"zh-TW"}'
  });
  assert.equal(calls[3][0], '/api/public/voice/ask/');
  await context.fetch(new Request('https://fde.example.test/api/rag/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: '{"question":"Request object"}'
  }));
  assert.equal(calls[4][0].url, 'https://fde.example.test/api/public/rag/ask/');
  assert.equal(calls[4][0].method, 'POST');
  assert.equal(await calls[4][0].text(), '{"question":"Request object"}');
  assert.equal(calls[4][1].headers.get('X-CSRFToken'), 'csrf-test-token');
  console.log('public-platform.js behavior passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
