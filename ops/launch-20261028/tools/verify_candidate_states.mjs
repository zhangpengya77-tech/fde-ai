/**
 * 公開站候選三態驗證（真實瀏覽器 + 真實跨域鏈路）
 *
 * 目的：證明 app.js 在六種後端情境下顯示的狀態與事實一致，且不假裝成功。
 * 不接觸正式 8022/8770/Worker/gh-pages；所有服務僅綁 127.0.0.1 的測試埠。
 *
 * 用法：
 *   NODE_PATH=<node workspace node_modules> node verify_candidate_states.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ESM 不解析 NODE_PATH，改用受管 workspace 的絕對路徑載入 playwright-core（CJS 套件需取 default）。
const PW_ENTRY = "file:///C:/Users/admin/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js";
const pwMod = await import(PW_ENTRY);
const chromium = pwMod.chromium || (pwMod.default && pwMod.default.chromium);
if (!chromium) throw new Error("playwright-core 載入失敗：找不到 chromium 匯出");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIR = path.resolve(__dirname, "..", "candidate");
const URL_PREFIX = "/fde-ai/v2/";
const STATIC_PORT = 18100;
const MOCK_PORT = 18101;
const DEAD_PORT = 18102; // 無監聽：模擬後端不可達
const CHROME = "C:/Users/admin/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";

let activeConfig = {};
let activeMock = { mode: "json_cors_online", body: {}, cors: true };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function staticServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (!url.pathname.startsWith(URL_PREFIX)) {
      res.writeHead(404).end("not found");
      return;
    }
    let rel = url.pathname.slice(URL_PREFIX.length);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    if (rel === "assets/config.js") {
      res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
      res.end("window.FDE_PUBLIC_CONFIG = Object.freeze(" + JSON.stringify(activeConfig) + ");");
      return;
    }
    const abs = path.join(CANDIDATE_DIR, "v2", rel);
    if (!abs.startsWith(path.join(CANDIDATE_DIR, "v2"))) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(abs, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(abs)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(data);
    });
  });
}

function mockServer() {
  return http.createServer((req, res) => {
    const headers = { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" };
    if (activeMock.cors) headers["access-control-allow-origin"] = "*";
    res.writeHead(200, headers);
    res.end(JSON.stringify(activeMock.body));
  });
}

const loginUrl = `http://127.0.0.1:${MOCK_PORT}/gateway-status`;
const visionUrl = `http://127.0.0.1:${MOCK_PORT}/health`;

const SCENARIOS = [
  {
    id: "S1-login-online",
    desc: "狀態端點回 classroom_server=true 且允許跨域",
    config: { portalBaseUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev", portalStatusUrl: loginUrl, visionStatusUrl: "", statusTimeoutMs: 4000 },
    mock: { mode: "json_cors_online", cors: true, body: { gateway: "online", classroom_server: true } },
    expect: { login: "online", vision: "unknown", title: "教學系統目前可使用" }
  },
  {
    id: "S2-login-offline",
    desc: "狀態端點回 classroom_server=false（教學主機離線）",
    config: { portalBaseUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev", portalStatusUrl: loginUrl, visionStatusUrl: "", statusTimeoutMs: 4000 },
    mock: { mode: "json_cors_offline", cors: true, body: { gateway: "online", classroom_server: false } },
    expect: { login: "offline", vision: "unknown", title: "FDE-AI 教學系統目前離線" }
  },
  {
    id: "S3-no-cors-degrade",
    desc: "端點可達但不回 CORS 標頭（等同現況 Worker）→ 必須顯示無法確認",
    config: { portalBaseUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev", portalStatusUrl: loginUrl, visionStatusUrl: "", statusTimeoutMs: 4000 },
    mock: { mode: "json_no_cors", cors: false, body: { gateway: "online", classroom_server: true } },
    expect: { login: "unknown", vision: "unknown", title: "教學系統狀態無法確認" }
  },
  {
    id: "S4-backend-down",
    desc: "狀態端點完全不可達 → 必須顯示離線",
    config: { portalBaseUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev", portalStatusUrl: `http://127.0.0.1:${DEAD_PORT}/gateway-status`, visionStatusUrl: "", statusTimeoutMs: 2500 },
    mock: null,
    expect: { login: "offline", vision: "unknown", title: "FDE-AI 教學系統目前離線" }
  },
  {
    id: "S5-vision-online",
    desc: "提供 vision.available=true 的匿名端點 → YOLO 顯示可用",
    config: { portalBaseUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev", portalStatusUrl: loginUrl, visionStatusUrl: visionUrl, statusTimeoutMs: 4000 },
    mock: { mode: "vision", cors: true, body: { gateway: "online", classroom_server: true, vision: { available: true } } },
    expect: { login: "online", vision: "online", title: "教學系統目前可使用" }
  },
  {
    id: "S6-unconfigured",
    desc: "完全未設定狀態端點 → 不得顯示可用",
    config: { portalBaseUrl: "", portalStatusUrl: "", visionStatusUrl: "", statusTimeoutMs: 4000 },
    mock: null,
    expect: { login: "unknown", vision: "unknown", title: "教學系統狀態無法確認" }
  }
];

async function readState(page) {
  return page.evaluate(() => {
    const get = (k) => {
      const row = document.querySelector(`[data-status-row="${k}"]`);
      return row ? row.getAttribute("data-state") : null;
    };
    return {
      static: get("static"),
      login: get("login"),
      vision: get("vision"),
      title: document.getElementById("status-title")?.textContent?.trim() || "",
      loginText: document.querySelector('[data-status-row="login"] [data-status-value]')?.textContent?.trim() || "",
      visionText: document.querySelector('[data-status-row="vision"] [data-status-value]')?.textContent?.trim() || "",
      studentHref: document.querySelector('.actions [data-portal-link="student"]')?.getAttribute("href") || "",
      courseCount: document.querySelectorAll("#course-list .course-card").length
    };
  });
}

(async () => {
  const srvStatic = staticServer().listen(STATIC_PORT, "127.0.0.1");
  const srvMock = mockServer().listen(MOCK_PORT, "127.0.0.1");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const results = [];

  try {
    for (const sc of SCENARIOS) {
      activeConfig = sc.config;
      if (sc.mock) activeMock = sc.mock;
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
      await page.goto(`http://127.0.0.1:${STATIC_PORT}${URL_PREFIX}`, { waitUntil: "load" });
      // 等登入列離開 pending（最多 9 秒）
      await page.waitForFunction(
        () => {
          const row = document.querySelector('[data-status-row="login"]');
          return row && row.getAttribute("data-state") !== "pending";
        },
        { timeout: 9000 }
      ).catch(() => {});
      const state = await readState(page);

      // 課程頁另驗一次（不同相對路徑深度）
      const coursesPage = await browser.newPage();
      await coursesPage.goto(`http://127.0.0.1:${STATIC_PORT}${URL_PREFIX}courses/`, { waitUntil: "load" });
      const courses = await coursesPage.evaluate(() => ({
        count: document.querySelectorAll("#course-list .course-card").length,
        first: document.querySelector("#course-list .course-card h2")?.textContent || "",
        last: [...document.querySelectorAll("#course-list .course-card p")].pop()?.textContent || ""
      }));
      await coursesPage.close();

      const pass =
        state.static === "online" &&
        state.login === sc.expect.login &&
        state.vision === sc.expect.vision &&
        state.title === sc.expect.title &&
        courses.count === 12;

      results.push({
        id: sc.id,
        desc: sc.desc,
        pass,
        observed: state,
        courses,
        expected: sc.expect,
        consoleErrors
      });
      await page.close();
    }
  } finally {
    await browser.close();
    srvStatic.close();
    srvMock.close();
  }

  const ok = results.filter((r) => r.pass).length;
  const report = { generated_at: new Date().toISOString(), url_prefix: URL_PREFIX, total: results.length, passed: ok, results };
  fs.writeFileSync(path.resolve(__dirname, "..", "evidence", "candidate-three-state-verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok === results.length ? 0 : 1);
})();
