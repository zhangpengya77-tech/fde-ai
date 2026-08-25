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
const localYoloEndpoint = 'http://127.0.0.1:8765/api/detect';
const localHoverEndpoint = 'http://127.0.0.1:8765/api/hover';
const localVoiceEndpoint = voiceAssistant.endpoint;
let voiceRecognition = null;
let voiceTranscript = '';
let selectedTaskId = 'M04';

function statusClass(status) {
  return String(status).toLowerCase().replaceAll(' ', '-').replaceAll('／', '-').replaceAll('_', '-');
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
    { key: 'missions', label: '任', title: '12 任務地圖' },
    ...moduleSections,
    { key: 'cohorts', label: '展', title: '歷屆學員成果' },
    { key: 'teacher', label: '師', title: '教師復核中心' }
  ];
  $('#moduleNav').innerHTML = primaryNav
    .map((section) => `<a href="#${section.key}"><span>${section.label}</span>${section.title}</a>`)
    .join('');
}

function renderHero() {
  $('#heroHeadline').textContent = hero.headline;
  $('#heroSummary').textContent = hero.summary;
  $('#heroSystems').innerHTML = `
    ${hero.systems.map((system) => `<span>${system}</span>`).join('')}
    <div class="service-status-panel">
      ${hero.systemStatus
        .map(
          (item) => `
            <div>
              <span>${item.label}</span>
              <strong>${item.state}</strong>
              <small>${item.detail}</small>
            </div>
          `
        )
        .join('')}
    </div>
  `;
  $('#heroActions').innerHTML = hero.actions
    .map((action) => `<a class="${action.kind}-action" href="${action.target}">${action.label}</a>`)
    .join('');

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
    ['作', 'F450 / AI / 3D'],
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
    <a class="primary-action" href="#inspection">${studentDashboard.currentMission.action}</a>
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
                      <span class="status ${statusClass(task.status)}">${task.status}</span>
                    </div>
                    <strong>${task.title}</strong>
                    <small>${task.subtitle}</small>
                    <span class="difficulty">${task.difficulty} · ${task.estimatedHours || '?'}h</span>
                    <span class="workflow-mini">${workflowSteps.map((step) => `<i>${step.label}</i>`).join('')}</span>
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

function renderTaskDetail(taskId) {
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
          <span>${task.estimatedHours || '?'} 小時</span>
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
    .map(
      (cohort) => `
        <article class="cohort-card">
          <span class="tag">${cohort.year} · ${cohort.location || 'FDE-AI'}</span>
          <h3>${cohort.name}</h3>
          <p>${cohort.description}</p>
          <div class="cohort-task-strip">
            ${cohort.learnedTasks.map((taskId) => `<span>${taskId}</span>`).join('')}
          </div>
          <div class="cohort-actions">
            <a href="${cohort.youtubePlaylistUrl}" target="_blank" rel="noreferrer">YouTube 成果</a>
            <a href="${cohort.githubUrl}" target="_blank" rel="noreferrer">GitHub 倉庫</a>
          </div>
        </article>
      `
    )
    .join('');
}

function renderLearningResources() {
  $('#learningResources').innerHTML = learningTracks
    .map((track) => {
      const hiddenCount = Math.max(0, track.items.length - track.previewCount);
      return `
        <article class="track-card" data-track="${track.key}">
          <div class="track-head">
            <span class="tag">${track.key}</span>
            <h3>${track.title}</h3>
            <p>${track.summary}</p>
          </div>
          <div class="lesson-list">
            ${track.items
              .map((item, index) => {
                const collapsedClass = index >= track.previewCount ? 'is-extra' : '';
                return `
                  <a class="${collapsedClass}" href="${item.url}" target="${item.url.startsWith('#') ? '_self' : '_blank'}" rel="noreferrer">
                    <span>${item.sourceType || item.type}</span>
                    <strong>${item.title}</strong>
                    <small>${item.description}</small>
                  </a>
                `;
              })
              .join('')}
          </div>
          ${
            hiddenCount > 0
              ? `<button class="track-toggle" type="button" data-track-toggle="${track.key}" aria-expanded="false">展開全部 ${track.items.length} 個</button>`
              : ''
          }
        </article>
      `;
    })
    .join('');
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
  $('#assessmentWorkflows').innerHTML = assessmentWorkflows
    .map(
      (workflow) => `
        <article class="workflow-card">
          <span class="tag">${workflow.engine}</span>
          <h3>${workflow.title}</h3>
          <p>可上傳：${workflow.acceptedEvidence.join(' / ')}</p>
          <ul>${workflow.checks.map((check) => `<li>${check}</li>`).join('')}</ul>
        </article>
      `
    )
    .join('');
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

function speakVoiceAnswer(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceAssistant.locale;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

async function runVoiceAssistantQuestion(question) {
  const response = await fetch(localVoiceEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  $('#assistantResult').innerHTML = '<article class="result-card"><p>正在先查 RAG 知識庫，再準備台灣繁中回答...</p></article>';
  try {
    const result = await runVoiceAssistantQuestion(topic);
    $('#voiceStatus').textContent = voiceAssistant.statuses.answering;
    $('#assistantResult').innerHTML = renderAssistantResult(result);
    speakVoiceAnswer(result.answer);
    $('#voiceStatus').textContent = voiceAssistant.statuses.idle;
  } catch (error) {
    const fallback = simulateBuildAssistant(topic);
    $('#assistantResult').innerHTML = `
      ${renderAssistantResult(fallback)}
      <article class="result-card local-service-note">
        <h3>本機語音助教尚未連線</h3>
        <p>目前先用前端 MVP 模擬回答。請確認本機 API 服務已啟動，且 .env 已設定 OPENAI_API_KEY。</p>
        <small>${error.message}</small>
      </article>
    `;
    speakVoiceAnswer(fallback.answer);
    $('#voiceStatus').textContent = '本機語音助教未連線，已顯示 MVP 模擬回答';
  }
}

function renderAssemblyResult(result) {
  return `
    <article class="result-card inspection-result">
      <div class="scan-preview">
        <div class="scan-line"></div>
        <span>F450 TOP VIEW</span>
      </div>
      <div>
        <div class="section-head">
          <span class="tag">${result.engine}</span>
          <span class="status ${statusClass(result.status)}">${result.status}</span>
        </div>
        <h3>${result.fileName}</h3>
        <p>${result.summary}</p>
        <div class="score-row"><strong>${result.score}</strong><span>AI 初判分數</span><em>${result.teacherStatus}</em></div>
        <div class="check-grid">
          ${result.checklist.map((item) => `<div><span>${item.label}</span><strong class="${statusClass(item.result)}">${item.result}</strong></div>`).join('')}
        </div>
      </div>
    </article>
  `;
}

function renderYoloAssemblyResult(result) {
  const fileName = escapeHtml(result.fileName || '未命名檢測檔案');
  const checklist = Array.isArray(result.checklist) ? result.checklist : [];
  const detections = Array.isArray(result.detections) ? result.detections : [];
  return `
    <article class="result-card inspection-result yolo-result">
      <div class="inspection-summary-panel">
        <div class="section-head">
          <span class="tag">${escapeHtml(result.engine)}</span>
          <span class="status ${statusClass(result.status)}">${result.status}</span>
        </div>
        <div class="service-status-panel compact">
          <div>
            <span>YOLO v2 local</span>
            <strong>本機模型</strong>
            <small>CW 正槳 / CCW 反槳：先由 AI 辨識，再依機頭方向人工複核。</small>
          </div>
          <div>
            <span>結果閱讀</span>
            <strong>橫向資訊列</strong>
            <small>長檔名、零件清單與信心度可左右滑動查看，不會擠成一團。</small>
          </div>
        </div>
        <h3 class="result-file-name" title="${fileName}">${fileName}</h3>
        <p>${escapeHtml(result.summary)}</p>
        <div class="inspection-hints">
          <small>目前模型重點：槳葉、馬達、機臂與主機板等可見零件。</small>
          <small>判定提醒：CW / CCW 只代表槳葉類型，是否裝對位置仍要搭配 F450 機頭方向確認。</small>
        </div>
        <div class="score-row"><strong>${result.score}</strong><span>AI 初判分數</span><em>${result.teacherStatus}</em></div>
        <div class="check-grid">
          ${checklist
            .map(
              (item) =>
                `<div><span>${escapeHtml(item.label)}</span><strong class="${statusClass(item.result)}">${escapeHtml(item.result)}</strong><small>${escapeHtml(item.detail || '')}</small></div>`
            )
            .join('')}
        </div>
        <div class="detection-list">
          ${detections
            .map((item) => {
              const confidence = Number.isFinite(item.confidence) ? `${(item.confidence * 100).toFixed(1)}%` : '待確認';
              return `<small>${escapeHtml(item.label)} · ${confidence}</small>`;
            })
            .join('')}
        </div>
      </div>
      <div class="scan-preview yolo-preview inspection-visual-panel">
        ${result.annotatedImage ? `<img src="${result.annotatedImage}" alt="YOLOv8 檢測結果" />` : '<div class="scan-line"></div><span>YOLO RESULT</span>'}
      </div>
    </article>
  `;
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
  return payload.result;
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
          <a href="#inspection">${item.action}</a>
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
  document.querySelectorAll('[data-task-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTaskId = button.dataset.taskId;
      renderTaskDetail(selectedTaskId);
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

  $('#voiceStartButton').addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $('#voiceStatus').textContent = voiceAssistant.statuses.unsupported;
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
      $('#voiceStartButton').disabled = false;
      $('#voiceStopButton').disabled = true;
    });

    voiceRecognition.start();
    $('#voiceStartButton').disabled = true;
    $('#voiceStopButton').disabled = false;
    $('#voiceStatus').textContent = voiceAssistant.statuses.listening;
  });

  $('#voiceStopButton').addEventListener('click', () => {
    if (voiceRecognition) {
      voiceRecognition.stop();
      voiceRecognition = null;
    }
    $('#voiceStartButton').disabled = false;
    $('#voiceStopButton').disabled = true;
    askAssistantFromText($('#assistantQuestion').value || voiceTranscript);
  });

  $('#propellerButton').addEventListener('click', async () => {
    const file = $('#propellerInput').files[0];
    if (!file) {
      $('#propellerResult').innerHTML = renderAssemblyResult(simulatePropellerAssessment('demo-f450-check.jpg'));
      return;
    }

    $('#propellerResult').innerHTML = '<article class="result-card"><p>正在連接本機 YOLOv8 模型並執行檢測...</p></article>';
    try {
      const result = await runLocalYoloDetection(file);
      $('#propellerResult').innerHTML = renderYoloAssemblyResult(result);
    } catch (error) {
      $('#propellerResult').innerHTML = `
        ${renderAssemblyResult(simulatePropellerAssessment(file.name))}
        <article class="result-card local-service-note">
          <h3>本機模型尚未連線</h3>
          <p>請先啟動 YOLO 偵測服務；目前畫面先顯示 MVP 模擬結果。</p>
          <small>${error.message}</small>
        </article>
      `;
    }
  });

  $('#hoverButton').addEventListener('click', async () => {
    const file = $('#hoverInput').files[0];
    if (!file) {
      $('#hoverResult').innerHTML = renderHoverResult(simulateHoverAssessment('demo-hover-test.mp4'));
      return;
    }

    $('#hoverResult').innerHTML = '<article class="result-card"><p>正在連接本機四面懸停模型並執行評分...</p></article>';
    try {
      const result = await runLocalHoverScoring(file);
      $('#hoverResult').innerHTML = renderHoverResult(result);
    } catch (error) {
      $('#hoverResult').innerHTML = `
        ${renderHoverResult(simulateHoverAssessment(file.name))}
        <article class="result-card local-service-note">
          <h3>本機四面懸停模型尚未連線</h3>
          <p>請先啟動本機 AI 服務；目前畫面先顯示 MVP 模擬結果。</p>
          <small>${error.message}</small>
        </article>
      `;
    }
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
renderPracticeResources();
renderBuildWorkflow();
renderVoiceAssistantPanel();
renderAssessmentWorkflows();
renderTeacherDashboard();
renderCertificationChecklist();
bindActions();
})();
