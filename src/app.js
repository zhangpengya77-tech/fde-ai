(() => {
const {
  hero,
  designSystem,
  moduleSections,
  platformModes,
  workflowSteps,
  missionStages,
  missionTasks,
  missionPacks,
  cohorts,
  learningPath,
  studentDashboard,
  learningTracks,
  practiceResources,
  buildWorkflow,
  voiceAssistant,
  assessmentWorkflows,
  teacherDashboard,
  certificationChecklist,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  simulateHoverAssessment
} = window.FdePlatform;

const $ = (selector) => document.querySelector(selector);
const router = window.FdeRouter;
const learningSections = window.FdeLearningSections || [];
const fdeVideoData = window.FdeVideoData || {};
const fdeColumn = window.FdeColumn || {};
const localYoloEndpoint = 'http://127.0.0.1:8765/api/detect';
const localHoverEndpoint = 'http://127.0.0.1:8765/api/hover';
const ragConfig = window.FdeRagConfig || {};
const ragClient = window.FdeRagClient?.createRagClient(ragConfig);
const assistantService = ragClient && window.FdeRagClient?.createF450AssistantService(ragClient);
let voiceRecognition = null;
let voiceTranscript = '';
let voiceSubmitOnEnd = false;
let isVoicePlaybackPaused = false;
let selectedTaskId = null;
let activeFdeVideoFilter = 'all';
const defaultPageTitle = document.title;
const defaultMetaContent = {
  description: document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
  ogTitle: document.head.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
  ogDescription: document.head.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? null,
  ogType: document.head.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? null,
  ogUrl: document.head.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null
};

function statusClass(status) {
  return String(status).toLowerCase().replaceAll(' ', '-').replaceAll('／', '-').replaceAll('_', '-');
}

const taskStatusLabels = {
  not_started: '○ 未開始',
  in_progress: '🟡 進行中',
  submitted: '待教師複核',
  needs_review: '待教師複核',
  completed: '✅ 已完成',
  approved: '✅ 已完成',
  rejected: '未通過'
};

function displayTaskStatus(status) {
  return taskStatusLabels[status] || status;
}

function displayTaskMeta(task) {
  return task.estimatedHours ? `${task.difficulty} · ${task.estimatedHours}h` : task.difficulty;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderNavigation() {
  const primaryNav = [
    // 2026-11-06：「關於我們」入口移到左上角品牌（點我），導航從「學」開始；12 任務資料與 /platform/tasks 路由保留不刪
    ...moduleSections,
    { label: '健', title: '飛行健康 AI / Flight Health', href: '/flight-health/' },
    { label: '調', title: 'AI PID 與濾波實驗室 / AI PID & Filter Lab', href: '/pid-lab/' },
    { key: 'cohorts', label: '展', title: '歷屆學員成果' },
    { key: 'teacher', label: '師', title: '教師復核中心' }
  ];
  // 2026-11-06：左側導航改為「藍底圓形徽章（繁體楷書大字）＋下方英文小字」，旁邊的項目名稱縮小。
  // 學練做測證是核心五步，徽章再大一號（is-core）。
  const NAV_EN = { 關: 'ABOUT', 學: 'LEARN', 練: 'PRACTICE', 做: 'BUILD', 作: 'BUILD', 測: 'TEST', 證: 'CERTIFY', 健: 'HEALTH', 調: 'TUNE', 展: 'SHOWCASE', 師: 'TEACHER' };
  const CORE = new Set(['學', '練', '做', '作', '測', '證']);
  $('#moduleNav').innerHTML = primaryNav
    .map(
      (section) =>
        `<a href="${section.href || router.hrefFor(section.key)}"${section.key ? ` data-route="${section.key}"` : ''} class="nav-item${CORE.has(section.label) ? ' is-core' : ''}">` +
        `<span class="nav-badge" aria-hidden="true"><b class="nav-zh">${section.label}</b><small class="nav-en">${NAV_EN[section.label] || ''}</small></span>` +
        `<em class="nav-title">${section.title}</em></a>`
    )
    .join('');
  // 系統關閉動畫效果時預設不播放徽章動畫；驗收時可加 ?motion=1 強制播放
  if (new URLSearchParams(window.location.search).get('motion') === '1') document.documentElement.classList.add('force-motion');

  // 手機左側抽屜直接沿用桌面左側欄的導航，避免兩份清單各自維護而走樣。
  const mobileNavList = document.getElementById('mobileNavList');
  if (mobileNavList) mobileNavList.innerHTML = $('#moduleNav').innerHTML;
}

function applyRoute(routeKey) {
  const route = router.definitions.find((item) => item.key === routeKey) || router.definitions[0];
  document.querySelectorAll('main > .section-block').forEach((section) => {
    const isActive = section.id === route.sectionId;
    section.hidden = !isActive;
    section.style.display = isActive ? '' : 'none';
    section.setAttribute('aria-hidden', String(!isActive));
  });

  document.body.classList.toggle('inspection-view', route.key === 'inspection');
  document.body.classList.toggle('fde-column-view', route.key === 'fde-column' && route.sectionId === 'fde-column');
  document.body.classList.toggle('home-view', route.key === 'home');
  document.body.dataset.route = route.key;
  updatePageMetadata(route.key);

  document.querySelectorAll('#moduleNav a, .mobile-demo-nav a').forEach((link) => {
    const linkRoute = link.dataset.route || router.routeFromHref(link.getAttribute('href'));
    const activeRoute = route.key === 'fde-column' ? 'learn' : route.key;
    if (linkRoute === activeRoute) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function setMetaContent(attribute, key, value, fallback) {
  const selector = `meta[${attribute}="${key}"]`;
  let element = document.head.querySelector(selector);
  const content = value ?? fallback;
  if (content === null) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.setAttribute('content', content);
}

function updatePageMetadata(routeKey) {
  // 2026-11-05：「關於我們」頁的標題與描述（分享連結時顯示）
  if (routeKey === 'about') {
    const title = 'FDE-AI｜關於我們 About FDE-AI';
    const description = 'FDE-AI 是結合無人機教育、開源技術、AI 應用與產業實作的無人載具人才實訓平台，服務零基礎學員到專業進階人才。';
    document.title = title;
    setMetaContent('name', 'description', description, null);
    setMetaContent('property', 'og:title', title, null);
    setMetaContent('property', 'og:description', description, null);
    setMetaContent('property', 'og:type', 'website', null);
    setMetaContent('property', 'og:url', new URL(router.hrefFor('about'), window.location.href).href, null);
    return;
  }
  if (routeKey === 'fde-column') {
    const title = 'FDE-AI｜無人載具學習中心';
    const description = 'FDE-AI 無人載具學習中心，依閉源飛控、開源飛控與 3D 列印整理教師指定課程。';
    document.title = title;
    setMetaContent('name', 'description', description, null);
    setMetaContent('property', 'og:title', title, null);
    setMetaContent('property', 'og:description', description, null);
    setMetaContent('property', 'og:type', 'website', null);
    setMetaContent('property', 'og:url', new URL(router.hrefFor('fde-column'), window.location.href).href, null);
    return;
  }

  document.title = defaultPageTitle;
  setMetaContent('name', 'description', null, defaultMetaContent.description);
  setMetaContent('property', 'og:title', null, defaultMetaContent.ogTitle);
  setMetaContent('property', 'og:description', null, defaultMetaContent.ogDescription);
  setMetaContent('property', 'og:type', null, defaultMetaContent.ogType);
  setMetaContent('property', 'og:url', null, defaultMetaContent.ogUrl);
}

function navigateToRoute(routeKey) {
  const route = router.definitions.find((item) => item.key === routeKey);
  if (!route) return;

  window.history.pushState({ route: route.key }, '', router.hrefFor(route.key));
  applyRoute(route.key);
}

function syncViewFromLocation() {
  applyRoute(router.routeFromLocation(window.location));
}

function handleRouteClick(event) {
  const link = event.target.closest('a');
  if (!link || (link.target && link.target !== '_self')) return;

  const routeKey = link.dataset.route || router.routeFromHref(link.getAttribute('href'));
  if (!routeKey) return;

  event.preventDefault();
  navigateToRoute(routeKey);
}

function renderHero() {
  $('#heroHeadline').textContent = hero.headline;
  $('#heroSummary').textContent = hero.summary;
  $('#heroSystems').innerHTML = hero.systems.map((system) => `<span>${system}</span>`).join('');

  const primaryAction = hero.actions.find((action) => action.kind === 'primary');
  $('#heroActions').innerHTML =
    (primaryAction
      ? `<a class="${primaryAction.kind}-action" href="${router.hrefForTarget(primaryAction.target)}">${primaryAction.label}</a>`
      : '') +
    // 2026-11-06：首頁加「一分鐘認識 FDE-AI」入口，點了進入「關於我們」頁（最上方就是介紹影片）
    `<a class="secondary-action hero-video-entry" href="./about" data-route="about">▶ 一分鐘認識 FDE-AI</a>`;

  const motionStrip = $('#designMotion');
  if (motionStrip) {
    motionStrip.hidden = hero.showMotionStrip === false;
    motionStrip.innerHTML =
      hero.showMotionStrip === false ? '' : designSystem.motion.map((motion) => `<span>${motion}</span>`).join('');
  }
}

function renderDataFlow() {
  const flow = [
    ['學', 'SOP / AI 助教'],
    ['練', '模擬器 / Mission Planner'],
    ['做', 'F450 / AI / 3D'],
    ['測', '鷹眼 AI 檢測'],
    ['證', '作品 / 能力紀錄']
  ];
  $('#learningFlow').innerHTML = flow
    .map(([label, detail]) => `<div class="flow-node"><strong>${label}</strong><span>${detail}</span></div>`)
    .join('');
}

function renderStageGuides() {
  moduleSections.forEach((section) => {
    const intro = document.querySelector(`#${section.key} .section-intro`);
    if (!intro || intro.querySelector('.stage-guide')) return;

    intro.insertAdjacentHTML(
      'beforeend',
      `
        <div class="stage-guide">
          <span>${section.label}</span>
          <strong>${section.title}</strong>
          <p>${section.goal}</p>
        </div>
      `
    );
  });
}

function renderModes() {
  $('#platformModes').innerHTML = platformModes
    .map(
      (mode) => `
        <article class="mode-card">
          <span class="tag">${mode.title}</span>
          <p>${mode.description}</p>
          <div class="mini-nav">${mode.nav.map((item) => `<span>${item}</span>`).join('')}</div>
        </article>
      `
    )
    .join('');
}

function renderStudentDashboard() {
  $('#studentGreeting').textContent = studentDashboard.greeting;
  $('#studentStats').innerHTML = studentDashboard.stats
    .map((stat) => `<div class="metric-card"><span>${stat.label}</span><strong>${stat.value}</strong></div>`)
    .join('');
  $('#currentMission').innerHTML = `
    <div class="mission-current-head">
      <span class="tag">${studentDashboard.currentMission.code}</span>
      <h3>${studentDashboard.currentMission.title}</h3>
    </div>
    <p>${studentDashboard.currentMission.description}</p>
    <div class="progress-rail">
      ${studentDashboard.currentMission.progress
        .map((step) => `<span class="${step.state}">${step.label}</span>`)
        .join('')}
    </div>
    <a class="primary-action" href="${router.hrefFor('inspection')}">${studentDashboard.currentMission.action}</a>
  `;
}

function renderLearningPath() {
  $('#learningPath').innerHTML = learningPath
    .map(
      (node) => `
        <div class="path-node ${node.state}">
          <span>${node.icon}</span>
          <strong>${node.title}</strong>
        </div>
      `
    )
    .join('');
}

function renderMissionMap() {
  const map = $('#missionStageMap');
  if (!map) return;

  map.innerHTML = missionStages
    .map(
      (stage) => `
        <article class="mission-stage-card ${stage.id}">
          <div class="stage-head">
            <span class="tag">${stage.badge}</span>
            <h3>${stage.title}</h3>
            <p>${stage.description}</p>
          </div>
          <div class="stage-task-list">
            ${missionTasks
              .filter((task) => task.stage === stage.id)
              .map(
                (task) => `
                  <button class="mission-card task-select ${task.id === selectedTaskId ? 'is-selected' : ''}" type="button" data-task-id="${task.id}">
                    <div class="section-head">
                      <span class="mission-code">${task.id}</span>
                      <span class="status ${statusClass(task.status)}">${displayTaskStatus(task.status)}</span>
                    </div>
                    <strong>${task.title}</strong>
                    <small>${task.subtitle}</small>
                    <span class="difficulty">${displayTaskMeta(task)}</span>
                    ${task.entryHref ? '<span class="difficulty">進入單元 →</span>' : ''}
                  </button>
                `
              )
              .join('')}
          </div>
        </article>
      `
    )
    .join('');

  renderTaskDetail(selectedTaskId);
}

function getTaskProgress(taskId) {
  try {
    return workflowSteps.reduce((progress, step) => {
      progress[step.key] = localStorage.getItem(`fde-ai:v1.1:${taskId}:${step.key}`) === 'done';
      return progress;
    }, {});
  } catch {
    return {};
  }
}

function setTaskProgress(taskId, stepKey, checked) {
  try {
    const key = `fde-ai:v1.1:${taskId}:${stepKey}`;
    if (checked) {
      localStorage.setItem(key, 'done');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Local file mode can restrict storage in some browsers; the UI still works without persistence.
  }
}

function renderSectionList(items = []) {
  if (!items.length) return '';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderTaskDetail() {
  return;
}

function renderTaskDetailLegacy(taskId) {
  const task = missionTasks.find((item) => item.id === taskId) || missionTasks[0];
  const panel = $('#taskDetailPanel');
  if (!panel || !task) return;

  selectedTaskId = task.id;
  const progress = getTaskProgress(task.id);
  const completed = workflowSteps.filter((step) => progress[step.key]).length;
  const percentage = Math.round((completed / workflowSteps.length) * 100);

  panel.innerHTML = `
    <article class="task-detail-card">
      <div class="task-detail-head">
        <div>
          <span class="tag">${task.id} · ${missionStages.find((stage) => stage.id === task.stage)?.title || task.stage}</span>
          <h3>${task.title}</h3>
          <p>${task.description}</p>
        </div>
        <div class="task-meta">
          <span>${task.difficulty}</span>
          ${task.estimatedHours ? `<span>${task.estimatedHours} 小時</span>` : ''}
          <span>${task.suitableFor.join(' / ')}</span>
        </div>
      </div>
      <div class="task-progress">
        <strong>${percentage}%</strong>
        <span style="width: ${percentage}%"></span>
      </div>
      <div class="task-workflow">
        ${workflowSteps
          .map((step) => {
            const section = task[step.key];
            const done = progress[step.key];
            return `
              <section class="workflow-step-card ${done ? 'is-done' : ''}">
                <div class="workflow-step-head">
                  <span>${step.label}</span>
                  <div>
                    <strong>${section.title}</strong>
                    <small>${step.title}</small>
                  </div>
                  <label class="progress-toggle">
                    <input type="checkbox" data-progress-task="${task.id}" data-progress-step="${step.key}" ${done ? 'checked' : ''} />
                    <i>${done ? '完成' : '標記'}</i>
                  </label>
                </div>
                <p>${section.description}</p>
                ${renderSectionList(section.checklist)}
              </section>
            `;
          })
          .join('')}
      </div>
    </article>
  `;

  document.querySelectorAll('[data-task-id]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.taskId === task.id);
  });
}

function renderCohorts() {
  const grid = $('#cohortGrid');
  if (!grid) return;

  grid.innerHTML = cohorts
    .map((cohort) => {
      const showcaseVideos = Array.isArray(cohort.showcaseVideos) ? cohort.showcaseVideos : [];
      return `
        <article class="cohort-card">
          <span class="tag">${cohort.year} · ${cohort.location || 'FDE-AI'}</span>
          <h3>${escapeHtml(cohort.name)}</h3>
          <p>${escapeHtml(cohort.description)}</p>
          <div class="cohort-task-strip">
            ${cohort.learnedTasks.map((taskId) => `<span>${escapeHtml(taskId)}</span>`).join('')}
          </div>
          ${
            showcaseVideos.length
              ? `
                <div class="cohort-video-grid">
                  ${showcaseVideos
                    .map(
                      (video) => `
                        <a class="cohort-video-card" href="${video.url}" target="_blank" rel="noreferrer">
                          <span>${escapeHtml(video.phase)}</span>
                          <strong>${escapeHtml(video.title)}</strong>
                          <small>觀看影片</small>
                        </a>
                      `
                    )
                    .join('')}
                </div>
              `
              : ''
          }
          <div class="cohort-actions">
            <a href="${cohort.youtubePlaylistUrl}" target="_blank" rel="noreferrer">YouTube 成果</a>
            <a href="${cohort.githubUrl}" target="_blank" rel="noreferrer">GitHub 倉庫</a>
          </div>
        </article>
      `;
    })
    .join('');
}

function youtubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1);
    return parsed.searchParams.get('v') || '';
  } catch {
    return '';
  }
}

function renderLearningResources() {
  const grid = $('#learningResources');
  const detail = $('#learningSectionDetail');
  if (!grid || !detail) return;

  grid.hidden = false;
  detail.hidden = true;
  detail.innerHTML = '';
  grid.innerHTML = learningSections
    .map(
      (section, index) => `
        <button class="learning-section-card learning-section-card-${index + 1}" type="button" data-learning-section="${section.id}">
          <span class="learning-section-index">0${index + 1}</span>
          <span class="learning-section-label">${escapeHtml(section.label)}</span>
          <strong>${escapeHtml(section.title)}</strong>
          <span>${escapeHtml(section.summary)}</span>
          <small>${section.courses.length} 堂指定課程 <span aria-hidden="true">→</span></small>
        </button>
      `,
    )
    .join('');
}

function renderLearningSectionDetail(sectionId) {
  const section = learningSections.find((item) => item.id === sectionId);
  const grid = $('#learningResources');
  const detail = $('#learningSectionDetail');
  if (!section || !grid || !detail) return;

  grid.hidden = true;
  detail.hidden = false;
  detail.innerHTML = `
    <button class="learning-back" type="button" data-learning-back>← 返回學習中心</button>
    <div class="learning-detail-heading">
      <span class="learning-section-label">${escapeHtml(section.label)}</span>
      <h3>${escapeHtml(section.title)}</h3>
      <p>${escapeHtml(section.summary)}</p>
    </div>
    <div class="learning-course-list">
      ${section.courses
        .filter((course) => course.enabled)
        .sort((a, b) => a.order - b.order)
        .map((course) => {
          const id = youtubeId(course.youtubeUrl);
          return `
            <article class="learning-course-card">
              <div class="learning-course-number">${String(course.order).padStart(2, '0')}</div>
              <div class="learning-course-content">
                <h4>${escapeHtml(course.title)}</h4>
                ${
                  id
                    ? `<div class="learning-video"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}" title="${escapeHtml(course.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
                    : '<p class="learning-video-missing">影片嵌入待補。</p>'
                }
                <a class="learning-youtube-link" href="${escapeHtml(course.youtubeUrl)}" target="_blank" rel="noreferrer">在 YouTube 開啟原始影片 ↗</a>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
  // 手機上卡片在畫面下方：切換後捲回課程清單開頭，學員才看得到內容
  detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function handleLearningClick(event) {
  const sectionButton = event.target.closest('[data-learning-section]');
  if (sectionButton) {
    renderLearningSectionDetail(sectionButton.dataset.learningSection);
    return;
  }

  if (event.target.closest('[data-learning-back]')) {
    renderLearningResources();
    // 返回時捲回三大專區卡片
    $('#learningResources')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function renderFdeColumn() {
  if (!fdeColumn.renderFilters || !fdeColumn.renderVideoGrid) return;
  $('#fdeVideoFilters').innerHTML = fdeColumn.renderFilters(activeFdeVideoFilter);
  $('#fdeVideoGrid').innerHTML = fdeColumn.renderVideoGrid(activeFdeVideoFilter);

  const playlistId = String(fdeVideoData.YOUTUBE_PLAYLIST_ID || '');
  $('#fdePlaylistAction').innerHTML = /^[A-Za-z0-9_-]+$/.test(playlistId)
    ? `<button class="secondary-action" type="button" data-play-playlist="${escapeHtml(playlistId)}">播放 FDE-AI 專欄播放清單</button>`
    : '';
}

function handleFdeColumnClick(event) {
  const filterButton = event.target.closest('[data-fde-filter]');
  if (filterButton) {
    activeFdeVideoFilter = filterButton.dataset.fdeFilter;
    $('#fdeVideoFilters').innerHTML = fdeColumn.renderFilters(activeFdeVideoFilter);
    $('#fdeVideoGrid').innerHTML = fdeColumn.renderVideoGrid(activeFdeVideoFilter);
    $('#fdePlaylistPlayer').innerHTML = '';
    $('#fdePlaylistPlayer').hidden = true;
    return;
  }

  const playButton = event.target.closest('[data-play-video]');
  if (playButton) {
    const videoId = playButton.dataset.playVideo;
    const playerMarkup = fdeColumn.renderVideoPlayer(videoId);
    if (!playerMarkup) return;

    $('#fdePlaylistPlayer').innerHTML = '';
    $('#fdePlaylistPlayer').hidden = true;
    $('#fdeVideoGrid').innerHTML = fdeColumn.renderVideoGrid(activeFdeVideoFilter);
    const currentButton = Array.from(document.querySelectorAll('#fdeVideoGrid [data-play-video]'))
      .find((button) => button.dataset.playVideo === videoId);
    const videoMedia = currentButton?.closest('.fde-video-card').querySelector('.fde-video-media');
    if (videoMedia) videoMedia.innerHTML = playerMarkup;
    return;
  }

  const playlistButton = event.target.closest('[data-play-playlist]');
  if (playlistButton) {
    const playerMarkup = fdeColumn.renderPlaylistPlayer(playlistButton.dataset.playPlaylist);
    if (!playerMarkup) return;

    $('#fdeVideoGrid').innerHTML = fdeColumn.renderVideoGrid(activeFdeVideoFilter);
    $('#fdePlaylistPlayer').innerHTML = playerMarkup;
    $('#fdePlaylistPlayer').hidden = false;
  }
}

function renderPracticeResources() {
  $('#practiceResources').innerHTML = practiceResources
    .map(
      (resource) => `
        <article class="practice-card">
          <div>
            <span class="tag">${resource.category}</span>
            <h3>${resource.title}</h3>
            <p>${resource.description}</p>
          </div>
          <ol>${resource.steps.map((step) => `<li>${step}</li>`).join('')}</ol>
          <a href="${resource.url}" target="_blank" rel="noreferrer">開始練習</a>
        </article>
      `
    )
    .join('');
}

function renderBuildWorkflow() {
  $('#buildMeta').innerHTML = `
    <span>版本 ${buildWorkflow.version}</span>
    <span>${buildWorkflow.controller}</span>
    <span>${buildWorkflow.interactionMode}</span>
    <span>${voiceAssistant.locale}</span>
  `;
  $('#buildStages').innerHTML = buildWorkflow.stages
    .map((stage, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${stage}</li>`)
    .join('');
}

function renderVoiceAssistantPanel() {
  const status = $('#voiceStatus');
  if (status) status.textContent = voiceAssistant.statuses.idle;
}

function renderAssessmentWorkflows() {
  // 正式入口只顯示前兩項（槳葉方向、電力巡檢）；帶 legacy 標記的流程
  // （四面懸停）改在「歷史／擴充檢測」區呈現，不佔用正式檢測入口。
  const formal = assessmentWorkflows.filter((workflow) => !workflow.legacy);
  const legacy = assessmentWorkflows.filter((workflow) => workflow.legacy);
  const card = (workflow) => `
        <article class="workflow-card">
          <span class="tag">${workflow.engine}</span>
          <h3>${workflow.title}</h3>
          <p>可上傳：${workflow.acceptedEvidence.join(' / ')}</p>
          <ul>${workflow.checks.map((check) => `<li>${check}</li>`).join('')}</ul>
        </article>
      `;
  const grid = $('#assessmentWorkflows');
  if (grid) grid.innerHTML = formal.map(card).join('');
  const legacyGrid = $('#legacyAssessmentWorkflows');
  if (legacyGrid) legacyGrid.innerHTML = legacy.map(card).join('');
}

function renderAssistantResult(result) {
  return `
    <article class="result-card">
      <div class="section-head">
        <span class="tag">${result.mode}</span>
        <span class="status ${statusClass(result.sourceStatus)}">${result.sourceStatus}</span>
      </div>
      <h3>${result.topic}</h3>
      <p>${result.answer}</p>
      ${
        result.sources.length > 0
          ? `<div class="source-list">${result.sources.map((source) => `<small>${source.title} · ${source.sourcePath}</small>`).join('')}</div>`
          : ''
      }
      <small>${result.voiceStatus}</small>
    </article>
  `;
}

function renderF450RagResult(result) {
  const sourceLabel = window.FdeRagClient.sourceLabel(result.source_type);
  return `
    <article class="result-card">
      <div class="section-head"><span class="tag">F450 AI 助教</span><span class="tag">${escapeHtml(sourceLabel)}</span></div>
      <h3>回答</h3>
      <p>${escapeHtml(result.answer)}</p>
      ${renderInspectionSpeechControls(result.answer)}
    </article>
  `;
}

/** 手機 AI 回答朗讀控制項：使用瀏覽器原生 SpeechSynthesis，不引入任何外部 TTS。 */
function renderInspectionSpeechControls(answer) {
  const text = String(answer || '').trim();
  if (!text) return '';
  if (!('speechSynthesis' in window)) {
    return '<p class="speech-unsupported">此瀏覽器不支援語音朗讀，文字回答仍可正常閱讀。</p>';
  }
  return `
    <div class="inspection-speech" data-inspection-speech>
      <button type="button" class="secondary-action" data-speak-inspection>🔊 播放語音</button>
      <button type="button" class="secondary-action" data-stop-inspection>■ 停止播放</button>
    </div>
  `;
}

/** 朗讀指定的 AI 回答：先取消上一段，避免疊音。 */
function speakInspectionAnswer(button) {
  if (!('speechSynthesis' in window)) return;
  const panel = button.closest('[data-inspection-assistant]') || document;
  const answer = panel.querySelector('.result-card p');
  const text = answer ? answer.textContent.trim() : '';
  if (!text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceAssistant.locale;
  utterance.rate = 0.95;
  // iOS Safari 需要由使用者手勢觸發，這裡同步呼叫 speak 以保留手勢授權。
  window.speechSynthesis.speak(utterance);
}

/** 停止目前朗讀。 */
function stopInspectionAnswer() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function speakVoiceAnswer(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  isVoicePlaybackPaused = false;
  const pauseButton = $('#voicePauseButton');
  if (pauseButton) {
    pauseButton.disabled = false;
    pauseButton.textContent = '暫停播報';
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceAssistant.locale;
  utterance.rate = 0.95;
  utterance.addEventListener('end', resetVoicePlaybackControl);
  utterance.addEventListener('error', resetVoicePlaybackControl);
  window.speechSynthesis.speak(utterance);
}

function resetVoicePlaybackControl() {
  isVoicePlaybackPaused = false;
  const pauseButton = $('#voicePauseButton');
  if (!pauseButton) return;
  pauseButton.disabled = true;
  pauseButton.textContent = '暫停播報';
}

function toggleVoicePlayback() {
  if (!('speechSynthesis' in window) || !window.speechSynthesis.speaking) {
    resetVoicePlaybackControl();
    return;
  }

  const pauseButton = $('#voicePauseButton');
  if (!pauseButton) return;

  if (isVoicePlaybackPaused) {
    window.speechSynthesis.resume();
    isVoicePlaybackPaused = false;
    pauseButton.textContent = '暫停播報';
    $('#voiceStatus').textContent = voiceAssistant.statuses.idle;
  } else {
    window.speechSynthesis.pause();
    isVoicePlaybackPaused = true;
    pauseButton.textContent = '繼續播報';
    $('#voiceStatus').textContent = '語音播報已暫停';
  }
}

async function runVoiceAssistantQuestion(question) {
  const csrfToken = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const response = await fetch('/api/public/voice/ask/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRFToken': decodeURIComponent(csrfToken) } : {})
    },
    credentials: 'same-origin',
    body: JSON.stringify({ question, locale: voiceAssistant.locale })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || '語音助教服務沒有回應');
  }
  return payload.result;
}

async function askAssistantFromText(question) {
  const topic = question.trim();
  if (!topic) return;

  $('#voiceStatus').textContent = voiceAssistant.statuses.searching;
  $('#assistantResult').innerHTML = '<article class="result-card"><p>正在查詢 F450 RAG 知識庫...</p></article>';

  if (ragConfig.FDE_RAG_V1_ENABLED) {
    let result;
    try {
      result = await assistantService.askF450Assistant(topic, null, 'student_chat');
    } catch {
      const message = 'AI 助教知識庫暫時無法連接，請稍後再試。';
      $('#assistantResult').innerHTML = `<article class="result-card local-service-note"><p>${message}</p></article>`;
      $('#voiceStatus').textContent = message;
      return;
    }

    $('#voiceStatus').textContent = voiceAssistant.statuses.answering;
    $('#assistantResult').innerHTML = renderF450RagResult(result);
    let speechUnavailable = false;
    try {
      speakVoiceAnswer(result.answer);
    } catch {
      speechUnavailable = true;
    }
    $('#voiceStatus').textContent = speechUnavailable
      ? '回答已取得，語音播報暫不可用。'
      : voiceAssistant.statuses.idle;
    return;
  }

  try {
    const result = await runVoiceAssistantQuestion(topic);
    $('#voiceStatus').textContent = voiceAssistant.statuses.answering;
    $('#assistantResult').innerHTML = renderAssistantResult(result);
    speakVoiceAnswer(result.answer);
    $('#voiceStatus').textContent = voiceAssistant.statuses.idle;
  } catch {
    const fallback = simulateBuildAssistant(topic);
    $('#assistantResult').innerHTML = `
      ${renderAssistantResult(fallback)}
      <article class="result-card local-service-note">
        <h3>舊版本機助教服務尚未連線</h3>
        <p>請確認舊版本機 AI 助教服務已啟動。</p>
      </article>
    `;
    speakVoiceAnswer(fallback.answer);
    $('#voiceStatus').textContent = fallback.voiceStatus;
  }
}

function formatConfidence(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'CHECK';
}

function propellerFinalResult(result) {
  const motorChecks = Array.isArray(result.motorChecks) ? result.motorChecks : [];
  if (!motorChecks.length) {
    return {
      status: 'CHECK',
      title: '部分槳葉需要人工確認',
      detail: '目前沒有完整 M1-M4 槳葉資料，請重新拍攝俯視照片後再檢測。'
    };
  }

  const failed = motorChecks.filter((item) => item.result === 'NG');
  const uncertain = motorChecks.filter((item) => item.result === 'CHECK');
  if (failed.length) {
    return {
      status: 'NG',
      title: '發現 F450 槳葉安裝異常',
      detail: failed.map((item) => `${item.motor}: Detected ${item.detectedDirection}, Expected ${item.expectedDirection}`).join('；')
    };
  }
  if (uncertain.length) {
    return {
      status: 'CHECK',
      title: '部分槳葉需要人工確認',
      // adaptPropResult 提供的是 reason（後端 reason_code 的可能原因），
      // 舊欄位 errorCode 不存在會印出 undefined，這裡改為相容讀取。
      detail: uncertain.map((item) => `${item.motor}: ${item.reason || item.errorCode || '待確認'}`).join('；')
    };
  }
  return {
    status: 'PASS',
    title: 'F450 槳葉安裝檢測通過',
    detail: 'M1、M2、M3、M4 均符合目前規則。'
  };
}

function renderMotorChecks(result) {
  const checks = Array.isArray(result.motorChecks) ? result.motorChecks : [];
  if (!checks.length) {
    return '<div class="motor-check-grid"><article class="motor-check check"><strong>M1-M4</strong><span>CHECK</span><small>尚未取得完整槳葉位置資料</small></article></div>';
  }

  return `
    <div class="motor-layout-label">FRONT ↑</div>
    <div class="motor-check-grid">
      ${checks
        .map(
          (item) => `
            <article class="motor-check ${statusClass(item.result)}">
              <div class="motor-check-head">
                <strong>${escapeHtml(item.motor)}</strong>
                <span>${escapeHtml(item.result)}</span>
              </div>
              <small>${escapeHtml(item.position || '位置待確認')}</small>
              <dl>
                <div><dt>Detected</dt><dd>${escapeHtml(item.detectedDirection || 'CHECK')}</dd></div>
                <div><dt>Expected</dt><dd>${escapeHtml(item.expectedDirection || 'CHECK')}</dd></div>
                <div><dt>Blade Face</dt><dd>${escapeHtml(item.bladeFace || 'CHECK')}</dd></div>
                <div><dt>Confidence</dt><dd>${formatConfidence(item.confidence)}</dd></div>
              </dl>
              ${item.result === 'NG' ? `<p>Correct: ${escapeHtml(item.expectedDirection)}</p>` : ''}
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function inspectionAssistantContext(result) {
  const checks = Array.isArray(result.motorChecks) ? result.motorChecks : [];
  const status = propellerFinalResult(result).status;
  return {
    task: 'f450_propeller_check',
    status,
    errors: checks.filter((item) => item.result !== 'PASS').map((item) => ({
      motor: item.motor,
      status: item.result,
      // 後端 reason / reason_code 對應；errorCode 為舊欄位，保留相容。
      error_code: item.reason || item.errorCode,
      detected: item.detectedDirection,
      expected: item.expectedDirection,
      blade_face: item.bladeFace
    }))
  };
}

// ---- 2026-11-04 鷹眼檢測 AI 助教：判定說明＋知識庫＋大模型解說＋自動語音 ----
let eagleTutorPayload = null;
let eagleTutorSpeech = '';

/** iOS Safari 只允許「使用者點擊」後播放語音；在按下檢測按鈕時先播一段空白語音解鎖，結果回來才能自動朗讀。 */
function primeInspectionSpeech() {
  if (!('speechSynthesis' in window)) return;
  try {
    const unlock = new SpeechSynthesisUtterance(' ');
    unlock.volume = 0;
    window.speechSynthesis.speak(unlock);
  } catch {
    /* 不支援時略過，文字回答仍可閱讀 */
  }
}

/** 朗讀 AI 助教文字（先停止上一段，避免疊音）。 */
function speakEagleTutor(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceAssistant.locale;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

/** 把 M1～M4 檢測結果轉成後端 AI 助教需要的格式（只送旋向，不送照片）。 */
function eagleTutorPayloadFrom(result) {
  const checks = Array.isArray(result.motorChecks) ? result.motorChecks : [];
  return {
    task: 'f450_propeller_check',
    motors: checks
      .filter((item) => /^M[1-4]$/.test(String(item.motor || '')))
      .map((item) => ({ motor: item.motor, detected: item.detectedDirection || '' })),
  };
}

async function requestEagleTutor(payload, withLlm) {
  const csrfToken = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  const response = await fetch('/api/public/inspection/ai-tutor/', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRFToken': decodeURIComponent(csrfToken) } : {}),
    },
    body: JSON.stringify({ ...payload, with_llm: Boolean(withLlm) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.error || `AI 助教暫時無法使用（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderEagleTutor(answer) {
  const status = answer.candidate === 'PASS' ? 'PASS' : answer.candidate === 'ERROR' ? 'NG' : 'CHECK';
  const wrong = Array.isArray(answer.wrong_props) ? answer.wrong_props : [];
  const rag = answer.rag || {};
  const sources = Array.isArray(rag.sources) ? rag.sources : [];
  const wrongHtml = wrong.length
    ? `<h4>哪一支錯、正確應該是什麼</h4><ul>${wrong
        .map((item) => `<li>${escapeHtml(item.motor)}（${escapeHtml(item.position)}）：目前 ${escapeHtml(item.detected)} ✗，正確應為 ${escapeHtml(item.expected)}</li>`)
        .join('')}</ul>`
    : '';
  const fixHtml = Array.isArray(answer.fix_steps) && answer.fix_steps.length
    ? `<h4>修正步驟</h4><ol>${answer.fix_steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`
    : '';
  const ragHtml = rag.available
    ? `<h4>知識庫說明（RAG）</h4><p>${escapeHtml(rag.answer)}</p>${sources.length ? `<small>出處：${sources.map((s) => escapeHtml(`${s.title} ${s.ref}`.trim())).join('、')}</small>` : ''}`
    : '';
  let llmHtml = '<p class="muted">按「AI 助教解說」，由大模型說明正確與錯誤的差別與影響。</p>';
  if (answer.llm_requested) {
    llmHtml = answer.llm_available
      ? `<p>${escapeHtml(answer.llm)}</p>`
      : '<p class="muted">大模型目前未啟用或暫時無法連線，上方判定與知識庫說明仍可使用。</p>';
  }
  return `
    <article class="result-card eagle-ai-tutor">
      <div class="section-head"><span class="tag">AI 助教</span><span class="status ${statusClass(status)}">${status}</span></div>
      <h3>檢測說明</h3>
      <p>${escapeHtml(answer.verdict)}</p>
      ${wrongHtml}
      ${fixHtml}
      ${ragHtml}
      <h4>AI 大模型解說</h4>
      ${llmHtml}
      <div class="inspection-speech">
        <button type="button" class="primary-action" data-eagle-llm>🤖 AI 助教解說</button>
        <button type="button" class="secondary-action" data-eagle-replay>🔊 再聽一次</button>
        <button type="button" class="secondary-action" data-stop-inspection>■ 停止播放</button>
      </div>
    </article>
  `;
}

/** 按「AI 助教解說」：向後端要大模型解說，顯示並朗讀；「再聽一次」重播目前內容。 */
async function handleEagleTutorClick(event) {
  if (event.target.closest('[data-eagle-replay]')) {
    speakEagleTutor(eagleTutorSpeech);
    return;
  }
  const button = event.target.closest('[data-eagle-llm]');
  if (!button || !eagleTutorPayload) return;
  const target = document.querySelector('[data-inspection-assistant]');
  primeInspectionSpeech();
  button.disabled = true;
  button.textContent = 'AI 助教思考中…';
  try {
    const answer = await requestEagleTutor(eagleTutorPayload, true);
    eagleTutorSpeech = answer.speech_text || '';
    if (target) target.innerHTML = renderEagleTutor(answer);
    speakEagleTutor(answer.llm || answer.speech_text);
  } catch (error) {
    button.disabled = false;
    button.textContent = '🤖 AI 助教解說';
    if (target) target.insertAdjacentHTML('beforeend', `<p class="muted">${escapeHtml(error.message)}</p>`);
  }
}

/**
 * 電力巡檢 AI 助教：每 10 秒詢問一次，分析完成（不再回 409）後顯示判定、處理建議與大模型解說並自動朗讀。
 * 最多等 10 分鐘；超過時請學員到巡檢紀錄頁查看（該頁也有 AI 助教按鈕）。
 */
async function pollPowerTutor(jobId, container, attempt = 0) {
  if (!container || !document.body.contains(container)) return;
  const csrfToken = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
  try {
    const response = await fetch(`/student/power-inspection/jobs/${encodeURIComponent(jobId)}/ai-tutor/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfToken ? { 'X-CSRFToken': decodeURIComponent(csrfToken) } : {},
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && attempt < 60) {
      setTimeout(() => pollPowerTutor(jobId, container, attempt + 1), 10000);
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.error || `AI 助教暫時無法使用（${response.status}）`);
    eagleTutorSpeech = data.speech_text || '';
    container.innerHTML = `
      <h3>AI 助教</h3>
      <p>${escapeHtml(data.verdict || '')}</p>
      ${data.advice ? `<h4>處理建議</h4><p>${escapeHtml(data.advice)}</p>` : ''}
      <h4>AI 大模型解說</h4>
      ${data.llm_available ? `<p>${escapeHtml(data.llm)}</p>` : '<p class="muted">大模型目前未啟用或暫時無法連線，上方判定與建議仍可使用。</p>'}
      <div class="inspection-speech">
        <button type="button" class="secondary-action" data-eagle-replay>🔊 再聽一次</button>
        <button type="button" class="secondary-action" data-stop-inspection>■ 停止播放</button>
      </div>
    `;
    speakEagleTutor(eagleTutorSpeech);
  } catch (error) {
    container.innerHTML = `<h3>AI 助教</h3><p class="muted">${escapeHtml(error.message)}，請到「我的巡檢紀錄」查看結果。</p>`;
  }
}

async function appendInspectionKnowledgeAnswer(result) {
  const target = document.querySelector('[data-inspection-assistant]');
  if (!target) return;

  // 優先使用後端 AI 助教（需登入）：自動顯示判定與知識庫並語音朗讀；失敗才退回原本的知識庫回答。
  const payload = eagleTutorPayloadFrom(result);
  if (payload.motors.length && !result.simulationMode) {
    target.innerHTML = '<p>AI 助教正在整理檢測說明...</p>';
    try {
      const answer = await requestEagleTutor(payload, false);
      eagleTutorPayload = payload;
      eagleTutorSpeech = answer.speech_text || '';
      target.innerHTML = renderEagleTutor(answer);
      speakEagleTutor(eagleTutorSpeech);
      return;
    } catch {
      /* 未登入或後端暫時無法使用：沿用原本的知識庫流程 */
    }
  }

  const finalResult = propellerFinalResult(result);
  if (finalResult.status === 'PASS') {
    // 正確場景也要能語音播報，學員不必看螢幕即可確認結果。
    target.innerHTML = renderF450RagResult({
      answer: '檢測通過：M1 到 M4 的槳葉旋向都與 F450 配置一致，可以進入下一步。',
      source_type: 'rag',
    });
    return;
  }

  target.innerHTML = '<p>正在查詢 FDE 知識庫並產生 AI 修正建議...</p>';
  try {
    const answer = await assistantService.askF450Assistant('', inspectionAssistantContext(result), 'eagle_detection');
    target.innerHTML = renderF450RagResult(answer);
  } catch {
    target.innerHTML = `
      <article class="result-card local-service-note">
        <h3>AI 修正建議</h3>
        <p>AI 助手暫時無法連接；上方 M1-M4 的 PASS / NG / CHECK 檢測結果仍可使用。</p>
      </article>
    `;
  }
}

function renderDetectionImage(result) {
  const imageSrc = result.annotatedImage || result.inputImage;
  if (!imageSrc) {
    return '<div class="scan-line"></div><span>等待 YOLO 檢測圖片</span>';
  }

  const label = result.annotatedImage ? 'YOLO 標註檢測圖片' : '上傳檢測圖片';
  return `
    <img src="${imageSrc}" alt="${label}" />
    <span class="visual-caption">檢測圖片</span>
  `;
}

function renderPropellerInspectionResult(result, includeVisual = false) {
  const fileName = escapeHtml(result.fileName || '未命名檢測檔案');
  const detections = Array.isArray(result.detections) ? result.detections : [];
  const finalResult = propellerFinalResult(result);
  // DEMO 模擬推論必須在學生視圖明確標示，不得冒充真實 YOLO 測評。
  const demoBadge = result.simulationMode
    ? `<div class="demo-simulation-badge"><strong>${escapeHtml(result.resultLabel || 'DEMO 模擬結果')}</strong><span>非真實 YOLO 推論，僅供展示操作流程</span></div>`
    : '';
  return `
    <article class="result-card inspection-result yolo-result">
      <div class="inspection-summary-panel">
        ${demoBadge}
        <div class="section-head">
          <span class="tag">${escapeHtml(result.engine)}</span>
          <span class="status ${statusClass(finalResult.status)}">${finalResult.status}</span>
        </div>
        <h3 class="result-file-name" title="${fileName}">${fileName}</h3>
        <p>${escapeHtml(result.summary)}</p>
        <div class="inspection-hints">
          <small>M1 = CCW、M2 = CCW、M3 = CW、M4 = CW。</small>
        </div>
        ${renderMotorChecks(result)}
        <div class="inspection-final-result ${statusClass(finalResult.status)}">
          <span>FINAL RESULT</span>
          <strong>${escapeHtml(finalResult.status)}</strong>
          <p>${escapeHtml(finalResult.title)}</p>
          <small>${escapeHtml(finalResult.detail)}</small>
        </div>
        <div class="detection-list">
          ${detections
            .map((item) => {
              const confidence = Number.isFinite(item.confidence) ? `${(item.confidence * 100).toFixed(1)}%` : '待確認';
              return `<small>${escapeHtml(item.motor || item.position || '目標')} · ${escapeHtml(item.label || item.className)} · ${confidence}</small>`;
            })
            .join('')}
        </div>
        <div class="inspection-assistant" data-inspection-assistant>
          <h3>AI 修正建議</h3>
          <p>等待檢測結果送入 FDE 知識庫。</p>
        </div>
      </div>
      <div class="scan-preview yolo-preview inspection-visual-panel">
        ${renderDetectionImage(result)}
      </div>
    </article>
  `;
}

function renderAssemblyResult(result) {
  return renderPropellerInspectionResult(result, false);
}

function renderYoloAssemblyResult(result) {
  return renderPropellerInspectionResult(result, true);
}

function renderHoverResult(result) {
  return `
    <article class="result-card inspection-result">
      <div class="trajectory">
        <span></span>
        <i></i>
      </div>
      <div>
        <div class="section-head">
          <span class="tag">${result.engine}</span>
          <span class="status pass">${result.score} 分</span>
        </div>
        <h3>${result.fileName}</h3>
        <p>${result.summary}</p>
        <div class="metric-grid">
          ${result.metrics.map((metric) => `<div><span>${metric.label}</span><strong>${metric.value}</strong></div>`).join('')}
        </div>
        <small>${result.teacherReview}</small>
      </div>
    </article>
  `;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function imageSize(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}

// ---- Platform Integration：Assess 正式 Vision API ----
function assessDevMode() {
  const config = window.FdeRagConfig || {};
  if (config.ASSESS_DEV_MODE === true) return true;
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch {
    return false;
  }
}

function visionApiBase() {
  const client = window.FdeVisionClient;
  if (!client) return null;
  return client.visionApiBase(window.FdeRagConfig || {}, window.location);
}

function noModelMessage() {
  return (window.FdeVisionClient && window.FdeVisionClient.NO_MODEL_MESSAGE)
    || '目前尚無可用模型，請稍後再試或聯絡教師。';
}

/** 2026-11-04：未登入（後台回 live_session_required）時改提示登入，登入後回到目前頁面，不再誤導成「無可用模型」。 */
function loginRequiredCard() {
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  return `
    <article class="result-card local-service-note">
      <h3>請先登入</h3>
      <p>AI 檢測需要登入學員或教師帳號，登入後會自動回到這個檢測頁。</p>
      <p><a class="primary-action button" href="/login/?next=${next}">前往學員登入</a></p>
    </article>
  `;
}

/** 正式流程不可用時的明確提示：絕不顯示模擬結果當成真實測評。 */
function unavailableCard(message, detail) {
  if (detail === 'live_session_required') return loginRequiredCard();
  return `
    <article class="result-card local-service-note">
      <h3>目前尚無可用模型</h3>
      <p>${escapeHtml(message || noModelMessage())}</p>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </article>
  `;
}

/** 尚未選擇檔案時的提示：與「無可用模型」區分，避免誤導學生。 */
function missingFileCard(message) {
  return `
    <article class="result-card local-service-note">
      <h3>請先選擇照片</h3>
      <p>${escapeHtml(message || '請先上傳 F450 俯視照片。')}</p>
    </article>
  `;
}

/** DEV MODE 專用：明確標示為模擬結果，不進入正式學生結果。 */
function devOnlyNotice(detail) {
  return `
    <article class="result-card local-service-note">
      <h3>DEV MODE 模擬結果</h3>
      <p>此結果僅供開發測試，非真實 AI 測評結果。</p>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </article>
  `;
}

/** Build 作：主要 CTA 指向 F450 Main-12（可由 PUBLIC_LIVE_COACH_URL 覆寫）。 */
function renderBuildMain12Entry() {
  const link = document.getElementById('buildMain12Entry');
  if (!link) return;
  const config = window.FdeRagConfig || {};
  const publicUrl = String(config.PUBLIC_LIVE_COACH_URL || '').trim();
  const localUrl = String(config.LIVE_COACH_URL || '/live/').trim();
  link.href = publicUrl || localUrl;
}

async function runLocalYoloDetection(file) {
  const imageData = await fileToDataUrl(file);
  const response = await fetch(localYoloEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, imageData, conf: 0.25 })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || '本機 YOLO 服務沒有回應');
  }
  return { ...payload.result, inputImage: imageData };
}

async function runLocalHoverScoring(file) {
  const videoData = await fileToDataUrl(file);
  const response = await fetch(localHoverEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, videoData })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || '本機四面懸停模型沒有回應');
  }
  return payload.result;
}

