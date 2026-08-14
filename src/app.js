const {
  modules,
  buildStages,
  certificationItems,
  simulatePhotoAssessment,
  simulateHoverAssessment
} = window.FdePlatform;

const moduleNav = document.querySelector('#moduleNav');
const moduleCards = document.querySelector('#moduleCards');
const buildTimeline = document.querySelector('#buildTimeline');
const certificationList = document.querySelector('#certificationList');
const photoInput = document.querySelector('#photoInput');
const videoInput = document.querySelector('#videoInput');
const photoButton = document.querySelector('#photoButton');
const videoButton = document.querySelector('#videoButton');
const photoResult = document.querySelector('#photoResult');
const videoResult = document.querySelector('#videoResult');

function statusClass(status) {
  return String(status).toLowerCase().replaceAll('_', '-');
}

function renderModules() {
  moduleNav.innerHTML = modules
    .map((module) => `<a href="#${module.key}"><span>${module.label}</span>${module.title}</a>`)
    .join('');

  moduleCards.innerHTML = modules
    .map(
      (module) => `
        <article class="module-card" id="${module.key}">
          <span class="module-label">${module.label}</span>
          <h3>${module.title}</h3>
          <p>${module.summary}</p>
          <ul>${module.items.map((item) => `<li>${item}</li>`).join('')}</ul>
        </article>
      `
    )
    .join('');
}

function renderBuildStages() {
  buildTimeline.innerHTML = buildStages
    .map(
      (stage, index) => `
        <article class="stage">
          <div class="stage-number">${String(index + 1).padStart(2, '0')}</div>
          <div>
            <div class="stage-head">
              <h3>${stage.title}</h3>
              <span class="status ${statusClass(stage.status)}">${stage.status}</span>
            </div>
            <p>${stage.detail}</p>
          </div>
        </article>
      `
    )
    .join('');
}

function renderCertificationItems() {
  certificationList.innerHTML = certificationItems
    .map((item) => `<div class="evidence-item"><span></span>${item}</div>`)
    .join('');
}

function renderPhotoResult(result) {
  return `
    <article class="assessment-card">
      <div class="stage-head">
        <h3>${result.fileName}</h3>
        <span class="status ${statusClass(result.status)}">${result.status}</span>
      </div>
      <p>${result.summary}</p>
      <div class="finding-list">
        ${result.findings
          .map(
            (finding) => `
              <div>
                <strong>${finding.label}</strong>
                <span class="status ${statusClass(finding.result)}">${finding.result}</span>
                <p>${finding.detail}</p>
              </div>
            `
          )
          .join('')}
      </div>
      <small>${result.nextStep}</small>
    </article>
  `;
}

function renderVideoResult(result) {
  return `
    <article class="assessment-card">
      <div class="score-ring">${result.totalScore}</div>
      <h3>${result.fileName}</h3>
      <p>${result.summary}</p>
      <div class="score-grid">
        <span>水平穩定 <strong>${result.scores.horizontalStability}/40</strong></span>
        <span>高度控制 <strong>${result.scores.verticalStability}/20</strong></span>
        <span>四面完成 <strong>${result.scores.sideCompletion}/25</strong></span>
        <span>連續穩定 <strong>${result.scores.continuity}/15</strong></span>
      </div>
      <small>${result.recommendation}</small>
    </article>
  `;
}

photoButton.addEventListener('click', () => {
  const fileName = photoInput.files[0]?.name || 'demo-f450-photo.jpg';
  photoResult.innerHTML = renderPhotoResult(simulatePhotoAssessment(fileName));
});

videoButton.addEventListener('click', () => {
  const fileName = videoInput.files[0]?.name || 'demo-four-side-hover.mp4';
  videoResult.innerHTML = renderVideoResult(simulateHoverAssessment(fileName));
});

renderModules();
renderBuildStages();
renderCertificationItems();
