(() => {
const {
  hero,
  designSystem,
  moduleSections,
  platformModes,
  missionPacks,
  learningPath,
  studentDashboard,
  learningTracks,
  practiceResources,
  buildWorkflow,
  assessmentWorkflows,
  teacherDashboard,
  certificationChecklist,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  simulateHoverAssessment
} = window.FdePlatform;

const $ = (selector) => document.querySelector(selector);
const localYoloEndpoint = 'http://127.0.0.1:8765/api/detect';

function statusClass(status) {
  return String(status).toLowerCase().replaceAll(' ', '-').replaceAll('／', '-').replaceAll('_', '-');
}

function renderNavigation() {
  $('#moduleNav').innerHTML = moduleSections
    .map((section) => `<a href="#${section.key}"><span>${section.label}</span>${section.title}</a>`)
    .join('');
}

function renderHero() {
  $('#heroHeadline').textContent = hero.headline;
  $('#heroSummary').textContent = hero.summary;
  $('#heroSystems').innerHTML = hero.systems.map((system) => `<span>${system}</span>`).join('');
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

function renderMissions() {
  $('#missionGrid').innerHTML = missionPacks
    .map(
      (mission) => `
        <article class="mission-card ${statusClass(mission.status)}">
          <div class="section-head">
            <span class="mission-code">${mission.code}</span>
            <span class="status ${statusClass(mission.status)}">${mission.status}</span>
          </div>
          <h3>${mission.title}</h3>
          <p>${mission.focus}</p>
          <small>核心成果：${mission.outcome}</small>
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
  `;
  $('#buildStages').innerHTML = buildWorkflow.stages
    .map((stage, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${stage}</li>`)
    .join('');
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
  return `
    <article class="result-card inspection-result">
      <div class="scan-preview yolo-preview">
        ${result.annotatedImage ? `<img src="${result.annotatedImage}" alt="YOLOv8 檢測結果" />` : '<div class="scan-line"></div><span>YOLO RESULT</span>'}
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
          ${result.checklist
            .map((item) => `<div><span>${item.label}</span><strong class="${statusClass(item.result)}">${item.result}</strong><small>${item.detail || ''}</small></div>`)
            .join('')}
        </div>
        <div class="detection-list">
          ${result.detections.map((item) => `<small>${item.label} · ${(item.confidence * 100).toFixed(1)}%</small>`).join('')}
        </div>
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
  document.querySelectorAll('[data-track-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.track-card');
      const expanded = card.classList.toggle('is-expanded');
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? '收合' : `展開全部 ${card.querySelectorAll('.lesson-list a').length} 個`;
    });
  });

  $('#assistantButton').addEventListener('click', () => {
    $('#assistantResult').innerHTML = renderAssistantResult(simulateBuildAssistant($('#assistantQuestion').value));
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

  $('#hoverButton').addEventListener('click', () => {
    const fileName = $('#hoverInput').files[0]?.name || 'demo-hover-test.mp4';
    $('#hoverResult').innerHTML = renderHoverResult(simulateHoverAssessment(fileName));
  });
}

renderNavigation();
renderHero();
renderDataFlow();
renderModes();
renderStudentDashboard();
renderLearningPath();
renderMissions();
renderLearningResources();
renderPracticeResources();
renderBuildWorkflow();
renderAssessmentWorkflows();
renderTeacherDashboard();
renderCertificationChecklist();
bindActions();
})();
