const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('./live.js');

// P1-4 guard：浏览器重载（pagehide）不得销毁 coach session 与持久化。
// 验收证据：2026-10-19 真实浏览器实测（agent-browser + removeItem 钩子）发现
// pagehide → stopCamera() → clearPersistedSession() + DELETE 会在每次刷新时
// 删除 localStorage 的 fde-live-coach-session 并删除旧 session，导致重载后
// 总是新建空白 session、训练进度（含 VISION_MODEL_NOT_READY）丢失。
const SESSION_STORAGE_KEY = 'fde-live-coach-session';

function el() {
  return {
    textContent: '', innerHTML: '', hidden: false, disabled: false, value: '', checked: false,
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, contains() { return false; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    focus() {}, blur() {}, play() { return Promise.resolve(); }, pause() {}, load() {},
  };
}

function makeDoc() {
  const cache = {};
  return {
    querySelector(sel) { if (!cache[sel]) cache[sel] = el(); return cache[sel]; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    createElement() { return el(); },
    body: el(), documentElement: el(),
  };
}

function makeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function trackingFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push([method, url]);
    for (const [pattern, h] of handlers) {
      if (pattern.test(url)) return h(url, init);
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

function makeController(storage, handlers) {
  const { fetchImpl, calls } = trackingFetch(handlers || []);
  const controller = live.createController({
    documentRef: makeDoc(),
    navigatorRef: { userAgent: 'node-test', mediaDevices: {} },
    fetchImpl,
    storage,
  });
  return { controller, calls };
}

const TRAINING_STATE = {
  current_task_id: 'TASK_08',
  current_training_step_id: 'T08_PROP_VISION',
  tasks: [],
  training_step_progress: {
    T08_PROP_VISION: { status: 'COMPLETED', check_status: 'VISION_MODEL_NOT_READY', facts: [] },
  },
  prop_vision_status: 'PENDING',
};

test('重载后复用持久化的 session：GET 旧会话成功即不新建', async () => {
  const storage = makeStorage({ [SESSION_STORAGE_KEY]: JSON.stringify({ id: 'sess-old', source: 'REAL_VISION' }) });
  const { controller, calls } = makeController(storage, [
    [/\/api\/live\/sessions\/sess-old$/, () => ({ ok: true, status: 200, json: async () => ({ session_id: 'sess-old', dev_mode: false, training: TRAINING_STATE }) })],
  ]);
  const sid = await controller.initializeStudentMode();
  assert.equal(sid, 'sess-old');
  assert.deepEqual(calls, [['GET', '/api/live/sessions/sess-old']]);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), JSON.stringify({ id: 'sess-old', source: 'REAL_VISION' }));
});

test('服务端已无会话（404）时才回退新建并更新持久化', async () => {
  const storage = makeStorage({ [SESSION_STORAGE_KEY]: JSON.stringify({ id: 'sess-old', source: 'REAL_VISION' }) });
  const { controller, calls } = makeController(storage, [
    [/\/api\/live\/sessions\/sess-old$/, () => ({ ok: false, status: 404, json: async () => ({ error: 'session_not_found' }) })],
    [/\/api\/live\/sessions$/, () => ({ ok: true, status: 201, json: async () => ({ session_id: 'sess-new', dev_mode: false }) })],
  ]);
  const sid = await controller.initializeStudentMode();
  assert.equal(sid, 'sess-new');
  assert.deepEqual(calls.map((c) => c[0]), ['GET', 'POST', 'GET']);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), JSON.stringify({ id: 'sess-new', source: 'REAL_VISION' }));
});

test('pagehide 路径（stopCameraStream）不删除持久化 session、不发 DELETE', async () => {
  const storage = makeStorage();
  const { controller, calls } = makeController(storage, [
    [/\/api\/live\/sessions$/, () => ({ ok: true, status: 201, json: async () => ({ session_id: 'sess-live', dev_mode: false }) })],
  ]);
  await controller.initializeStudentMode();
  assert.ok(storage.getItem(SESSION_STORAGE_KEY));
  calls.length = 0;
  controller.stopCameraStream();
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), JSON.stringify({ id: 'sess-live', source: 'REAL_VISION' }));
  assert.ok(!calls.some(([method]) => method === 'DELETE'), 'stopCameraStream must not DELETE the session');
});

test('用户显式停止（stopCamera）才释放 session：清除持久化并 DELETE', async () => {
  const storage = makeStorage();
  const { controller, calls } = makeController(storage, [
    [/\/api\/live\/sessions$/, () => ({ ok: true, status: 201, json: async () => ({ session_id: 'sess-live', dev_mode: false }) })],
  ]);
  await controller.initializeStudentMode();
  calls.length = 0;
  await controller.stopCamera();
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);
  assert.ok(calls.some(([method, url]) => method === 'DELETE' && url === '/api/live/sessions/sess-live'), 'stopCamera must DELETE the session');
});

test('持久化损坏 JSON 时回退新建而不是崩溃', async () => {
  const storage = makeStorage({ [SESSION_STORAGE_KEY]: '{not-json' });
  const { controller } = makeController(storage, [
    [/\/api\/live\/sessions$/, () => ({ ok: true, status: 201, json: async () => ({ session_id: 'sess-new', dev_mode: false }) })],
  ]);
  const sid = await controller.initializeStudentMode();
  assert.equal(sid, 'sess-new');
});
