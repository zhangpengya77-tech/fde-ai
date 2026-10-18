/* FDE-AI 公開入口頁：服務狀態檢查（同源呼叫 /portal/health，無跨網域問題） */
(function () {
  "use strict";

  var list = document.getElementById("status-list");
  var timeEl = document.getElementById("status-time");
  var refreshBtn = document.getElementById("status-refresh");
  if (!list) return;

  var LABELS = {
    django: "正常",
    live: "正常",
    flight_health: "正常"
  };

  function render(data) {
    Object.keys(LABELS).forEach(function (key) {
      var li = list.querySelector('[data-service="' + key + '"]');
      if (!li) return;
      var stateEl = li.querySelector(".state");
      var ok = !!(data && data[key] && data[key].ok);
      li.classList.toggle("ok", ok);
      li.classList.toggle("down", !ok);
      stateEl.textContent = ok ? LABELS[key] : "暫時不可用";
    });
    if (timeEl) {
      timeEl.textContent = data && data.checked_at
        ? "最後檢查：" + data.checked_at
        : "無法連線到教師電腦，請稍後再試或向教師確認服務已啟動。";
    }
  }

  function check() {
    if (timeEl) timeEl.textContent = "正在檢查服務狀態…";
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
    fetch("/portal/health", { cache: "no-store", signal: controller ? controller.signal : undefined })
      .then(function (resp) {
        if (!resp.ok) throw new Error("health " + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        render(data);
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        render(null);
      });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", check);
  check();
  setInterval(check, 20000);
})();
