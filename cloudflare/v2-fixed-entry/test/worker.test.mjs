// FDE-AI 2.0 固定入口 Worker 單元測試（用假的 fetch，不連網）
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const ORIGIN = "https://old-tunnel.trycloudflare.com";
const FIXED = "https://fde-ai-v2.fde-ai-gateway.workers.dev";
const env = { ORIGIN_URL: ORIGIN };

test("請求轉送到目前通道網址，保留路徑、方法、Cookie，並改寫 Origin", async () => {
  let seen;
  const fake = async (req) => { seen = req; return new Response("ok", { status: 200 }); };
  const req = new Request(`${FIXED}/register/?a=1`, { method: "POST", body: "x=1", headers: { cookie: "csrftoken=t", origin: FIXED, referer: `${FIXED}/register/` } });
  const res = await worker.fetch(req, env, {}, fake);
  assert.equal(res.status, 200);
  assert.equal(seen.url, `${ORIGIN}/register/?a=1`);
  assert.equal(seen.method, "POST");
  assert.equal(seen.headers.get("cookie"), "csrftoken=t");
  assert.equal(seen.headers.get("origin"), ORIGIN);
  assert.equal(seen.headers.get("referer"), `${ORIGIN}/register/`);
  assert.equal(await seen.text(), "x=1");
});

test("轉址指向通道網址時改回固定網址", async () => {
  const fake = async () => new Response(null, { status: 302, headers: { location: `${ORIGIN}/login/?next=/student/` } });
  const res = await worker.fetch(new Request(`${FIXED}/student/`), env, {}, fake);
  assert.equal(res.headers.get("location"), `${FIXED}/login/?next=/student/`);
});

test("相對路徑轉址也改成固定網址", async () => {
  const fake = async () => new Response(null, { status: 302, headers: { location: "/activate/" } });
  const res = await worker.fetch(new Request(`${FIXED}/register/`), env, {}, fake);
  assert.equal(res.headers.get("location"), `${FIXED}/activate/`);
});

test("通道失效（530）或連不到時顯示離線說明頁", async () => {
  const html = { headers: { accept: "text/html" } };
  let res = await worker.fetch(new Request(`${FIXED}/login/`, html), env, {}, async () => new Response("", { status: 530 }));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /教學主機目前離線/);
  res = await worker.fetch(new Request(`${FIXED}/login/`, html), env, {}, async () => { throw new Error("dns"); });
  assert.equal(res.status, 503);
});

test("Django 自己回的 502 原樣轉給使用者，不誤判成關機", async () => {
  const res = await worker.fetch(new Request(`${FIXED}/api/x`), env, {}, async () => new Response("bad", { status: 502 }));
  assert.equal(res.status, 502);
});

test("尚未設定 ORIGIN_URL 時一律離線", async () => {
  const res = await worker.fetch(new Request(`${FIXED}/login/`), {}, {}, async () => new Response("ok"));
  assert.equal(res.status, 503);
});

