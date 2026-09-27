function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store'
    }
  });
}

function offlineHealth() {
  return jsonResponse({
    status: 'offline',
    components: { live_backend: 'offline', vision: 'unknown' }
  });
}

function unavailable() {
  return jsonResponse({ error: { code: 'live_backend_offline', message: 'Live Backend is currently unavailable.' } }, 503);
}

function isLivePath(pathname) {
  return pathname === '/live' || pathname.startsWith('/live/') || pathname.startsWith('/api/live/');
}

async function handler(request, env, context = {}) {
  const incoming = new URL(request.url);
  if (!isLivePath(incoming.pathname)) {
    return jsonResponse({ error: { code: 'not_found', message: 'Development Live route only.' } }, 404);
  }

  const liveOrigin = String(env.LIVE_ORIGIN_URL || '').replace(/\/+$/, '');
  if (!liveOrigin) {
    return incoming.pathname === '/api/live/health' ? offlineHealth() : unavailable();
  }

  const target = new URL(liveOrigin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const init = {
    method: request.method,
    headers,
    redirect: 'manual'
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
    init.duplex = 'half';
  }

  const fetchImpl = context.fetch || fetch;
  try {
    const response = await fetchImpl(new Request(target, init));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('cache-control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch {
    return incoming.pathname === '/api/live/health' ? offlineHealth() : unavailable();
  }
}

export default { fetch: handler };
export { handler, isLivePath };
