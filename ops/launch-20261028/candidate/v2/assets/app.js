/* 公開站僅使用匿名狀態檢查；登入與資料操作永遠交由 HTTPS 教學後台。
 *
 * 三態原則（2026-10-28 上線收尾）：
 *   1. 靜態網站可用   —— 本頁能渲染即成立，不依賴任何後端。
 *   2. 登入服務可用   —— 只能由匿名狀態端點證實；證實不了就顯示「無法確認」。
 *   3. YOLO 服務可用 —— 只能由回傳 vision 欄位的端點證實；沒有就顯示「無法確認」。
 * 任何一項都不得在缺少證據時顯示「可用」。
 */
(function () {
  "use strict";

  var STATE = { ONLINE: "online", OFFLINE: "offline", UNKNOWN: "unknown" };

  var config = window.FDE_PUBLIC_CONFIG || {};
  var portalBase = String(config.portalBaseUrl || "").replace(/\/+$/, "");
  var statusUrl = String(config.portalStatusUrl || "");
  var visionUrl = String(config.visionStatusUrl || "");
  var timeoutMs = Number(config.statusTimeoutMs) || 4000;

  var TEXT = {
    static: "可用（本頁已載入）",
    online: "可用",
    offline: "目前不可用",
    unknown: "無法確認"
  };

  function fetchJson(url, timeout) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeout) : null;
    return fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json().catch(function () { return null; });
    }).catch(function () {
      return null;
    }).then(function (payload) {
      if (timer) clearTimeout(timer);
      return payload;
    });
  }

  /* 缺少 CORS 標頭時的誠實降級：只判斷「連得到／連不到」，不讀內容。
   * 連得到也不等於服務可用，因此結果只作為 offline 與 unknown 的區分依據。 */
  function probeReachable(url, timeout) {
    if (typeof fetch !== "function") return Promise.resolve(false);
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeout) : null;
    return fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: controller ? controller.signal : undefined
    }).then(function () {
      if (timer) clearTimeout(timer);
      return true;
    }).catch(function () {
      if (timer) clearTimeout(timer);
      return false;
    });
  }

  function loginStateFrom(payload) {
    if (!payload) return null;
    if (payload.classroom_server === true) return STATE.ONLINE;
    if (payload.classroom_server === false) return STATE.OFFLINE;
    if (payload.login === true) return STATE.ONLINE;
    if (payload.login === false) return STATE.OFFLINE;
    return null;
  }

  function visionStateFrom(payload) {
    if (!payload) return null;
    var vision = payload.vision;
    if (vision && typeof vision.available === "boolean") {
      return vision.available ? STATE.ONLINE : STATE.OFFLINE;
    }
    if (typeof payload.vision_available === "boolean") {
      return payload.vision_available ? STATE.ONLINE : STATE.OFFLINE;
    }
    return null;
  }

  function resolveStatus() {
    if (!statusUrl && !visionUrl) {
      return Promise.resolve({ login: STATE.UNKNOWN, vision: STATE.UNKNOWN, source: "unconfigured" });
    }
    var loginJob = statusUrl
      ? fetchJson(statusUrl, timeoutMs).then(function (payload) {
          var known = loginStateFrom(payload);
          if (known) return { state: known, source: "json" };
          // JSON 讀不到（多半是缺 CORS）：退回連通性判斷。
          return probeReachable(statusUrl, timeoutMs).then(function (reachable) {
            return { state: reachable ? STATE.UNKNOWN : STATE.OFFLINE, source: reachable ? "opaque" : "unreachable" };
          });
        })
      : Promise.resolve({ state: STATE.UNKNOWN, source: "unconfigured" });

    var visionJob = visionUrl
      ? fetchJson(visionUrl, timeoutMs).then(function (payload) {
          var known = visionStateFrom(payload);
          if (known) return { state: known, source: "json" };
          return probeReachable(visionUrl, timeoutMs).then(function (reachable) {
            return { state: reachable ? STATE.UNKNOWN : STATE.OFFLINE, source: reachable ? "opaque" : "unreachable" };
          });
        })
      : Promise.resolve({ state: STATE.UNKNOWN, source: "unconfigured" });

    return Promise.all([loginJob, visionJob]).then(function (results) {
      return { login: results[0].state, vision: results[1].state, source: results[0].source + "/" + results[1].source };
    });
  }

  function label(state) {
    if (state === STATE.ONLINE) return TEXT.online;
    if (state === STATE.OFFLINE) return TEXT.offline;
    return TEXT.unknown;
  }

  function paintRow(key, state) {
    var row = document.querySelector('[data-status-row="' + key + '"]');
    if (!row) return;
    row.setAttribute("data-state", state);
    var target = row.querySelector("[data-status-value]");
    if (target) target.textContent = label(state);
  }

  function summary(status) {
    if (status.login === STATE.ONLINE) {
      return {
        title: "教學系統目前可使用",
        detail: "學員與教師可安全登入教學系統，使用既有帳號完成課程、上傳與審核。"
      };
    }
    if (status.login === STATE.OFFLINE) {
      return {
        title: "FDE-AI 教學系統目前離線",
        detail: "公開課程仍可瀏覽。學員登入、作業上傳及 AI 功能暫時無法使用。"
      };
    }
    return {
      title: "教學系統狀態無法確認",
      detail: "公開課程仍可瀏覽。登入與 AI 功能的即時狀態目前無法取得，請直接前往教學系統或稍後重新檢查。"
    };
  }

  function setPortalLinks(status) {
    document.querySelectorAll("[data-portal-link]").forEach(function (link) {
      var kind = link.getAttribute("data-portal-link");
      var path = kind === "teacher" ? "/teacher/login/" : "/login/";
      var fallback = link.getAttribute("data-portal-fallback") || "#system-status";
      // 只有確定離線才封閉入口；狀態無法確認時仍放行，由教學系統自己顯示真實狀態。
      if (portalBase && status.login !== STATE.OFFLINE) {
        link.href = portalBase + path;
        link.classList.remove("disabled");
        link.removeAttribute("aria-disabled");
        if (status.login === STATE.UNKNOWN) {
          link.setAttribute("data-portal-pending", "1");
          link.setAttribute("title", "教學系統狀態尚未確認，若無法開啟請稍後再試");
        } else {
          link.removeAttribute("data-portal-pending");
          link.removeAttribute("title");
        }
      } else {
        link.href = fallback;
        link.classList.add("disabled");
        link.setAttribute("aria-disabled", "true");
      }
    });
  }

  function renderStatus(status) {
    paintRow("static", STATE.ONLINE);
    paintRow("login", status.login);
    paintRow("vision", status.vision);

    var title = document.getElementById("status-title");
    var detail = document.getElementById("status-detail");
    var text = summary(status);
    if (title) title.textContent = text.title;
    if (detail) detail.textContent = text.detail;

    var note = document.getElementById("status-source");
    if (note) {
      note.textContent = "狀態來源：" + status.source + "；查詢時間 " +
        new Date().toLocaleTimeString("zh-Hant", { hour12: false });
    }
    // 即使本頁沒有狀態區塊（例如 M02 單元頁），入口連結仍要維持正確狀態。
    setPortalLinks(status);
  }

  function checkStatus() {
    var rows = document.querySelectorAll("[data-status-row]");
    rows.forEach(function (row) {
      if (row.getAttribute("data-status-row") !== "static") {
        row.setAttribute("data-state", "pending");
        var value = row.querySelector("[data-status-value]");
        if (value) value.textContent = "正在確認…";
      }
    });
    return resolveStatus().then(renderStatus).catch(function () {
      renderStatus({ login: STATE.UNKNOWN, vision: STATE.UNKNOWN, source: "error" });
    });
  }

  function renderCourses() {
    var target = document.getElementById("course-list");
    if (!target || !Array.isArray(window.FDE_PUBLIC_COURSES)) return;
    window.FDE_PUBLIC_COURSES.forEach(function (course) {
      var article = document.createElement("article");
      article.className = "course-card";
      article.innerHTML = "<p></p><h2></h2><div></div>";
      article.querySelector("p").textContent = course[0];
      article.querySelector("h2").textContent = course[1];
      article.querySelector("div").textContent = course[2];
      target.appendChild(article);
    });
  }

  var refresh = document.getElementById("status-refresh");
  if (refresh) refresh.addEventListener("click", checkStatus);
  renderCourses();
  // 先渲染一次（靜態可用、其餘未確認），避免區塊停留在「正在確認」的假樂觀狀態。
  renderStatus({ login: STATE.UNKNOWN, vision: STATE.UNKNOWN, source: "pending" });
  checkStatus();
}());
