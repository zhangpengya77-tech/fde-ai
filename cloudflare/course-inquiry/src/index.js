// FDE-AI 課程報名諮詢 Worker（V4.1，方案 A：Cloudflare 雲端）
// - POST /api/inquiry：官網表單送出（只接受官網來源；隱藏欄位、填寫時間、限流、選用 Turnstile 防機器人）
// - GET  /admin：報名紀錄後台（必須經 Cloudflare Access 登入，且 Email 在 ADMIN_EMAILS 白名單內）
// - POST /admin/update：更新處理狀態與備註（同源檢查＋Access）
// - 每日排程：刪除超過保存期限（預設 180 天）的資料
// 報名資料只存在 D1（binding：DB），與學員資料庫完全分開；不依賴教師電腦。

export const DEFAULT_ORIGIN = 'https://zhangpengya77-tech.github.io';
// 與官網 public-site/v2/src/data/vocational-programs.js 的 id／title 一致（測試會比對）
export const COURSES = {
  license: '無人機證照考取專班',
  seed: 'FDE-AI 無人載具種子教師專案',
  pilot: '專業無人機職業飛手專案',
  rd: '無人載具軟硬體研發工程師專案',
  mro: '無人載具裝調檢修與測試工程師專案',
};
export const FORMATS = ['周末班', '常日班', '都可以／未定'];
export const STATUSES = { new: '新進', contacted: '已聯絡', done: '已完成', closed: '不處理' };
const MIN_FILL_MS = 3000;
const IP_LIMIT_PER_HOUR = 5;
const DAILY_LIMIT = 200;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

