/* 五階段學習工作台：階段切換（教師 2026-10-15 裁決 A2）
 *
 * 設計約束：
 *   1. 純前端 hash 切換，零後端改動、零路由改動、零資料改動。
 *   2. 五個 stage section 全部保留在 DOM（含 id="stage-*"、R01–R08 成長槽位與各項入口），
 *      僅以 hidden 屬性控制顯示 —— 既有錨點與連結相容性不受影響。
 *   3. 支援：重新整理（讀 location.hash 還原）、上一頁／下一頁（hashchange）、手機瀏覽。
 *   4. 無 JS 時（漸進增強）退回瀏覽器原生錨點行為，頁面仍可瀏覽全部階段。
 */
(() => {
  const sections = Array.from(document.querySelectorAll('[data-stage-section]'));
  if (!sections.length) return;

  const links = Array.from(document.querySelectorAll('[data-stage-link]'));
  const sectionByKey = new Map(
    sections.map((section) => [section.dataset.stageSection, section]),
  );

  /** 取目前有效的階段 key；無 hash 或非法值時回傳 null（代表維持伺服器預設）。 */
  function activeKeyFromLocation() {
    const hash = String(window.location.hash || '');
    const match = /^#stage-([a-z_]+)$/.exec(hash);
    return match && sectionByKey.has(match[1]) ? match[1] : null;
  }

  /** 依 key 顯示對應階段；key 為 null 時維持目前顯示狀態（不動）。 */
  function showStage(key) {
    if (!key || !sectionByKey.has(key)) return;
    sections.forEach((section) => {
      const isActive = section.dataset.stageSection === key;
      section.hidden = !isActive;
      section.classList.toggle('is-collapsed', !isActive);
    });
    links.forEach((link) => {
      const isActive = link.dataset.stageLink === key;
      link.classList.toggle('is-current', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
    const step = document.querySelector(`[data-stage-link="${key}"]`);
    if (step && typeof step.scrollIntoView === 'function') {
      step.scrollIntoView({ block: 'nearest' });
    }
  }

  function syncFromLocation() {
    showStage(activeKeyFromLocation());
  }

  // 重新整理：若 hash 有效，立即套用（伺服器已輸出預設顯示狀態，此處僅做覆寫）。
  if (activeKeyFromLocation()) {
    syncFromLocation();
  }

  // 上一頁／下一頁（含使用者直接點錨點）：瀏覽器會改 hash 並觸發 hashchange。
  window.addEventListener('hashchange', syncFromLocation);

  // 點擊路徑列：交由瀏覽器原生處理 hash 變更與捲動，不 preventDefault，
  // 讓「複製連結／另開分頁／重整」皆能還原到同一階段。
})();
