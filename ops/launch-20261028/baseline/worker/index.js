const FIXED_HOST = "fde-ai-gateway.fde-ai-gateway.workers.dev";
const PUBLIC_HOME = "https://zhangpengya77-tech.github.io/fde-ai/";
const PLATFORM_ASSET_VERSION = "15b-platform-20260918";
const ORIGIN_HEALTH_TIMEOUT_MS = 2500;
const DYNAMIC_PREFIXES = [
  "/admin", "/accounts", "/activate", "/api", "/courses", "/evidence",
  "/login", "/logout", "/media", "/password-reset", "/register", "/reset",
  "/student", "/teacher"
];

const OFFLINE_HTML = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>FDE-AI | 教學主機離線</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: #e9f7ff; background: radial-gradient(circle at 50% 0%, #143a5a 0, #071321 48%, #030811 100%); }
      main { width: min(100%, 620px); padding: clamp(28px, 7vw, 56px); border: 1px solid rgba(75, 211, 255, .38); border-radius: 18px; background: rgba(7, 21, 37, .88); box-shadow: 0 24px 80px rgba(0, 0, 0, .36), inset 0 1px rgba(255,255,255,.06); }
      .brand { display: inline-flex; align-items: center; gap: 12px; color: #fff; font-size: 1.15rem; font-weight: 800; letter-spacing: .04em; }
      .mark { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid #47d8ff; color: #47d8ff; font-size: .72rem; }
      .eyebrow { margin: 34px 0 10px; color: #64e1ff; font-size: .78rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(1.8rem, 6vw, 3rem); line-height: 1.15; }
      p { color: #b7cad8; line-height: 1.8; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
      a { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; padding: 0 18px; border: 1px solid #49d7ff; border-radius: 8px; color: #03101b; background: #49d7ff; font-weight: 800; text-decoration: none; }
      a:focus-visible, a:hover { color: #fff; background: #127fa5; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark">FDE</span><span>FDE-AI<br><small>無人載具學習控制中心</small></span></div>
      <p class="eyebrow">公開瀏覽模式</p>
      <h1>教學主機目前未啟動</h1>
      <p>公開學習內容目前仍可正常瀏覽。</p>
      <p>學員登入、學習成長日誌、作品上傳、AI助教及教師後台，將在教學主機上線後自動恢復。</p>
      <div class="actions"><a href="${PUBLIC_HOME}">返回公開首頁</a></div>
    </main>
  </body>
</html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      "x-fde-gateway-mode": "offline"
    }
  });
}

function isDynamic(pathname) {
  return DYNAMIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isUnavailable(status) {
  return status >= 500;
}

function isWriteRequest(request) {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

function upstreamUnavailableResponse() {
  return new Response(JSON.stringify({ error: "classroom_upstream_unavailable" }), {
    status: 502,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      "x-fde-gateway-mode": "upstream-error"
    }
  });
}

async function originIsHealthy(fetchImpl, origin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORIGIN_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(new Request(`${origin}/`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    }));
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function stabilizePlatformHtml(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  html = html.replace(
    /((?:href|src)=['"])\.\/src\/([^?'\"]+)(?:\?[^'\"]*)?(['"])/gi,
    `$1/platform/src/$2?v=${PLATFORM_ASSET_VERSION}$3`
  );
  html = html.replace(
    /((?:href|src)=['"]\/static\/learning\/[^?'\"]+)(?:\?[^'\"]*)?(['"])/gi,
    `$1?v=${PLATFORM_ASSET_VERSION}$2`
  );

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function targetRequest(request, origin) {
  const incoming = new URL(request.url);
  const target = new URL(origin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  if (headers.has("origin")) headers.set("origin", origin);
  if (headers.has("referer")) headers.set("referer", `${origin}${incoming.pathname}${incoming.search}`);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", "https");
  return new Request(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    duplex: "half",
    redirect: "manual"
  });
}

function rewriteResponse(response, origin, fixedOrigin) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  const location = headers.get("location");
  if (location) {
    try {
      const rewritten = new URL(location, origin);
      const isLocalDjangoOrigin =
        ["127.0.0.1", "localhost"].includes(rewritten.hostname) &&
        (!rewritten.port || rewritten.port === "8022");
      if (rewritten.origin === origin || isLocalDjangoOrigin) {
        headers.set("location", `${fixedOrigin}${rewritten.pathname}${rewritten.search}${rewritten.hash}`);
      }
    } catch {
      // Keep non-URL Location values unchanged.
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function staticResponse(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const assetUrl = new URL(request.url);
  assetUrl.search = "";
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  const url = new URL(request.url);
  if (response.status !== 404 && !(response.status >= 300 && response.status < 400 && url.pathname.startsWith("/platform/"))) {
    return url.pathname.startsWith("/platform/") ? stabilizePlatformHtml(response) : response;
  }
  if (url.pathname === "/platform" || url.pathname === "/platform/" || url.pathname.startsWith("/platform/")) {
    const fallback = await env.ASSETS.fetch(new Request(new URL("/platform/", request.url), request));
    return stabilizePlatformHtml(fallback);
  }
  return null;
}

async function proxyResponse(request, env, fetchImpl, origin, fixedOrigin) {
  const requestId = request.headers.get("x-fde-video-request-id") || "";
  const startedAt = Date.now();
  if (requestId) {
    console.log(JSON.stringify({
      event: "VIDEO_UPLOAD_WORKER_START",
      request_id: requestId,
      method: request.method,
      pathname: new URL(request.url).pathname,
      content_type: request.headers.get("content-type") || "",
      content_length: request.headers.get("content-length") || "",
      started_at: new Date().toISOString()
    }));
  }
  try {
    let response = await fetchImpl(targetRequest(request, origin));
    if (requestId) {
      console.log(JSON.stringify({
        event: "VIDEO_UPLOAD_WORKER_ORIGIN_RESPONSE",
        request_id: requestId,
        status: response.status,
        duration_ms: Date.now() - startedAt
      }));
    }
    if (isUnavailable(response.status)) return null;
    const incoming = new URL(request.url);
    const contentType = response.headers.get("content-type") || "";
    if (incoming.pathname.startsWith("/platform/") && contentType.includes("text/html")) {
      response = await stabilizePlatformHtml(response);
    }
    if (incoming.pathname === "/platform/src/styles.css" && contentType.includes("text/css")) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      const css = await response.text();
      response = new Response(`${css}\n\n/* Gateway mobile inspection layout patch */\n@media (max-width: 768px) {\n  .motor-check-grid {\n    grid-template-columns: minmax(0, 1fr) !important;\n  }\n}\n`, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    return rewriteResponse(response, origin, fixedOrigin);
  } catch (error) {
    if (requestId) {
      console.log(JSON.stringify({
        event: "VIDEO_UPLOAD_WORKER_ORIGIN_ERROR",
        request_id: requestId,
        error_name: error?.name || "Error",
        error_message: String(error?.message || "origin fetch failed").slice(0, 500),
        duration_ms: Date.now() - startedAt
      }));
    }
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const fetchImpl = typeof ctx === "function" ? ctx : fetch;
    const incoming = new URL(request.url);
    const origin = String(env.ORIGIN_URL || "").replace(/\/+$/, "");
    const fixedOrigin = `https://${FIXED_HOST}`;
    const isPlatformPath = incoming.pathname === "/platform" || incoming.pathname.startsWith("/platform/");
    const isPublicHtmlPath = incoming.pathname === "/" || isPlatformPath;

    if (incoming.pathname === "/platform/tasks") {
      return Response.redirect(`${fixedOrigin}/platform/tasks/`, 308);
    }

    if (incoming.pathname === "/gateway-status") {
      const classroomServer = Boolean(origin && await originIsHealthy(fetchImpl, origin));
      return new Response(JSON.stringify({ gateway: "online", classroom_server: classroomServer }), {
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" }
      });
    }

    const needsOrigin =
      isDynamic(incoming.pathname) ||
      isPublicHtmlPath ||
      incoming.pathname.startsWith("/static/");
    // Do not probe the origin before a write request. A health GET can time
    // out while the actual streamed multipart request would still succeed.
    // More importantly, probing must never consume or replace the upload body.
    const originOnline = Boolean(
      needsOrigin &&
      origin &&
      (isWriteRequest(request) || await originIsHealthy(fetchImpl, origin))
    );

    // Keep the live platform page online so Django can issue its CSRF cookie;
    // use the static snapshot for the same public paths when the Dell is down.
    if (!originOnline && !isDynamic(incoming.pathname)) {
      try {
        const response = await staticResponse(request, env);
        if (response) {
          const headers = new Headers(response.headers);
          headers.set("cache-control", isPlatformPath ? "no-store" : incoming.pathname.includes(".") ? "public, max-age=300" : "no-cache");
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }
      } catch {
        // Fall through to the offline response.
      }
    }

    if (!originOnline) {
      if (isWriteRequest(request)) return upstreamUnavailableResponse();
      if (isPublicHtmlPath) {
        try {
          const response = await staticResponse(request, env);
          if (response) return response;
        } catch {
          // Use the standard unavailable response below.
        }
      }
      return offlineResponse();
    }

    const proxied = await proxyResponse(request, env, fetchImpl, origin, fixedOrigin);
    // Public pages must remain readable when a stale tunnel only returns a
    // redirect or another non-success response after the classroom host is down.
    if (proxied && (!isPublicHtmlPath || (proxied.status >= 200 && proxied.status < 300))) return proxied;
    if (isWriteRequest(request)) return upstreamUnavailableResponse();
    if (isPublicHtmlPath) {
      try {
        const response = await staticResponse(request, env);
        if (response) return response;
      } catch {
        // Use the standard unavailable response below.
      }
    }
    return offlineResponse();
  }
};