function allowedOrigin(env) {
  return (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  return origin === allowedOrigin(env)
    ? { 'access-control-allow-origin': origin, vary: 'origin' }
    : {};
}

export function validate(fields) {
  const get = (k, max) => String(fields[k] ?? '').trim().slice(0, max);
  const data = {
    name: get('name', 30),
    email: get('email', 80),
    contact: get('contact', 40),
    course: get('course', 20),
    format: get('format', 20),
    message: get('message', 500),
    is_minor: fields.minor ? 1 : 0,
    guardian_consent: fields.guardian_consent ? 1 : 0,
  };
  const errors = [];
  if (!data.name) errors.push('請填寫姓名');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.push('Email 格式不正確');
  if (data.contact && !(/^09\d{2}-?\d{3}-?\d{3}$/.test(data.contact.replace(/\s/g, '')) || /^[A-Za-z0-9._-]{4,20}$/.test(data.contact))) {
    errors.push('電話請填 09 開頭的手機號碼，LINE ID 為 4～20 個英數字');
  }
  if (!data.email && !data.contact) errors.push('Email 與電話／LINE ID 至少填一項');
  if (!COURSES[data.course]) errors.push('請選擇課程');
  if (data.format && !FORMATS.includes(data.format)) errors.push('班別不正確');
  if (data.is_minor && !data.guardian_consent) errors.push('未滿 18 歲需要法定代理人同意');
  if (!fields.consent) errors.push('請勾選同意個資告知');
  return { data, errors };
}

async function readForm(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function hashIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(env, token, ip, fetchImpl) {
  if (!env.TURNSTILE_SECRET) return true;   // 未設定時略過（仍有隱藏欄位、填寫時間與限流）
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const result = await r.json().catch(() => ({}));
  return result.success === true;
}

async function notify(env, id) {
  // 通知信只說「有新諮詢」與後台連結，不把個資寫進信件內容（減少個資外流）。
  if (!env.NOTIFY || !env.NOTIFY_FROM || !env.NOTIFY_TO) return;
  const { EmailMessage } = await import('cloudflare:email');
  const raw = [
    `From: FDE-AI <${env.NOTIFY_FROM}>`,
    `To: ${env.NOTIFY_TO}`,
    'Subject: =?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode('FDE-AI 有一筆新的課程諮詢'))) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    `有一筆新的課程諮詢（編號 ${id}）。請登入後台查看：${env.ADMIN_URL || '/admin'}`,
  ].join('\r\n');
  await env.NOTIFY.send(new EmailMessage(env.NOTIFY_FROM, env.NOTIFY_TO, raw));
}

export async function handleInquiry(request, env, ctx, { now = () => new Date(), fetchImpl = fetch } = {}) {
  const headers = cors(request, env);
  if (!headers['access-control-allow-origin']) return json({ ok: false, error: '來源網站不允許' }, 403);
  let fields;
  try {
    fields = await readForm(request);
  } catch (e) {
    return json({ ok: false, error: '表單格式錯誤' }, 400, headers);
  }
  if (fields.website) return json({ ok: true }, 200, headers);   // 機器人陷阱：假裝成功、不存資料
  const started = Number(fields.started_ms);
  if (!Number.isFinite(started) || now().getTime() - started < MIN_FILL_MS) {
    return json({ ok: false, error: '送出太快，請稍候再試' }, 400, headers);
  }
  const { data, errors } = validate(fields);
  if (errors.length) return json({ ok: false, error: errors.join('；') }, 400, headers);
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  if (!(await verifyTurnstile(env, fields['cf-turnstile-response'], ip, fetchImpl))) {
    return json({ ok: false, error: '機器人驗證失敗，請重新整理後再試' }, 400, headers);
  }
  const at = now().toISOString();
  const hourAgo = new Date(now().getTime() - 3600_000).toISOString();
  const dayAgo = new Date(now().getTime() - 86400_000).toISOString();
  const ipHash = await hashIp(ip, env.IP_SALT || 'fde-ai');
  const ipHits = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE ip_hash = ? AND at > ?').bind(ipHash, hourAgo).first();
  const dayCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM inquiries WHERE created_at > ?').bind(dayAgo).first();
  if ((ipHits?.n ?? 0) >= IP_LIMIT_PER_HOUR || (dayCount?.n ?? 0) >= DAILY_LIMIT) {
    return json({ ok: false, error: '送出次數過多，請稍後再試或直接來電' }, 429, headers);
  }
  await env.DB.prepare('INSERT INTO rate_hits (ip_hash, at) VALUES (?, ?)').bind(ipHash, at).run();
  const result = await env.DB.prepare(
    `INSERT INTO inquiries (created_at, name, email, contact, course, format, message, is_minor, guardian_consent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(at, data.name, data.email, data.contact, data.course, data.format, data.message, data.is_minor, data.guardian_consent, at).run();
  const id = result.meta?.last_row_id;
  if (ctx && ctx.waitUntil) ctx.waitUntil(notify(env, id).catch(() => {}));
  return json({ ok: true }, 200, headers);
}

// ---- Cloudflare Access 驗證（後台） ----

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

export async function verifyAccess(request, env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = b64urlToJson(h);
  const payload = b64urlToJson(p);
  const certs = await (await fetchImpl(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)).json();
  const jwk = (certs.keys || []).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!payload.exp || payload.exp * 1000 < now()) return null;
  const email = String(payload.email || '').toLowerCase();
  const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return admins.includes(email) ? email : null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function audit(env, actor, action, inquiryId, detail, at) {
  await env.DB.prepare('INSERT INTO audit_log (at, actor, action, inquiry_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(at, actor, action, inquiryId, detail).run();
}

const ADMIN_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

export async function adminPage(env, actor, at) {
  const { results } = await env.DB.prepare('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 200').all();
  await audit(env, actor, 'view', null, `${results.length} 筆`, at);
  const rows = results.map((r) => `<tr>
    <td>${r.id}</td><td>${esc(r.created_at.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.name)}</td>
    <td>${esc(r.email)}<br>${esc(r.contact)}</td><td>${esc(COURSES[r.course] || r.course)}<br>${esc(r.format)}</td>
    <td>${esc(r.message)}</td><td>${r.is_minor ? `未成年${r.guardian_consent ? '（代理人已同意）' : ''}` : ''}</td>
    <td><form method="post" action="/admin/update"><input type="hidden" name="id" value="${r.id}">
      <select name="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <input name="note" value="${esc(r.note)}" maxlength="200" placeholder="備註"><button>儲存</button></form></td></tr>`).join('');
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FDE-AI 課程諮詢後台</title><style>body{font-family:system-ui,"Microsoft JhengHei",sans-serif;margin:16px;color:#13243a}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #c9d6e3;padding:6px;vertical-align:top}th{background:#edf7ff}</style></head>
<body><h1>FDE-AI 課程諮詢後台</h1><p>登入者：${esc(actor)}。資料保存 ${Number(env.RETENTION_DAYS || 180)} 天後自動刪除；每次查看與修改都會記錄。</p>
<table><thead><tr><th>#</th><th>時間（UTC）</th><th>姓名</th><th>聯絡方式</th><th>課程／班別</th><th>備註</th><th>未成年</th><th>處理狀態</th></tr></thead><tbody>${rows || '<tr><td colspan="8">目前沒有資料</td></tr>'}</tbody></table></body></html>`,
  { headers: ADMIN_HEADERS });
}

export async function adminUpdate(request, env, actor, at) {
  const self = new URL(request.url).origin;
  if (request.headers.get('origin') !== self) return new Response('來源不允許', { status: 403 });
  const form = Object.fromEntries((await request.formData()).entries());
  const id = Number(form.id);
  if (!Number.isInteger(id) || !STATUSES[form.status]) return new Response('資料錯誤', { status: 400 });
  const note = String(form.note || '').slice(0, 200);
  await env.DB.prepare('UPDATE inquiries SET status = ?, note = ?, updated_at = ? WHERE id = ?').bind(form.status, note, at, id).run();
  await audit(env, actor, 'update', id, `status=${form.status}`, at);
  return Response.redirect(`${self}/admin`, 303);
}

export async function purgeExpired(env, now = new Date()) {
  const days = Number(env.RETENTION_DAYS || 180);
  const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
  const r = await env.DB.prepare('DELETE FROM inquiries WHERE created_at < ?').bind(cutoff).run();
  await env.DB.prepare('DELETE FROM rate_hits WHERE at < ?').bind(new Date(now.getTime() - 86400_000).toISOString()).run();
  await audit(env, 'system', 'purge', null, `deleted=${r.meta?.changes ?? 0}`, now.toISOString());
  return r.meta?.changes ?? 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/inquiry') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...cors(request, env), 'access-control-allow-methods': 'POST', 'access-control-max-age': '600' } });
      }
      if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
      return handleInquiry(request, env, ctx);
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/update') {
      const actor = await verifyAccess(request, env).catch(() => null);
      if (!actor) return new Response('需要登入（Cloudflare Access）', { status: 403 });
      const at = new Date().toISOString();
      if (url.pathname === '/admin' && request.method === 'GET') return adminPage(env, actor, at);
      if (url.pathname === '/admin/update' && request.method === 'POST') return adminUpdate(request, env, actor, at);
      return new Response('method not allowed', { status: 405 });
    }
    return new Response('not found', { status: 404 });
  },
  async scheduled(event, env) {
    await purgeExpired(env);
  },
};
