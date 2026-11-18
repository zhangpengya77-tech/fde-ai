// 執行：node --test cloudflare/course-inquiry/test/
// D1 以 Node 內建 SQLite 模擬（同一份 schema.sql），測試真正的 SQL。
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import worker, { COURSES, adminUpdate, handleInquiry, purgeExpired, validate, verifyAccess } from '../src/index.js';

const ORIGIN = 'https://zhangpengya77-tech.github.io';
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const stmt = db.prepare(sql);
      return {
        bind(...a) { args = a; return this; },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
        async run() { const r = stmt.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
    },
  };
}

const NOW = new Date('2026-11-18T08:00:00Z');
const goodFields = (over = {}) => ({
  name: '測試學員', email: 'student@example.com', contact: '', course: 'license', format: '周末班', message: '想問開班時間',
  consent: 'on', started_ms: String(NOW.getTime() - 10_000), ...over,
});

function formRequest(fields, { origin = ORIGIN, ip = '203.0.113.5' } = {}) {
  return new Request('https://inquiry.example.workers.dev/api/inquiry', {
    method: 'POST',
    headers: { origin, 'cf-connecting-ip': ip, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

const submit = (env, fields, opts) => handleInquiry(formRequest(fields, opts), env, null, { now: () => NOW });

test('course ids and titles match the public site data', () => {
  const src = readFileSync(new URL('../../../public-site/v2/src/data/vocational-programs.js', import.meta.url), 'utf8');
  const found = Object.fromEntries([...src.matchAll(/id: '([a-z]+)', slug: '[^']+', order: \d,[\s\S]*?title: '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(found, COURSES);
});

test('valid inquiry is stored with only the necessary fields', async () => {
  const env = { DB: fakeD1() };
  const r = await submit(env, goodFields());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const rows = env.DB.raw.prepare('SELECT * FROM inquiries').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '測試學員');
  assert.equal(rows[0].status, 'new');
  const hits = env.DB.raw.prepare('SELECT * FROM rate_hits').all();
  assert.ok(!JSON.stringify(hits).includes('203.0.113.5'), 'IP is stored only as a salted hash');
});

test('validation rules match the website form', () => {
  assert.deepEqual(validate(goodFields()).errors, []);
  assert.ok(validate(goodFields({ email: '', contact: '' })).errors.some((e) => e.includes('至少填一項')));
  assert.deepEqual(validate(goodFields({ email: '', contact: 'fde_ai.line' })).errors, []);
  assert.deepEqual(validate(goodFields({ email: '', contact: '0901-189-740' })).errors, []);
  assert.ok(validate(goodFields({ minor: 'on' })).errors.some((e) => e.includes('法定代理人')));
  assert.deepEqual(validate(goodFields({ minor: 'on', guardian_consent: 'on' })).errors, []);
  assert.ok(validate(goodFields({ consent: '' })).errors.length);
  assert.ok(validate(goodFields({ course: 'hack' })).errors.length);
  assert.ok(validate(goodFields({ format: '<script>' })).errors.length);
});

test('rejects other origins, bots and too-fast submissions without storing', async () => {
  const env = { DB: fakeD1() };
  assert.equal((await submit(env, goodFields(), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await submit(env, goodFields({ website: 'spam' }))).status, 200);   // 機器人陷阱：假成功
  assert.equal((await submit(env, goodFields({ started_ms: String(NOW.getTime() - 500) }))).status, 400);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n, 0);
});

test('rate limit: 5 per IP per hour', async () => {
  const env = { DB: fakeD1() };
  for (let i = 0; i < 5; i += 1) assert.equal((await submit(env, goodFields())).status, 200);
  assert.equal((await submit(env, goodFields())).status, 429);
  assert.equal((await submit(env, goodFields(), { ip: '198.51.100.9' })).status, 200);
});

test('turnstile is enforced when configured', async () => {
  const env = { DB: fakeD1(), TURNSTILE_SECRET: 'secret' };
  const fetchImpl = async (url, init) => new Response(JSON.stringify({ success: init.body.get('response') === 'good' }));
  const r1 = await handleInquiry(formRequest(goodFields()), env, null, { now: () => NOW, fetchImpl });
  assert.equal(r1.status, 400);
  const r2 = await handleInquiry(formRequest(goodFields({ 'cf-turnstile-response': 'good' })), env, null, { now: () => NOW, fetchImpl });
  assert.equal(r2.status, 200);
});

test('records older than the retention period are purged', async () => {
  const env = { DB: fakeD1(), RETENTION_DAYS: '180' };
  const old = new Date(NOW.getTime() - 181 * 86400_000).toISOString();
  env.DB.raw.prepare(`INSERT INTO inquiries (created_at, name, course, updated_at) VALUES (?, 'old', 'license', ?)`).run(old, old);
  await submit(env, goodFields());
  assert.equal(await purgeExpired(env, NOW), 1);
  assert.deepEqual(env.DB.raw.prepare('SELECT name FROM inquiries').all().map((r) => r.name), ['測試學員']);
  assert.equal(env.DB.raw.prepare("SELECT action FROM audit_log").get().action, 'purge');
});

// ---- 後台：Cloudflare Access ----

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const ACCESS = { ACCESS_TEAM_DOMAIN: 'fde.cloudflareaccess.com', ACCESS_AUD: 'aud-123', ADMIN_EMAILS: 'zhangpengya77@gmail.com' };
const b64url = (b) => Buffer.from(b).toString('base64url');
function token(payload, key = privateKey) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64url(JSON.stringify(payload));
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key);
  return `${h}.${p}.${b64url(s)}`;
}
const certsFetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
const claims = (over = {}) => ({ aud: ['aud-123'], iss: 'https://fde.cloudflareaccess.com', email: 'zhangpengya77@gmail.com', exp: Math.floor(Date.now() / 1000) + 600, ...over });
const adminReq = (t, path = '/admin', init = {}) => new Request(`https://inquiry.example.workers.dev${path}`, { ...init, headers: { 'cf-access-jwt-assertion': t, ...(init.headers || {}) } });

test('admin requires a valid Access token from an allowed email', async () => {
  const ok = await verifyAccess(adminReq(token(claims())), ACCESS, { fetchImpl: certsFetch });
  assert.equal(ok, 'zhangpengya77@gmail.com');
  for (const bad of [
    token(claims({ email: 'someone@example.com' })),
    token(claims({ aud: ['other'] })),
    token(claims({ exp: 1 })),
    token(claims({ iss: 'https://evil.cloudflareaccess.com' })),
    token(claims(), generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey),
    'not-a-token',
  ]) {
    assert.equal(await verifyAccess(adminReq(bad), ACCESS, { fetchImpl: certsFetch }).catch(() => null), null);
  }
  const res = await worker.fetch(adminReq('none'), { DB: fakeD1(), ...ACCESS });
  assert.equal(res.status, 403);
});

test('admin update needs same origin and is written to the audit log', async () => {
  const env = { DB: fakeD1(), ...ACCESS };
  await submit(env, goodFields());
  const body = new URLSearchParams({ id: '1', status: 'contacted', note: '已電話聯絡' });
  const cross = await adminUpdate(adminReq('t', '/admin/update', { method: 'POST', body, headers: { origin: 'https://evil.example' } }), env, 'zhangpengya77@gmail.com', NOW.toISOString());
  assert.equal(cross.status, 403);
  const same = await adminUpdate(adminReq('t', '/admin/update', { method: 'POST', body: new URLSearchParams({ id: '1', status: 'contacted', note: '已電話聯絡' }), headers: { origin: 'https://inquiry.example.workers.dev' } }), env, 'zhangpengya77@gmail.com', NOW.toISOString());
  assert.equal(same.status, 303);
  assert.equal(env.DB.raw.prepare('SELECT status FROM inquiries WHERE id = 1').get().status, 'contacted');
  assert.deepEqual({ ...env.DB.raw.prepare('SELECT actor, action FROM audit_log').get() }, { actor: 'zhangpengya77@gmail.com', action: 'update' });
});
