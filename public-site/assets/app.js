/* 公開站僅使用匿名狀態檢查；登入與資料操作永遠交由 HTTPS 教學後台。 */
(function () {
  "use strict";
  var config = window.FDE_PUBLIC_CONFIG || {};
  var portalBase = String(config.portalBaseUrl || "").replace(/\/+$/, "");
  var statusUrl = String(config.portalStatusUrl || "");

  function setPortalLinks(online) {
    document.querySelectorAll("[data-portal-link]").forEach(function (link) {
      var kind = link.getAttribute("data-portal-link");
      var path = kind === "teacher" ? "/teacher/login/" : "/login/";
      // 未設定教學後台時的去處：預設回首頁狀態區塊；子頁面可用 data-portal-fallback 指定。
      var fallback = link.getAttribute("data-portal-fallback") || "#system-status";
      if (online && portalBase) {
        link.href = portalBase + path;
        link.classList.remove("disabled");
        link.removeAttribute("aria-disabled");
      } else {
        link.href = fallback;
        link.classList.add("disabled");
        link.setAttribute("aria-disabled", "true");
      }
    });
  }

  function renderStatus(online) {
    var title = document.getElementById("status-title");
    var detail = document.getElementById("status-detail");
    if (title && detail) {
      if (online) {
        title.textContent = "教學系統目前可使用";
        detail.textContent = "學員與教師可安全登入教學系統，使用既有帳號完成課程、上傳與審核。";
      } else {
        title.textContent = "FDE-AI 教學系統目前離線";
        detail.textContent = "公開課程仍可瀏覽。學員登入、作業上傳及 AI 功能暫時無法使用。";
      }
    }
    // 即使本頁沒有狀態區塊（例如 M02 單元頁），入口連結仍要維持正確狀態。
    setPortalLinks(online);
  }

  async function checkStatus() {
    if (!portalBase || !statusUrl) return renderStatus(false);
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;
    try {
      var response = await fetch(statusUrl, { cache: "no-store", credentials: "omit", signal: controller ? controller.signal : undefined });
      if (!response.ok) throw new Error("status_unavailable");
      var payload = await response.json();
      renderStatus(payload && payload.status === "online");
    } catch (_) {
      renderStatus(false);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function renderCourses() {
    var target = document.getElementById("course-list");
    if (!target || !Array.isArray(window.FDE_PUBLIC_COURSES)) return;
    window.FDE_PUBLIC_COURSES.forEach(function (course) {
      var article = document.createElement("article");
      article.className = "course-card";
      article.innerHTML = "<p>" + course[0] + "</p><h2></h2><div></div>";
      article.querySelector("h2").textContent = course[1];
      article.querySelector("div").textContent = course[2];
      target.appendChild(article);
    });
  }

  document.getElementById("status-refresh")?.addEventListener("click", checkStatus);
  renderCourses();
  checkStatus();
}());
