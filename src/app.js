const {
  hero,
  moduleSections,
  learningTracks,
  practiceResources,
  buildWorkflow,
  assessmentWorkflows,
  certificationChecklist,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  simulateHoverAssessment
} = window.FdePlatform;

const moduleNav = document.querySelector('#moduleNav');
const heroHeadline = document.querySelector('#heroHeadline');
const heroSummary = document.querySelector('#heroSummary');
const learningResourcesEl = document.querySelector('#learningResources');
const practiceResourcesEl = document.querySelector('#practiceResources');
const buildStagesEl = document.querySelector('#buildStages');
const assistantQuestion = document.querySelector('#assistantQuestion');
const assistantButton = document.querySelector('#assistantButton');
const assistantResult = document.querySelector('#assistantResult');
const propellerInput = document.querySelector('#propellerInput');
const propellerButton = document.querySelector('#propellerButton');
const propellerResult = document.querySelector('#propellerResult');
const hoverInput = document.querySelector('#hoverInput');
const hoverButton = document.querySelector('#hoverButton');
const hoverResult = document.querySelector('#hoverResult');
const assessmentWorkflowsEl = document.querySelector('#assessmentWorkflows');
const certificationChecklistEl = document.querySelector('#certificationChecklist');

function statusClass(status) {
  return String(status).toLowerCase().replaceAll('_', '-');
}

function renderNavigation() {
  moduleNav.innerHTML = moduleSections
    .map((section) => `<a href="#${section.key}"><span>${section.label}</span>${section.title}</a>`)
    .join('');
}

function renderHero() {
  heroHeadline.textContent = hero.headline;
  heroSummary.textContent = hero.summary;
  document.querySelector('#heroSystems').innerHTML = hero.systems.map((system) => `<span>${system}</span>`).join('');
}

function renderLearningResources() {
  learningResourcesEl.innerHTML = learningTracks
    .map(
      (track) => `
        <article class="track-card">
          <div class="track-head">
            <span class="tag">${track.key}</span>
            <h3>${track.title}</h3>
            <p>${track.summary}</p>
          </div>
          <div class="lesson-list">
            ${track.items
              .map(
                (item) => `
                  <a href="${item.url}" target="${item.url.startsWith('#') ? '_self' : '_blank'}" rel="noreferrer">
                    <span>${item.type}</span>
                    <strong>${item.title}</strong>
                    <small>${item.description}</small>
                  </a>
                `
              )
              .join('')}
          </div>
        </article>
      `
    )
    .join('');
}

function renderPracticeResources() {
  practiceResourcesEl.innerHTML = practiceResources
    .map(
      (resource) => `
        <article class="practice-card">
          <div>
            <span class="tag">${resource.category}</span>
            <h3>${resource.title}</h3>
            <p>${resource.description}</p>
          </div>
          <ol>${resource.steps.map((step) => `<li>${step}</li>`).join('')}</ol>
          <a href="${resource.url}" target="_blank" rel="noreferrer">下載 / 查看</a>
        </article>
      `
    )
    .join('');
}

function renderBuildWorkflow() {
  document.querySelector('#buildMeta').innerHTML = `
    <span>版本 ${buildWorkflow.version}</span>
    <span>${buildWorkflow.controller}</span>
    <span>${buildWorkflow.interactionMode}</span>
  `;
  buildStagesEl.innerHTML = buildWorkflow.stages
    .map((stage, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${stage}</li>`)
    .join('');
}

function renderAssistantResult(result) {
  return `
    <article class="result-card">
      <span class="tag">${result.mode}</span>
      <h3>${result.topic}</h3>
      <p>${result.answer}</p>
      <small>${result.voiceStatus}</small>
    </article>
  `;
}

function renderPropellerResult(result) {
  return `
    <article class="result-card">
      <div class="section-head">
        <div>
          <span class="tag">${result.engine}</span>
          <h3>${result.fileName}</h3>
        </div>
        <span class="status ${statusClass(result.status)}">${result.status}</span>
      </div>
      <p>${result.summary}</p>
      <div class="detection-grid">
        ${result.detections
          .map(
            (detection) => `
              <div>
                <strong>${detection.position}</strong>
                <span>${detection.className}</span>
                <small>confidence ${Math.round(detection.confidence * 100)}%</small>
                <em class="${statusClass(detection.result)}">${detection.result}</em>
              </div>
            `
          )
          .join('')}
      </div>
      <small>${result.nextStep}</small>
    </article>
  `;
}

function renderHoverResult(result) {
  return `
    <article class="result-card">
      <div class="section-head">
        <div>
          <span class="tag">${result.engine}</span>
          <h3>${result.fileName}</h3>
        </div>
        <span class="status pass">${result.score} 分</span>
      </div>
      <p>${result.summary}</p>
      <small>${result.teacherReview}</small>
    </article>
  `;
}

function renderAssessmentWorkflows() {
  assessmentWorkflowsEl.innerHTML = assessmentWorkflows
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

function renderCertificationChecklist() {
  certificationChecklistEl.innerHTML = certificationChecklist
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

assistantButton.addEventListener('click', () => {
  assistantResult.innerHTML = renderAssistantResult(simulateBuildAssistant(assistantQuestion.value));
});

propellerButton.addEventListener('click', () => {
  const fileName = propellerInput.files[0]?.name || 'demo-propeller-check.jpg';
  propellerResult.innerHTML = renderPropellerResult(simulatePropellerAssessment(fileName));
});

hoverButton.addEventListener('click', () => {
  const fileName = hoverInput.files[0]?.name || 'demo-hover-test.mp4';
  hoverResult.innerHTML = renderHoverResult(simulateHoverAssessment(fileName));
});

renderNavigation();
renderHero();
renderLearningResources();
renderPracticeResources();
renderBuildWorkflow();
renderAssessmentWorkflows();
renderCertificationChecklist();
