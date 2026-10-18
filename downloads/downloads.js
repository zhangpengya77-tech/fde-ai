const categoryNames = {
  "ground-station": "地面站 / Ground Station",
  drivers: "驅動程式 / Drivers",
  "3d-mapping": "3D / 測繪建模",
  "ai-training-tools": "AI / 教學工具",
  "development-installation-tool": "開發／安裝工具 / Development / Installation Tool",
  others: "其他 / Others",
};

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(value));
}

// 將白名單 Manifest 呈現為學員可理解的下載卡片。
function renderDownload(item) {
  const card = document.createElement("article");
  card.className = "download-card";
  card.innerHTML = `
    <span class="category">${categoryNames[item.category] || categoryNames.others}</span>
    <h2>${item.display_name}</h2>
    <p class="filename">${item.filename}</p>
    <p class="description">${item.description_zh}</p>
    <div class="meta">
      <span>${item.version ? `版本 ${item.version}` : "版本未標示"}</span>
      <span>${formatSize(item.size)}</span>
      <span>${item.extension.toUpperCase().slice(1)} · ${item.platform}</span>
      <span>更新：${formatDate(item.last_modified)}</span>
    </div>
    <small>${item.install_note}</small>
    <p class="sha">SHA-256：${item.sha256}</p>
    <a class="download-button" href="${item.download_path}">下載 Download</a>`;
  return card;
}

async function loadDownloads() {
  const loading = document.querySelector("#loading");
  const error = document.querySelector("#error");
  const grid = document.querySelector("#downloadGrid");
  try {
    const response = await fetch("/api/downloads", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("download_manifest_unavailable");
    const payload = await response.json();
    loading.hidden = true;
    if (!payload.downloads.length) {
      grid.innerHTML = "<p class=\"notice\">目前尚無可下載檔案。</p>";
      return;
    }
    payload.downloads.forEach((item) => grid.append(renderDownload(item)));
  } catch (_error) {
    loading.hidden = true;
    error.hidden = false;
  }
}

loadDownloads();
