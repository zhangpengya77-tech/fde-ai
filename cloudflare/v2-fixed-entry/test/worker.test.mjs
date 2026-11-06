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