function renderTeacherDashboard() {
  $('#teacherStats').innerHTML = teacherDashboard.stats
    .map((stat) => `<div class="metric-card"><span>${stat.label}</span><strong>${stat.value}</strong></div>`)
    .join('');
  $('#teacherQueue').innerHTML = teacherDashboard.reviewQueue
    .map(
      (item) => `
        <article class="queue-row">
          <div><strong>${item.student}</strong><span>${item.mission}</span></div>
          <span class="status ${statusClass(item.aiResult)}">${item.aiResult}</span>
          <p>${item.reason}</p>
          <a href="${router.hrefFor('inspection')}">${item.action}</a>
        </article>
      `
    )
    .join('');
}

function renderCertificationChecklist() {
  $('#certificationChecklist').innerHTML = certificationChecklist
    .map(
      (item) => `
        <article class="cert-card">
          <span></span>
          <h3>${item.title}</h3>
          <p>${item.detail}</p>
        </article>
      `
    )
    .join('');
}

function bindActions() {
  document.addEventListener('click', handleRouteClick);
  document.addEventListener('click', handleFdeColumnClick);
  document.addEventListener('click', handleLearningClick);
  // AI 回答語音朗讀（事件委託：結果區會被 innerHTML 重新渲染）。
  document.addEventListener('click', (event) => {
    const speakButton = event.target.closest('[data-speak-inspection]');
    if (speakButton) {
      speakInspectionAnswer(speakButton);
      return;
    }
    if (event.target.closest('[data-stop-inspection]')) stopInspectionAnswer();
    // 鷹眼 AI 助教的「AI 助教解說」「再聽一次」按鈕
    if (event.target.closest('[data-eagle-llm], [data-eagle-replay]')) handleEagleTutorClick(event);
  });
  window.addEventListener('popstate', syncViewFromLocation);

  document.querySelectorAll('[data-task-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTaskId = button.dataset.taskId;
      renderTaskDetail(selectedTaskId);
      // 具備 entryHref 的任務（如 M02）直接前往獨立單元頁；其餘任務行為不變。
      const entryTask = missionTasks.find((item) => item.id === selectedTaskId);
      if (entryTask && entryTask.entryHref) window.location.href = entryTask.entryHref;
    });
  });

  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.matches('[data-progress-task][data-progress-step]')) return;
    setTaskProgress(input.dataset.progressTask, input.dataset.progressStep, input.checked);
    renderTaskDetail(input.dataset.progressTask);
  });

  document.querySelectorAll('[data-track-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.track-card');
      const expanded = card.classList.toggle('is-expanded');
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? '收合' : `展開全部 ${card.querySelectorAll('.lesson-list a').length} 個`;
    });
  });

  $('#assistantButton').addEventListener('click', () => {
    askAssistantFromText($('#assistantQuestion').value);
  });

  const voiceStartButton = $('#voiceStartButton');
  const voiceStopButton = $('#voiceStopButton');

  function voiceUnsupportedMessage() {
    if (!window.isSecureContext) return '語音功能需要 HTTPS 安全連線。';
    return voiceAssistant.statuses.unsupported || '目前瀏覽器不支援語音錄製，請使用 Safari 開啟。';
  }

  function startVoiceCapture(event) {
    event?.preventDefault();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $('#voiceStatus').textContent = voiceUnsupportedMessage();
      return;
    }

    voiceTranscript = '';
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = voiceAssistant.locale;
    voiceRecognition.interimResults = true;
    voiceRecognition.continuous = true;

    voiceRecognition.addEventListener('result', (event) => {
      voiceTranscript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      $('#assistantQuestion').value = voiceTranscript;
    });

    voiceRecognition.addEventListener('end', () => {
      const shouldSubmit = voiceSubmitOnEnd;
      voiceRecognition = null;
      voiceStartButton.disabled = false;
      voiceStopButton.disabled = true;
      voiceStopButton.hidden = true;
      voiceStartButton.hidden = false;
      if (shouldSubmit) {
        voiceSubmitOnEnd = false;
        askAssistantFromText($('#assistantQuestion').value || voiceTranscript);
      }
    });

    try {
      voiceRecognition.start();
    } catch {
      voiceRecognition = null;
      $('#voiceStatus').textContent = '錄音失敗，請重新按住說話。';
      return;
    }
    voiceStartButton.disabled = true;
    voiceStartButton.hidden = true;
    voiceStopButton.disabled = false;
    voiceStopButton.hidden = false;
    $('#voiceStatus').textContent = voiceAssistant.statuses.listening;
  }

  function stopVoiceCapture(event) {
    event?.preventDefault();
    if (voiceRecognition && !voiceSubmitOnEnd) {
      voiceSubmitOnEnd = true;
      try {
        voiceRecognition.stop();
      } catch {
        voiceRecognition = null;
        voiceSubmitOnEnd = false;
        $('#voiceStatus').textContent = '錄音失敗，請重新按住說話。';
        return;
      }
      $('#voiceStatus').textContent = '正在處理語音…';
    }
  }

  voiceStartButton.addEventListener('pointerdown', startVoiceCapture);
  voiceStartButton.addEventListener('pointerup', stopVoiceCapture);
  voiceStartButton.addEventListener('pointercancel', stopVoiceCapture);
  voiceStartButton.addEventListener('lostpointercapture', stopVoiceCapture);
  voiceStopButton.addEventListener('click', stopVoiceCapture);

  const uploadStatus = $('[data-assistant-upload-status]');
  const mediaPreview = $('[data-assistant-media-preview]');
  const previewAssistantMedia = (input, label) => {
    const file = input?.files?.[0];
    if (!file || !mediaPreview) return;
    mediaPreview.replaceChildren();
    const preview = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
    preview.src = URL.createObjectURL(file);
    if (preview.tagName === 'VIDEO') {
      preview.controls = true;
      preview.playsInline = true;
    }
    preview.alt = file.name;
    mediaPreview.append(preview);
    mediaPreview.hidden = false;
    if (uploadStatus) uploadStatus.textContent = `${label}已選取：${file.name}。請到學習成長日誌完成正式保存。`;
  };
  const uploadAssistantMedia = async (input, label, uploader, successEvent, failureEvent) => {
    const file = input?.files?.[0];
    if (!file) return;
    previewAssistantMedia(input, label);
    if (uploadStatus) uploadStatus.textContent = `${label}已選取，正在上傳…`;
    console.info(successEvent.replace('_OK', '_START'), file.type, file.size);
    try {
      await uploader(file);
      console.info(successEvent, file.type, file.size);
      if (uploadStatus) uploadStatus.textContent = `${label}已上傳，伺服器已收到檔案。`;
    } catch (error) {
      console.warn(failureEvent, error.message);
      if (uploadStatus) uploadStatus.textContent = `${label}已選取，但上傳服務目前無法回應：${error.message}`;
    }
  };
  $('#assistantImageInput')?.addEventListener('change', (event) => {
    uploadAssistantMedia(event.target, '照片', runLocalYoloDetection, 'IMAGE_UPLOAD_OK', 'IMAGE_UPLOAD_FAIL');
  });
  $('#assistantVideoInput')?.addEventListener('change', (event) => {
    uploadAssistantMedia(event.target, '影片', runLocalHoverScoring, 'VIDEO_UPLOAD_OK', 'VIDEO_UPLOAD_FAIL');
  });

  $('#voicePauseButton').addEventListener('click', () => {
    toggleVoicePlayback();
  });

  // PROP_DIRECTION：正式走 /api/v1/vision/prop-check，不再使用 legacy 本機 YOLO。
  $('#propellerButton').addEventListener('click', async () => {
    // 新一次檢測開始前，先停止上一段 AI 語音朗讀，避免疊音。
    stopInspectionAnswer();
    // 趁使用者點擊時解鎖語音，結果回來後 AI 助教才能自動朗讀（iOS Safari 限制）。
    primeInspectionSpeech();
    const file = $('#propellerInput').files[0];
    const client = window.FdeVisionClient;
    if (!file) {
      if (assessDevMode()) {
        const result = simulatePropellerAssessment('demo-f450-check.jpg');
        $('#propellerResult').innerHTML = renderAssemblyResult(result) + devOnlyNotice();
        appendInspectionKnowledgeAnswer(result);
        return;
      }
      $('#propellerResult').innerHTML = missingFileCard('請先上傳 F450 俯視照片，再點擊「執行槳葉檢測」。');
      return;
    }

    $('#propellerResult').innerHTML = '<article class="result-card"><p>正在執行 AI 槳葉方向檢測...</p></article>';
    try {
      const imageData = await fileToDataUrl(file);
      const size = await imageSize(imageData);
      const result = await client.propCheck({
        base: visionApiBase(),
        imageDataUrl: imageData,
        imageWidth: size.width,
        imageHeight: size.height,
        fileName: file.name,
      });
      // 學生必須看到「自己上傳的那張照片」，否則預覽區只會顯示等待占位文字。
      result.inputImage = imageData;
      $('#propellerResult').innerHTML = renderYoloAssemblyResult(result);
      appendInspectionKnowledgeAnswer(result);
    } catch (error) {
      if (assessDevMode()) {
        const result = simulatePropellerAssessment(file.name);
        try {
          result.inputImage = await fileToDataUrl(file);
        } catch {
          result.inputImage = '';
        }
        $('#propellerResult').innerHTML = renderAssemblyResult(result) + devOnlyNotice(error.message);
        appendInspectionKnowledgeAnswer(result);
        return;
      }
      $('#propellerResult').innerHTML = unavailableCard(error.message, error.detail);
    }
  });

  // POWER_INSPECTION_V1：正式走 Django /student/power-inspection/upload/（JSON）。
  // 沒有真實模型時後端會回 WAITING_FOR_REAL_MODEL / BLOCKED，前端如實顯示，
  // 絕不顯示任何模擬異常結果。
  const POWER_UPLOAD_STALL_MS = 90000;
  const POWER_SERVER_WAIT_MS = 180000;

  const powerLoginCard = (detail, loginUrl) => `
    <article class="result-card local-service-note">
      <h3>請先以學員身分登入</h3>
      <p>${escapeHtml(detail || '登入後才能上傳電力巡檢影片。')}</p>
      <p><a class="primary-action button" href="${escapeHtml(loginUrl || '/login/')}?next=%2Fstudent%2Fpower-inspection%2F">前往學員登入</a></p>
    </article>
  `;

  // fetch 沒有上傳進度，大影片在手機網路上會像當機，因此改用 XHR；
  // 超過時間沒有進度就中止，不讓畫面停在上傳中。
  const uploadPowerVideo = (file, csrfToken, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let watchdog;
    let stalled = false;
    const arm = (ms) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, ms);
    };
    const body = new FormData();
    body.append('video', file, file.name);
    xhr.open('POST', '/student/power-inspection/upload/');
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader('X-CSRFToken', csrfToken);
    xhr.upload.onprogress = (event) => {
      arm(POWER_UPLOAD_STALL_MS);
      onProgress(event.loaded, event.total || file.size);
    };
    xhr.upload.onload = () => {
      arm(POWER_SERVER_WAIT_MS);
      onProgress(file.size, file.size);
    };
    xhr.onload = () => {
      clearTimeout(watchdog);
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = {};
      }
      resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, payload });
    };
    xhr.onerror = () => {
      clearTimeout(watchdog);
      reject(new Error('network_error'));
    };
    xhr.onabort = () => {
      clearTimeout(watchdog);
      reject(new Error(stalled ? 'upload_stalled' : 'upload_aborted'));
    };
    arm(POWER_UPLOAD_STALL_MS);
    xhr.send(body);
  });

  $('#powerInspectionButton').addEventListener('click', async () => {
    // 先解鎖語音：分析完成後 AI 助教要自動朗讀（iOS Safari 限制）。
    stopInspectionAnswer();
    primeInspectionSpeech();
    const file = $('#powerInspectionInput').files[0];
    const target = $('#powerInspectionResult');
    if (!file) {
      target.innerHTML = missingFileCard('請先上傳巡檢影片，再點擊「上傳並建立巡檢工作」。');
      return;
    }
    if (!/\.(mp4|mov|m4v|3gp|3g2|lrf|webm|mkv|avi|wmv|mts|m2ts|ts|mpg|mpeg)$/i.test(file.name)) {
      target.innerHTML = missingFileCard('影片格式不支援，請上傳 MP4、MOV、M4V、3GP、WEBM、MKV、AVI、WMV、MTS、M2TS、TS、MPG 或 DJI LRF 影片。');
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      target.innerHTML = missingFileCard('影片超過 512 MB，請裁短或降低畫質後再上傳。');
      return;
    }

    const sizeMb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
    target.innerHTML = '<article class="result-card"><p>正在確認上傳權限...</p></article>';
    try {
      // 先確認身分與 CSRF，避免整支影片傳完才被拒絕。
      const check = await fetch('/student/power-inspection/upload/', { credentials: 'same-origin' });
      const access = await check.json().catch(() => ({}));
      if (access.denied?.code === 'login_required') {
        target.innerHTML = powerLoginCard(access.denied.detail, access.denied.login_url);
        return;
      }
      if (access.denied) {
        target.innerHTML = unavailableCard(access.denied.detail || '目前無法上傳巡檢影片，請聯絡教師。');
        return;
      }

      const startedAt = Date.now();
      const showProgress = (loaded, total) => {
        const percent = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;
        const seconds = (Date.now() - startedAt) / 1000;
        const speed = seconds > 1 ? ` ｜ ${(loaded * 8 / 1000000 / seconds).toFixed(1)} Mbps` : '';
        target.innerHTML = percent >= 100
          ? '<article class="result-card"><p>影片已傳送完成，正在建立巡檢工作...</p></article>'
          : `<article class="result-card">
              <p>正在上傳 ${percent}%（${sizeMb(loaded)} / ${sizeMb(total)} MB${speed}）</p>
              <progress max="100" value="${percent}" style="width:100%"></progress>
              <p>上傳期間請保持此頁開啟，不要鎖定手機。</p>
            </article>`;
      };
      showProgress(0, file.size);
      const { status, ok, payload } = await uploadPowerVideo(file, access.csrf_token, showProgress);
      const response = { status, ok };
      if (!response.ok || !payload.ok) {
        if (response.status === 413) {
          target.innerHTML = missingFileCard('影片超過目前網址允許的上傳大小，請裁短或降低畫質後再上傳。');
          return;
        }
        if (payload.code === 'login_required') {
          target.innerHTML = powerLoginCard(payload.detail, payload.login_url);
          return;
        }
        target.innerHTML = unavailableCard(payload.detail || '巡檢影片上傳未完成，請稍後再試或聯絡教師。');
        return;
      }
      const blocked = payload.inference_mode === 'BLOCKED' || payload.status === 'WAITING_FOR_REAL_MODEL';
      target.innerHTML = `
        <article class="result-card${blocked ? ' local-service-note' : ''}">
          <h3>${blocked ? '已建立巡檢工作，但尚未載入真實模型' : '巡檢工作已建立'}</h3>
          <p>工作編號：${escapeHtml(payload.job_id || '')}</p>
          <p>狀態：${escapeHtml(payload.status || '')}｜推論模式：${escapeHtml(payload.inference_mode || '')}</p>
          <p>${escapeHtml(payload.detail || '')}</p>
          ${blocked ? '<p><strong>目前不會產生任何 AI 異常結果；待教師部署真實模型後才會實際分析。</strong></p>' : ''}
          <p><a href="/student/power-inspection/">前往我的巡檢紀錄</a></p>
          ${blocked ? '' : '<div class="inspection-assistant" data-power-tutor><h3>AI 助教</h3><p>影片分析中，完成後 AI 助教會自動說明結果並語音朗讀…</p></div>'}
        </article>
      `;
      if (!blocked && payload.job_id) pollPowerTutor(payload.job_id, target.querySelector('[data-power-tutor]'));
    } catch (error) {
      if (error.message === 'upload_stalled') {
        target.innerHTML = unavailableCard('上傳已超過 90 秒沒有進度，已自動中止。請改用較穩定的 Wi-Fi，或裁短影片後再試。');
        return;
      }
      target.innerHTML = unavailableCard('巡檢影片上傳失敗（連線異常），未確認建立任何工作。', error.message);
    }
  });

  // FOUR_SIDE_HOVER：正式走 /api/v1/vision/hover-video（後端抽幀 + 分析）。
  // 2026-11-01 起此流程移至「歷史／擴充檢測」區，不再是本頁正式入口。
  $('#hoverButton').addEventListener('click', async () => {
    const file = $('#hoverInput').files[0];
    const client = window.FdeVisionClient;
    if (!file) {
      if (assessDevMode()) {
        $('#hoverResult').innerHTML = renderHoverResult(simulateHoverAssessment('demo-hover-test.mp4')) + devOnlyNotice();
        return;
      }
      $('#hoverResult').innerHTML = unavailableCard('請先上傳四面懸停影片；若已上傳仍無法分析，請稍後再試或聯絡教師。');
      return;
    }

    $('#hoverResult').innerHTML = '<article class="result-card"><p>正在執行 AI 四面懸停分析...</p></article>';
    try {
      const fileData = await fileToDataUrl(file);
      const result = await client.hoverAnalyze({
        base: visionApiBase(),
        fileDataUrl: fileData,
        fileName: file.name,
      });
      $('#hoverResult').innerHTML = renderHoverResult(result);
    } catch (error) {
      if (assessDevMode()) {
        $('#hoverResult').innerHTML = renderHoverResult(simulateHoverAssessment(file.name)) + devOnlyNotice(error.message);
        return;
      }
      $('#hoverResult').innerHTML = unavailableCard(error.message, error.detail);
    }
  });
}

