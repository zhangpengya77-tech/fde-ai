(function (root, factory) {
  const data = root.FdeVideoData || (typeof require === 'function' ? require('./data/fdeVideos.js') : {});
  const column = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = column;
  root.FdeColumn = column;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  const categories = data.FDE_VIDEO_CATEGORIES || {};
  const filters = data.FDE_VIDEO_FILTERS || [];

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function filterVideos(category, videos = data.FDE_VIDEOS || []) {
    if (category === 'all') return [...videos];
    if (!Object.hasOwn(categories, category)) return [];
    const categoryLabel = categories[category].toLocaleLowerCase();
    return videos.filter((video) => video.category === category || (video.tags || []).some((tag) => {
      const normalizedTag = String(tag).trim().toLocaleLowerCase();
      return normalizedTag === category.toLocaleLowerCase() || normalizedTag === categoryLabel;
    }));
  }

  function getYoutubeVideoId(value) {
    if (!value) return null;

    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      let id = null;

      if (host === 'youtu.be') {
        id = url.pathname.split('/').filter(Boolean)[0];
      } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        if (['embed', 'shorts', 'live'].includes(segments[0])) id = segments[1];
      }

      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function renderFilters(activeCategory = 'all') {
    return filters.map(({ id, label }) => `
      <button class="fde-filter" type="button" data-fde-filter="${escapeHtml(id)}" aria-pressed="${id === activeCategory}">
        ${escapeHtml(label)}
      </button>
    `).join('');
  }

  function renderVideoCard(video) {
    const videoId = getYoutubeVideoId(video.youtubeUrl);
    const label = categories[video.category] || 'FDE-AI';
    const tags = (video.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const cover = videoId
      ? `<div class="fde-video-cover"><img src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg" alt="${escapeHtml(video.title)}" loading="lazy" decoding="async"></div>`
      : '<div class="fde-video-cover"><div class="fde-video-placeholder">YouTube 連結待提供</div></div>';
    const playButton = videoId
      ? `<button class="secondary-action" type="button" data-play-video="${videoId}">網站內播放</button>`
      : '<button class="secondary-action" type="button" disabled>影片連結待提供</button>';

    return `
      <article class="fde-video-card" data-video-category="${escapeHtml(video.category)}">
        <div class="fde-video-media">${cover}</div>
        <div class="fde-video-copy">
          <span class="tag">${escapeHtml(label)}</span>
          <h3>${escapeHtml(video.title)}</h3>
          <p>${escapeHtml(video.description)}</p>
          <div class="fde-video-tags">${tags}</div>
          ${playButton}
        </div>
      </article>
    `;
  }

  function renderVideoGrid(category = 'all') {
    const videos = filterVideos(category);
    return videos.length
      ? videos.map(renderVideoCard).join('')
      : '<p class="fde-video-empty">目前沒有這個分類的影片。</p>';
  }

  function renderVideoPlayer(videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return '';
    return `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&amp;rel=0" title="FDE-AI YouTube 影片播放器" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }

  function renderPlaylistPlayer(playlistId) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(playlistId || ''))) return '';
    return `<iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}" title="FDE-AI YouTube 播放清單" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }

  return { filterVideos, getYoutubeVideoId, renderFilters, renderVideoCard, renderVideoGrid, renderVideoPlayer, renderPlaylistPlayer };
});
