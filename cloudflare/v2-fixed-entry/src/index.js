// =============================================================================
// FDE-AI 2.0 固定入口 Worker（2026-11-06，比照 V1.5C 的 fde-ai-gateway 做法）
//
// 為什麼需要：教師電腦用的是 Cloudflare「快速通道（Quick Tunnel）」，每次開機網址都會變。
// 這支 Worker 提供一個「永遠不變」的網址，收到的請求一律轉送到目前的通道網址。
//   - 目前通道網址存在 Worker 的祕密設定 ORIGIN_URL（開機時由教師電腦的排程自動更新）
//   - GitHub 頁面只要記這個固定網址，以後不用每次重開機都重新推送
//   - 主機關機（通道連不到）時，回一頁「教學主機離線」說明，並引導回 GitHub 頁面看公開課程
// 不保存任何帳號、密碼、Cookie；Cookie 由瀏覽器與 Django 直接往來（Worker 只轉送）。
// =============================================================================

export const PAGES_HOME = "https://zhangpengya77-tech.github.io/fde-ai/v2/";
export const PAGES_ORIGIN = "https://zhangpengya77-tech.github.io";
const HEALTH_TIMEOUT_MS = 4000;

// 主機離線時顯示的說明頁（繁體中文，手機可讀）
const OFFLINE_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FDE-AI｜教學主機離線</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06111f;color:#e6f6ff;font-family:system-ui,"Microsoft JhengHei","PingFang TC",sans-serif}
  main{max-width:480px;margin:24px;padding:28px;border:1px solid #1fb8ff55;border-radius:16px;background:#0b1b2e}
  h1{margin:0 0 12px;font-size:22px;color:#36d6ff}
  p{line-height:1.8;color:#b8d4e6}
  a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#0aa6ff;color:#001428;font-weight:700;text-decoration:none}
</style>
</head>
<body><main>
<h1>教學主機目前離線</h1>
<p>教師電腦尚未開機，所以註冊、登入、上傳與 AI 檢測暫停使用。<br>你可以先到公開網站瀏覽公開課程、關於我們與介紹影片；主機開機後這個網址會自動恢復。</p>
<a href="${PAGES_HOME}">前往 FDE-AI 公開網站</a>
</main></body>
</html>`;

// 允許 GitHub 頁面讀取狀態（只有狀態端點開放跨網站讀取，其他路徑不開放）
function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  return origin === PAGES_ORIGIN
    ? { "access-control-allow-origin": PAGES_ORIGIN, "vary": "origin" }
    : {};
}

function offlineResponse(request) {
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (request.method === "GET" && wantsHtml) {
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store", "retry-after": "60", "x-fde-gateway": "offline" }
    });
  }
  return new Response(JSON.stringify({ error: "classroom_host_offline" }), {
    status: 503,
    headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store", "x-fde-gateway": "offline" }
  });
}

// 通道已失效時 Cloudflare 會回 530（找不到通道）或 521～523（連不到主機）；視為主機離線
// 502／503／504 可能是 Django 自己回的，原樣轉給使用者，不誤判成關機
function isTunnelDown(status) {
  return status === 530 || (status >= 521 && status <= 523);
}

// 把請求改寫成送往目前通道網址（保留方法、內容與 Cookie）
export function targetRequest(request, origin) {
  const incoming = new URL(request.url);
  const target = new URL(origin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  // Django 的 CSRF（跨站請求偽造防護）會比對 Origin／Referer，改成通道網址才會通過
  if (headers.has("origin")) headers.set("origin", origin);
  if (headers.has("referer")) {
    try {
      const ref = new URL(headers.get("referer"));
      if (ref.host === incoming.host) headers.set("referer", `${origin}${ref.pathname}${ref.search}`);
    } catch { /* 保留原值 */ }
  }
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", "https");
  const hasBody = !["GET", "HEAD"].includes(request.method);
  return new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual"
  });
}

// 回應裡若有轉址（Location）指向通道網址或本機，改回固定網址，避免使用者跳到會變的網址
export function rewriteResponse(response, origin, fixedOrigin) {
  const location = response.headers.get("location");
  if (!location) return response;
  const headers = new Headers(response.headers);
  try {
    const url = new URL(location, origin);
    const local = ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.origin === origin || local) headers.set("location", `${fixedOrigin}${url.pathname}${url.search}${url.hash}`);
  } catch { /* 非網址格式就不改 */ }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function originIsHealthy(fetchImpl, origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(new Request(`${origin}/static/admin/img/icon-addlink.svg`, { redirect: "manual", signal: controller.signal }));
    return r.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env, _ctx, fetchImpl = fetch) {
    const incoming = new URL(request.url);
    const origin = String(env.ORIGIN_URL || "").trim().replace(/\/+$/, "");
    const fixedOrigin = incoming.origin;

    // 匿名狀態端點（比照 V1.5C 的 /gateway-status）：GitHub 頁面可用來判斷主機在不在線
    if (incoming.pathname === "/gateway-status") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders(request), "access-control-allow-methods": "GET" } });
      const online = Boolean(origin && await originIsHealthy(fetchImpl, origin));
      return new Response(JSON.stringify({ gateway: "online", status: online ? "online" : "offline", classroom_server: online }), {
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store", ...corsHeaders(request) }
      });
    }

    if (!origin) return offlineResponse(request);
    try {
      const response = await fetchImpl(targetRequest(request, origin));
      // 通道本身掛了（Cloudflare 回 530／52x，不是 Django 回的錯誤）→ 顯示離線說明
      if (isTunnelDown(response.status)) return offlineResponse(request);
      return rewriteResponse(response, origin, fixedOrigin);
    } catch {
      return offlineResponse(request);
    }
  }
};