// 手機導航預設收合；選取任何入口後回到內容畫面。
function bindMobileMenu() {
  const toggle = document.getElementById('mobileMenuToggle');
  const menu = document.getElementById('mobileMenu');
  const backdrop = document.getElementById('mobileMenuBackdrop');
  const closeButton = document.getElementById('mobileMenuClose');
  if (!toggle || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('mobile-menu-open', open);
    if (backdrop) backdrop.hidden = !open;
    if (open) {
      document.body.style.overflow = 'hidden';
      return;
    }
    document.body.style.overflow = '';
    // 換頁後把入口群組收回預設狀態，避免下次開選單還留著上一頁展開的痕跡。
    const portalGroup = document.getElementById('mobilePortalGroup');
    if (portalGroup) portalGroup.open = false;
  };

  toggle.addEventListener('click', () => setOpen(menu.hidden));
  closeButton?.addEventListener('click', () => setOpen(false));
  backdrop?.addEventListener('click', () => setOpen(false));
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) setOpen(false);
  });
  // 回到桌面寬度時抽屜一定不存在，避免殘留 body overflow:hidden 鎖住捲動。
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && !menu.hidden) setOpen(false);
  });
}

// 右上角功能入口：手機收成下拉；登入後沿用伺服器渲染的登出表單。
function bindPortalMenu() {
  const toggle = document.getElementById('portalMenuToggle');
  const menu = document.getElementById('portalMenu');
  if (!toggle || !menu) return;

  const logout = document.querySelector('.fde-public-links form');
  if (logout) menu.append(logout.cloneNode(true));

  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !event.target.closest('#portalMenu')) setOpen(false);
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}

renderNavigation();
renderHero();
renderDataFlow();
renderStageGuides();
renderModes();
renderStudentDashboard();
renderLearningPath();
renderMissionMap();
renderCohorts();
renderLearningResources();
renderFdeColumn();
renderPracticeResources();
renderBuildWorkflow();
renderBuildMain12Entry();
renderVoiceAssistantPanel();
renderAssessmentWorkflows();
renderTeacherDashboard();
renderCertificationChecklist();
bindActions();
bindMobileMenu();
bindPortalMenu();
syncViewFromLocation();
})();
