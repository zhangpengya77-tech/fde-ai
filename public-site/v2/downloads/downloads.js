const categoryNames = {
  "ground-station": "地面站 / Ground Station",
  drivers: "驅動程式 / Drivers",
  "3d-mapping": "3D / 測繪建模",
  "ai-training-tools": "AI / 教學工具",
  "development-installation-tool": "開發／安裝工具",
  "uav-materials": "無人機教材",
  "rc-settings": "遙控器設定",
  "course-docs": "課程文件",
  "sim-guide": "模擬器操作說明",
  others: "其他 / Others",
};

const categoryOrder = [
  "ground-station",
  "drivers",
  "3d-mapping",
  "ai-training-tools",
  "development-installation-tool",
  "uav-materials",
  "rc-settings",
  "course-docs",
  "sim-guide",
  "others",
];

// 託管來源 → 徽章文字與樣式；對應後端 download_source 欄位。
const sourceBadges = {
  github_release: { label: "GitHub Releases", className: "source-release" },
  official_url: { label: "官方下載", className: "source-official" },
  unconfirmed: { label: "待上架", className: "source-pending" },
  pending: { label: "待上架", className: "source-pending" },
  local: { label: "本機", className: "source-official" },
};

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

// 將白名單 Manifest 呈現為學員可理解的下載卡片。
// 原則：只呈現真實可用的位址；沒有授權或尚未發布的一律標「待上架」，
// 不產生任何替代或佔位連結。
function renderDownload(item) {
  const available = item.available !== false && Boolean(item.download_url);
  const source = item.download_source || (available ? "official_url" : "unconfirmed");
  const badge = sourceBadges[source] || sourceBadges.unconfirmed;
  const card = document.createElement("article");
  card.className = available ? "download-card" : "download-card is-pending";

  const isExternal = available && /^https?:\/\//i.test(item.download_url);
  const actionLabel = source === "github_release" ? "下載 Download" : "前往官方下載";
  const action = available
    ? `<a class="download-button" href="${escapeHtml(item.download_url)}"${
        isExternal ? ' target="_blank" rel="noopener noreferrer"' : ""
      }>${actionLabel}</a>`
    : `<span class="download-button is-disabled" aria-disabled="true">待上架</span>`;

  // 本機預覽副本：僅在項目確實可用（available）且存在 preview 路徑時提供。
  // 公開靜態站無後端，available=false 的項目（如 Release 尚未建立的 FDE-AI YOLO）
  // 一律只顯示「待上架」，不渲染指向 /api/ 的失效連結。
  const localCopy = available && item.local_preview_path
    ? `<a class="download-button is-local" href="${escapeHtml(item.local_preview_path)}">本機預覽副本</a>
       <p class="local-note">僅本機預覽可下載；正式站不提供此連結。</p>`
    : "";

  const shaLine = item.sha256
    ? `<p class="sha">SHA-256（本機副本）：${escapeHtml(item.sha256)}</p>`
    : "";

  const licenseLine = item.license
    ? `<p class="license">授權：${escapeHtml(item.license)}${
        item.redistribution === "official-link-only" ? "（僅導向官方）" : ""
      }</p>`
    : "";

  const pendingLine = !available && item.pending_reason
    ? `<p class="pending-reason">${escapeHtml(item.pending_reason)}</p>`
    : "";

  card.innerHTML = `
    <div class="card-head">
      <span class="category">${categoryNames[item.category] || categoryNames.others}</span>
      <span class="source-badge ${badge.className}">${badge.label}</span>
    </div>
    <h2>${escapeHtml(item.display_name)}</h2>
    <p class="filename">${escapeHtml(item.filename)}</p>
    <p class="description">${escapeHtml(item.description_zh)}</p>
    <div class="meta">
      <span>${item.version ? `版本 ${escapeHtml(item.version)}` : "版本未標示"}</span>
      <span>${item.size ? formatSize(item.size) : "—"}</span>
      <span>${available ? `${(item.extension || "").toUpperCase().slice(1)} · ${escapeHtml(item.platform)}` : escapeHtml(item.platform)}</span>
      <span>更新：${formatDate(item.last_modified)}</span>
    </div>
    <small>${escapeHtml(item.install_note)}</small>
    ${licenseLine}
    ${shaLine}
    ${pendingLine}
    <div class="actions">${action}${localCopy}</div>`;
  return card;
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const aPending = a.available === false || !a.download_url ? 1 : 0;
    const bPending = b.available === false || !b.download_url ? 1 : 0;
    if (aPending !== bPending) return aPending - bPending;
    const ai = categoryOrder.indexOf(a.category);
    const bi = categoryOrder.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

// 清單來源：優先讀同目錄的靜態 manifest.json（純靜態託管／子路徑可用），
// 失敗才退回後端 API。兩者內容由同一個產生器輸出，不會有兩份真相。
async function fetchManifest() {
  const candidates = ["manifest.json", "/api/downloads"];
  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`manifest_http_${response.status}`);
      const payload = await response.json();
      if (payload && Array.isArray(payload.downloads)) return payload;
      throw new Error("manifest_shape_invalid");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("download_manifest_unavailable");
}

async function loadDownloads() {
  const loading = document.querySelector("#loading");
  const error = document.querySelector("#error");
  const grid = document.querySelector("#downloadGrid");
  const summary = document.querySelector("#downloadSummary");
  const releaseNote = document.querySelector("#releaseNote");
  try {
    const payload = await fetchManifest();
    loading.hidden = true;
    const items = payload.downloads || [];
    if (!items.length) {
      grid.innerHTML = "<p class=\"notice\">目前尚無可下載檔案。</p>";
      return;
    }
    const ready = items.filter((item) => item.available !== false && item.download_url).length;
    if (summary) {
      summary.textContent =
        `共 ${items.length} 個項目：${ready} 個可直接取得，${items.length - ready} 個待上架。`;
      summary.hidden = false;
    }
    if (releaseNote && payload.release) {
      const rel = payload.release;
      releaseNote.textContent = rel.published
        ? `FDE-AI 自有安裝包由 GitHub Releases 提供（${rel.repo} · ${rel.tag}）。`
        : `FDE-AI 自有安裝包的 GitHub Releases（${rel.tag}）尚未建立，相關項目先標示「待上架」。`;
      releaseNote.hidden = false;
    }
    sortItems(items).forEach((item) => grid.append(renderDownload(item)));
  } catch (_error) {
    loading.hidden = true;
    error.hidden = false;
  }
}

loadDownloads();
