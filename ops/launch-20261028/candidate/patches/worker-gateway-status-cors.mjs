/**
 * Worker /gateway-status CORS 補丁（候選，未部署）
 *
 * 問題：現行 Worker 的 /gateway-status 回 200 JSON，但沒有 Access-Control-Allow-Origin，
 *       靜態站（github.io）跨網域讀取會被瀏覽器攔截 → 前端只能降級為「無法確認」。
 *       2026-10-28 實測（curl 帶 Origin 標頭）確認回應不含任何 access-control-* 標頭。
 *
 * 原則：
 *   1. 只對明確白名單來源放行，不用 "*"。
 *   2. 只放行 GET/HEAD/OPTIONS，不引入任何寫入能力。
 *   3. 回應內容維持最小：只回 gateway / classroom_server（+ 可選 vision.available），
 *      不含 origin URL、版本、PID、模型名稱、路徑。
 *   4. 保留 cache-control: no-store 與 Vary: Origin。
 *
 * 套用位置：src/index.js 的 fetch() 內，`if (incoming.pathname === "/gateway-status")` 區塊。
 */

const PUBLIC_SITE_ORIGINS = [
  "https://zhangpengya77-tech.github.io"
];

function corsHeadersFor(request) {
  const origin = request.headers.get("Origin") || "";
  if (!PUBLIC_SITE_ORIGINS.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "accept",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

// ── 替換後的 /gateway-status 區塊 ──────────────────────────────────────────────
//
// if (incoming.pathname === "/gateway-status") {
//   const cors = corsHeadersFor(request);
//   if (!cors) {
//     // 非白名單來源：不提供可讀 JSON，避免被任意站台當成探測器。
//     return new Response("forbidden", { status: 403, headers: { "cache-control": "no-store" } });
//   }
//   if (request.method === "OPTIONS") {
//     return new Response(null, { status: 204, headers: { ...cors, "cache-control": "no-store" } });
//   }
//   if (request.method !== "GET" && request.method !== "HEAD") {
//     return new Response("method not allowed", {
//       status: 405,
//       headers: { ...cors, allow: "GET, HEAD, OPTIONS", "cache-control": "no-store" }
//     });
//   }
//   const classroomServer = Boolean(origin && await originIsHealthy(fetchImpl, origin));
//   return new Response(
//     JSON.stringify({ gateway: "online", classroom_server: classroomServer }),
//     {
//       status: 200,
//       headers: { ...cors, "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" }
//     }
//   );
// }

export { PUBLIC_SITE_ORIGINS, corsHeadersFor };
