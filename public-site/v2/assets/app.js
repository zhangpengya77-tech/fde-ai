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
      if (online && portalBase) {
        link.href = portalBase + path;
        link.classList.remove("disabled");
        link.removeAttribute("aria-disabled");
      } else {
        link.href = "#system-status";
        link.classList.add("disabled");
        link.setAttribute("aria-disabled", "true");
      }
    });
  }

  function renderStatus(online) {
    var title = document.getElementById("status-title");
    var detail = document.getElementById("status-detail");
    if (!title || !detail) return;
    if (online) {
      title.textContent = "教學系統目前可使用";
      detail.textContent = "學員與教師可安全登入教學系統，使用既有帳號完成課程、上傳與審核。";
    } else {
      title.textContent = "FDE-AI 教學系統目前離線";
      detail.textContent = "公開課程仍可瀏覽。學員登入、作業上傳及 AI 功能暫時無法使用。";
    }
    setPortalLinks(online);
  }

  async function checkStatus() {
    if (!portalBase) return renderStatus(false);
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, statusUrl ? 3000 : 8000) : null;
    if (!statusUrl) {
      // 2026-11-04：後台沒有跨站狀態端點時，改用 no-cors 探測登入頁是否連得到。
      // 連得到（不透明回應）才視為上線；網路失敗或逾時仍誠實顯示離線，不產生假結果。
      try {
        await fetch(portalBase + "/login/", { mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller ? controller.signal : undefined });
        renderStatus(true);
      } catch (_) {
        renderStatus(false);
      } finally {
        if (timer) clearTimeout(timer);
      }
      return;
    }
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