test("狀態端點：在線／離線，且只允許 GitHub 頁面跨網站讀取", async () => {
  const gh = { headers: { origin: "https://zhangpengya77-tech.github.io" } };
  let res = await worker.fetch(new Request(`${FIXED}/gateway-status`, gh), env, {}, async () => new Response("svg", { status: 200 }));
  assert.equal((await res.json()).status, "online");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://zhangpengya77-tech.github.io");
  res = await worker.fetch(new Request(`${FIXED}/gateway-status`, { headers: { origin: "https://evil.example" } }), env, {}, async () => { throw new Error("down"); });
  assert.equal((await res.json()).status, "offline");
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("配對 API：GitHub 頁面的預檢與回應帶跨網站許可，其他網站不帶", async () => {
  const gh = "https://zhangpengya77-tech.github.io";
  let res = await worker.fetch(new Request(`${FIXED}/api/simlink/rooms`, { method: "OPTIONS", headers: { origin: gh } }), env, {}, async () => new Response("x"));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), gh);
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  res = await worker.fetch(new Request(`${FIXED}/api/simlink/rooms`, { method: "POST", body: "{}", headers: { origin: gh } }), env, {}, async () => new Response("{}", { status: 201 }));
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("access-control-allow-origin"), gh);
  res = await worker.fetch(new Request(`${FIXED}/api/simlink/rooms`, { method: "POST", body: "{}", headers: { origin: "https://evil.example" } }), env, {}, async () => new Response("{}", { status: 201 }));
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  // 其他路徑（例如登入）不因 GitHub 來源而開放
  res = await worker.fetch(new Request(`${FIXED}/login/`, { headers: { origin: gh } }), env, {}, async () => new Response("ok"));
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("主機離線時配對 API 仍回跨網站許可，讓 GitHub 頁面能顯示「主機離線」", async () => {
  const gh = "https://zhangpengya77-tech.github.io";
  const res = await worker.fetch(new Request(`${FIXED}/api/simlink/rooms`, { method: "POST", body: "{}", headers: { origin: gh } }), env, {}, async () => new Response("", { status: 530 }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("access-control-allow-origin"), gh);
});

// 2026-11-15：主機離線時，公開頁面改由 GitHub 頁面提供（網址不變）
const PAGES = "https://zhangpengya77-tech.github.io/fde-ai/v2/";
const pagesFake = (calls) => async (req) => {
  const u = new URL(req.url);
  if (u.hostname.endsWith("trycloudflare.com")) return new Response("", { status: 530 });
  calls.push(req.url);
  if (u.pathname === "/fde-ai/v2/" ) return new Response("<html>首頁</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  if (u.pathname === "/fde-ai/v2/src/app.js") return new Response("js", { status: 200, headers: { "content-type": "application/javascript" } });
  if (u.pathname === "/fde-ai/v2/about") return new Response("<html>SPA</html>", { status: 404, headers: { "content-type": "text/html" } });
  return new Response("nf", { status: 404, headers: { "content-type": "text/plain" } });
};

test("主機離線：首頁改由 GitHub 頁面提供，網址不變、狀態 200", async () => {
  const calls = [];
  const res = await worker.fetch(new Request(`${FIXED}/`, { headers: { accept: "text/html" } }), env, {}, pagesFake(calls));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-fde-gateway"), "pages-fallback");
  assert.match(await res.text(), /首頁/);
  assert.deepEqual(calls, [PAGES]);
});

test("主機離線：靜態檔與前端路由頁（404.html）都由 GitHub 頁面提供", async () => {
  const calls = [];
  let res = await worker.fetch(new Request(`${FIXED}/src/app.js?v=1`), env, {}, pagesFake(calls));
  assert.equal(res.status, 200); assert.equal(await res.text(), "js");
  assert.equal(calls[0], `${PAGES}src/app.js?v=1`);
  res = await worker.fetch(new Request(`${FIXED}/about`, { headers: { accept: "text/html" } }), env, {}, pagesFake(calls));
  assert.equal(res.status, 200, "前端路由頁改回 200");
  assert.match(await res.text(), /首頁/, "前端路由頁改給 v2 首頁");
  res = await worker.fetch(new Request(`${FIXED}/nope.png`), env, {}, pagesFake(calls));
  assert.equal(res.status, 404, "真的不存在的檔案維持 404");
});

test("主機離線：登入、學員、API 與 POST 仍顯示離線說明，不去 GitHub 頁面", async () => {
  const calls = [];
  for (const path of ["/login/", "/register/", "/student/growth/", "/teacher/login/", "/api/simlink/x"]) {
    const res = await worker.fetch(new Request(`${FIXED}${path}`, { headers: { accept: "text/html" } }), env, {}, pagesFake(calls));
    assert.equal(res.status, 503, path);
  }
  const post = await worker.fetch(new Request(`${FIXED}/`, { method: "POST", body: "x" }), env, {}, pagesFake(calls));
  assert.equal(post.status, 503);
  assert.deepEqual(calls, []);
});

test("沒有設定通道網址時，公開頁面也走 GitHub 頁面", async () => {
  const calls = [];
  const res = await worker.fetch(new Request(`${FIXED}/`, { headers: { accept: "text/html" } }), {}, {}, pagesFake(calls));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test("主機在線時照常轉送到教師電腦，不碰 GitHub 頁面", async () => {
  const seen = [];
  const res = await worker.fetch(new Request(`${FIXED}/`), env, {}, async (req) => { seen.push(req.url); return new Response("live", { status: 200 }); });
  assert.equal(await res.text(), "live");
  assert.deepEqual(seen, [`${ORIGIN}/`]);
});

test("主機離線：/platform/ 底下的平台頁與檔案對應到 GitHub 頁面的 v2 根目錄", async () => {
  const calls = [];
  let res = await worker.fetch(new Request(`${FIXED}/platform/`, { headers: { accept: "text/html" } }), env, {}, pagesFake(calls));
  assert.equal(res.status, 200);
  assert.equal(calls.at(-1), PAGES);
  res = await worker.fetch(new Request(`${FIXED}/platform/src/app.js?v=1`), env, {}, pagesFake(calls));
  assert.equal(await res.text(), "js");
  assert.equal(calls.at(-1), `${PAGES}src/app.js?v=1`);
  res = await worker.fetch(new Request(`${FIXED}/platform/programs`, { headers: { accept: "text/html" } }), env, {}, pagesFake(calls));
  assert.equal(res.status, 200, "課程開設等前端路由頁改給 v2 首頁");
});

test("課程諮詢：GitHub 頁面送出的表單會轉送到教師電腦，回應開放給 GitHub 頁面讀取", async () => {
  let seen;
  const req = new Request(`${FIXED}/api/public/course-inquiry/`, { method: "POST", body: "name=a", headers: { origin: "https://zhangpengya77-tech.github.io", "content-type": "application/x-www-form-urlencoded" } });
  const res = await worker.fetch(req, env, {}, async (r) => { seen = r; return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }); });
  assert.equal(seen.url, `${ORIGIN}/api/public/course-inquiry/`);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://zhangpengya77-tech.github.io");
  const off = await worker.fetch(req.clone ? new Request(`${FIXED}/api/public/course-inquiry/`, { method: "POST", body: "x", headers: { origin: "https://zhangpengya77-tech.github.io" } }) : req, env, {}, async () => new Response("", { status: 530 }));
  assert.equal(off.status, 503);
  assert.equal(off.headers.get("access-control-allow-origin"), "https://zhangpengya77-tech.github.io");
});
