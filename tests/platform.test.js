import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
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
  youtubeVideos,
  learningTrackPreviewCount,
  learningTracks,
  learningResources,
  practiceResources,
  buildWorkflow,
  voiceAssistant,
  ragKnowledgeBase,
  assessmentWorkflows,
  teacherDashboard,
  certificationChecklist,
  searchKnowledgeBase,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  simulateHoverAssessment,
  calculateProgress
} from '../src/platform.js';

test('defines the five main sidebar modules as learn practice build assess certify', () => {
  assert.deepEqual(moduleSections.map((section) => section.key), ['learn', 'practice', 'build', 'inspection', 'certify']);
  assert.deepEqual(moduleSections.map((section) => section.label), ['學', '練', '作', '測', '證']);
  assert.ok(moduleSections.every((section) => section.goal && section.goal.length > 8));
  assert.deepEqual(moduleSections.map((section) => section.title), [
    '課程影片與下載說明',
    '模擬器與考照練習',
    'F450 組裝與 AI 助教',
    '鷹眼 AI 檢測中心',
    'GitHub 成果存證'
  ]);
  assert.match(moduleSections.find((section) => section.label === '測').summary, /F450|槳葉|四面懸停/);
  assert.doesNotMatch(moduleSections.find((section) => section.label === '測').title, /考試題庫/);
});

test('defines a boot hero for an AI vehicle learning control center', () => {
  assert.equal(hero.name, 'fde-ai');
  assert.equal(hero.headline, 'FDE-AI 無人載具學習平台');
  assert.match(hero.summary, /學・練・作・測・證/);
  assert.deepEqual(hero.systems, ['AI 驅動雙師教學系統', '鷹眼 AI 評測系統']);
  assert.deepEqual(hero.systemStatus.map((item) => item.label), ['YOLO v2', '四面懸停', 'RAG 知識庫']);
  assert.ok(hero.systemStatus.find((item) => item.label === 'YOLO v2').detail.includes('CW/CCW'));
  assert.deepEqual(hero.actions.map((action) => action.label), ['進入學習平台', '觀看系統 Demo']);
  assert.deepEqual(hero.actions.map((action) => action.target), ['#learn', '#inspection']);
  assert.equal(hero.showMotionStrip, false);
});

test('defines the requested visual system and motion limits', () => {
  assert.equal(designSystem.visualMetaphor, '未來實驗室＋無人機地面站＋AI 教學控制台');
  assert.equal(designSystem.palette.background, '#07111F');
  assert.equal(designSystem.palette.primaryBlue, '#168BFF');
  assert.equal(designSystem.palette.cyan, '#00C2FF');
  assert.equal(designSystem.motion.length, 6);
  assert.ok(designSystem.motion.includes('文字光暈與卡片浮起'));
  assert.ok(designSystem.motion.includes('學練作測證節點呼吸與進度流光'));
  assert.ok(designSystem.motion.includes('AI 檢測掃描線'));
  assert.ok(designSystem.avoid.includes('過度霓虹'));
});

test('defines public, student, and teacher modes with distinct navigation', () => {
  assert.deepEqual(platformModes.map((mode) => mode.key), ['public', 'student', 'teacher']);
  assert.ok(platformModes.find((mode) => mode.key === 'student').nav.includes('AI 檢測'));
  assert.ok(platformModes.find((mode) => mode.key === 'teacher').nav.includes('待復核'));
});

test('defines a four-stage mission map with twelve data-driven tasks', () => {
  assert.deepEqual(missionStages.map((stage) => stage.id), ['explore', 'build', 'ai', 'project']);
  assert.deepEqual(missionStages.map((stage) => stage.title), ['探索者 Explore', '工程者 Build', 'AI Engineer', 'Project Engineer']);
  assert.deepEqual(workflowSteps.map((step) => step.key), ['learn', 'practice', 'build', 'assess', 'certify']);
  assert.deepEqual(workflowSteps.map((step) => step.label), ['學', '練', '作', '測', '證']);

  assert.equal(missionTasks.length, 12);
  assert.deepEqual(missionTasks.map((task) => task.id), ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12']);
  assert.deepEqual(
    missionStages.map((stage) => missionTasks.filter((task) => task.stage === stage.id).length),
    [3, 3, 3, 3]
  );

  for (const task of missionTasks) {
    assert.ok(task.title);
    assert.ok(task.subtitle);
    assert.ok(task.description);
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(task.difficulty));
    assert.ok(task.suitableFor.length > 0);
    for (const step of workflowSteps) {
      assert.ok(task[step.key], `${task.id} missing ${step.key}`);
      assert.ok(task[step.key].title);
      assert.ok(task[step.key].description);
    }
  }

  const m04 = missionTasks.find((task) => task.id === 'M04');
  assert.equal(m04.title, 'F450 工程組裝');
  assert.match(m04.assess.description, /YOLO|CW|CCW/);
});

test('mission packs remain compatible while deriving from the new task map', () => {
  assert.equal(missionPacks.length, 12);
  assert.equal(missionPacks[0].code, 'M01');
  assert.equal(missionPacks[11].title, 'Capstone 綜合工程項目');
  assert.equal(missionPacks.find((mission) => mission.code === 'M06').title, 'Mission Planner 航線任務');
  assert.equal(missionPacks.find((mission) => mission.code === 'M10').status, 'optional');
});

test('defines static alumni cohorts without requiring login or database features', () => {
  assert.ok(cohorts.length >= 1);
  assert.equal(cohorts[0].id, 'cohort-001');
  assert.ok(cohorts[0].learnedTasks.includes('M04'));
  assert.ok(cohorts[0].githubUrl.startsWith('https://github.com/'));
  assert.ok(cohorts.every((cohort) => !('studentAccounts' in cohort)));
});

test('cohort showcase publishes the 2026 FDE-AI training and pre-employment videos', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const firstCohort = cohorts[0];

  assert.equal(firstCohort.showcaseVideos.length, 7);
  assert.deepEqual(
    firstCohort.showcaseVideos.map((video) => video.phase),
    ['01', '02', '03', '04', '05', '06', '職前']
  );
  assert.equal(firstCohort.showcaseVideos[0].title, '2026FDE-Ai無人載具人才孵化平台在職培訓01期');
  assert.equal(firstCohort.showcaseVideos[0].url, 'https://www.youtube.com/shorts/r6O-z1nxFfo');
  assert.ok(firstCohort.showcaseVideos.some((video) => video.title.includes('職前教育')));
  assert.ok(firstCohort.showcaseVideos.some((video) => video.url.endsWith('oXK6lE6KFmI')));
  assert.ok(firstCohort.showcaseVideos.every((video) => video.url.startsWith('https://www.youtube.com/')));
  assert.match(app, /showcaseVideos/);
  assert.match(app, /class="cohort-video-grid"/);
  assert.match(css, /\.cohort-video-grid/);
});

test('defines a learning path from soccer drone to integrated projects', () => {
  assert.deepEqual(learningPath.map((node) => node.title), [
    '足球無人機',
    '模擬器',
    'F450',
    '自主航線',
    'AI',
    '3D',
    '智慧城市',
    '綜合項目'
  ]);
  assert.ok(learningPath.filter((node) => node.state === 'complete').length >= 3);
});

test('student dashboard shows a current mission and five-stage progress', () => {
  assert.equal(studentDashboard.greeting, '早安，張同學');
  assert.equal(studentDashboard.stats.find((stat) => stat.label === '本週任務').value, '4/6');
  assert.equal(studentDashboard.currentMission.code, 'M06');
  assert.deepEqual(studentDashboard.currentMission.progress.map((step) => step.label), ['學', '練', '作', '測', '證']);
  assert.equal(studentDashboard.currentMission.progress.find((step) => step.state === 'active').label, '測');
});

test('learn section groups the MVP curriculum and all provided YouTube videos', () => {
  assert.equal(learningTrackPreviewCount, 2);
  assert.equal(youtubeVideos.length, 34);
  assert.equal(new Set(youtubeVideos.map((video) => video.url)).size, 34);
  assert.equal(youtubeVideos[0].title, '多旋翼F450&px2.4.8飛控&mp地面站設置說明');
  assert.equal(youtubeVideos[0].sourceType, '開源生態');
  assert.equal(youtubeVideos[2].title, '多旋翼F450&dji naza組裝步驟');
  assert.equal(youtubeVideos[2].sourceType, '閉源/專有');
  assert.deepEqual(learningTracks.map((track) => track.key), [
    'f450',
    'phoenix',
    'license',
    'ai',
    'printing3d',
    'github'
  ]);
  assert.ok(learningTracks.find((track) => track.key === 'f450').items.some((item) => item.title.toLowerCase().includes('dji naza')));
  assert.ok(learningTracks.find((track) => track.key === 'f450').items.some((item) => item.title.includes('px2.4.8')));
  assert.equal(learningTracks.find((track) => track.key === 'printing3d').items.length, 16);
  assert.ok(learningTracks.every((track) => track.previewCount === learningTrackPreviewCount));
  assert.ok(learningTracks.filter((track) => track.items.length > learningTrackPreviewCount).length >= 3);
  assert.ok(learningResources.some((resource) => resource.type === 'youtube' && resource.url.includes('youtu.be')));
  assert.ok(learningResources.some((resource) => resource.title.includes('GitHub')));
});

test('practice section focuses on Phoenix simulator and license practice', () => {
  assert.ok(practiceResources.some((resource) => resource.category === 'phoenix-simulator'));
  assert.ok(practiceResources.some((resource) => resource.category === 'license-simulator'));
  assert.ok(practiceResources.some((resource) => resource.category === 'question-bank'));
  assert.ok(practiceResources.every((resource) => resource.url.startsWith('https://')));
  assert.equal(practiceResources.find((resource) => resource.category === 'license-simulator').url, 'https://drone-quiz.tw/');
  assert.equal(practiceResources.find((resource) => resource.category === 'question-bank').url, 'https://www.caa.gov.tw/Article.aspx?a=3833');
  assert.ok(practiceResources.some((resource) => resource.steps.length >= 3));
});

test('build workflow is a v1 upload-only Pixhawk 2.4.8 assembly flow', () => {
  assert.equal(buildWorkflow.version, '1.0');
  assert.equal(buildWorkflow.controller, 'Pixhawk 2.4.8');
  assert.equal(buildWorkflow.interactionMode, 'upload-only');
  assert.ok(buildWorkflow.evidenceTypes.includes('photo'));
  assert.ok(buildWorkflow.evidenceTypes.includes('30-second-video'));
  assert.ok(buildWorkflow.stages.length >= 6);
  assert.ok(buildWorkflow.stages.some((stage) => stage.includes('電池')));
});

test('build assistant returns a local RAG-only answer', () => {
  assert.ok(ragKnowledgeBase.length >= 4);
  assert.ok(ragKnowledgeBase.some((entry) => entry.sourcePath.includes('E:\\F450素材')));

  const localHits = searchKnowledgeBase('電池怎麼充電');
  assert.equal(localHits[0].title, '無人機充電器使用說明');

  const result = simulateBuildAssistant('電池怎麼充電');
  assert.equal(result.mode, 'local-rag-only');
  assert.equal(result.sourceStatus, 'local-rag');
  assert.ok(result.sources.some((source) => source.title === '無人機充電器使用說明'));
  assert.match(result.answer, /RAG|知識庫/);
  assert.match(result.voiceStatus, /RAG-only|本機/);

  const fallback = simulateBuildAssistant('完全不相關的太空電梯問題');
  assert.equal(fallback.mode, 'local-rag-only');
  assert.equal(fallback.sourceStatus, 'knowledge-missing');
});

test('voice assistant is configured for zh-TW click-to-start RAG-first flow', () => {
  const browserData = readFileSync(new URL('../src/platform-browser.js', import.meta.url), 'utf8');

  assert.equal(voiceAssistant.locale, 'zh-TW');
  assert.equal(voiceAssistant.interactionMode, 'click-start-click-stop');
  assert.equal(voiceAssistant.ragFirst, true);
  assert.equal(voiceAssistant.knowledgeBaseDir, 'E:\\FDE_AI_Voice_RAG\\knowledge_base');
  assert.deepEqual(voiceAssistant.controls.map((control) => control.label), ['開始語音提問', '停止']);
  assert.match(voiceAssistant.safetyInstruction, /老師確認|停機檢查|台灣繁中/);
  assert.match(browserData, /const voiceAssistant/);
  assert.match(browserData, /voiceAssistant/);
});

test('propeller assessment simulates YOLOv8 CW and CCW checks', () => {
  const result = simulatePropellerAssessment('propeller-check.jpg');
  assert.equal(result.type, 'propeller-photo');
  assert.equal(result.engine, 'YOLOv8 placeholder');
  assert.equal(result.detections.length, 4);
  assert.deepEqual(result.motorChecks.map((check) => check.motor), ['M3', 'M1', 'M2', 'M4']);
  assert.ok(result.motorChecks.every((check) => ['PASS', 'NG', 'CHECK'].includes(check.result)));
  assert.ok(result.motorChecks.every((check) => ['CW', 'CCW'].includes(check.expectedDirection)));
  assert.ok(result.motorChecks.some((check) => check.result === 'NG'));
  assert.ok(result.detections.some((detection) => detection.className === 'cw_propeller'));
  assert.ok(result.detections.some((detection) => detection.className === 'ccw_propeller'));
});

test('YOLO result layout exposes M1-M4 pass cards and RAG guidance instead of score-first output', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(app, /class="inspection-summary-panel"/);
  assert.match(app, /motor-check-grid/);
  assert.match(app, /inspection-final-result/);
  assert.match(app, /data-inspection-assistant/);
  assert.match(app, /appendInspectionKnowledgeAnswer/);
  assert.match(app, /renderDetectionImage/);
  assert.match(app, /inputImage/);
  assert.match(app, /檢測圖片/);
  assert.match(app, /class="stage-guide"/);
  assert.match(app, /M1|M2|M3|M4/);
  assert.match(app, /Expected|Detected|Blade Face|Confidence|PASS|NG|CHECK/);
  assert.match(app, /AI 修正建議|FDE 知識庫|知識庫依據不足/);
  assert.match(app, /class="[^"]*inspection-visual-panel[^"]*"/);
  assert.doesNotMatch(app, /AI 初判分數/);
  assert.match(css, /\.inspection-result\s*{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.inspection-summary-panel\s*{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.result-file-name\s*{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.motor-check-grid/s);
  assert.match(css, /\.motor-check\.pass/s);
  assert.match(css, /\.motor-check\.ng/s);
  assert.match(css, /\.motor-check\.check/s);
  assert.match(css, /\.visual-caption/s);
  assert.doesNotMatch(app, /viewport-toolbar|data-pan-zoom|bindPanZoom/);
});

test('YOLO backend returns motor mapping fields for F450 propeller inspection', () => {
  const server = readFileSync(new URL('../api/yolo_server.py', import.meta.url), 'utf8');

  assert.match(server, /EXPECTED_PROPELLER_BY_POSITION/);
  assert.match(server, /motorChecks/);
  assert.match(server, /DIRECTION_ERROR|NOT_DETECTED|UNCERTAIN/);
  assert.match(server, /"M1": "ccw_propeller"/);
  assert.match(server, /"M2": "ccw_propeller"/);
  assert.match(server, /"M3": "cw_propeller"/);
  assert.match(server, /"M4": "cw_propeller"/);
});

test('voice assistant UI and backend routes use local RAG without OpenAI API keys', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../api/yolo_server.py', import.meta.url), 'utf8');
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

  assert.match(html, /voiceAssistantPanel/);
  assert.match(app, /voiceStartButton/);
  assert.match(app, /voiceStopButton/);
  assert.match(app, /runVoiceAssistantQuestion/);
  assert.match(html + app + server, /RAG-only|local-rag-only|本機 RAG/);
  assert.match(server, /\/api\/voice\/health/);
  assert.match(server, /\/api\/voice\/ask/);
  assert.match(server, /search_voice_knowledge_base/);
  assert.doesNotMatch(server, /api\.openai\.com|_ask_openai|urllib\.request|FDE_VOICE_MODEL/);
  assert.match(gitignore, /^\.env$/m);
  assert.ok(existsSync(new URL('../.env.example', import.meta.url)));
  assert.doesNotMatch(app + html + server + envExample, /OPENAI_API_KEY\s*=/);
});

test('voice assistant exposes a pause and resume control for answer playback', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /id="voicePauseButton"/);
  assert.match(html, /暫停播報/);
  assert.match(app, /toggleVoicePlayback/);
  assert.match(app, /speechSynthesis\.pause/);
  assert.match(app, /speechSynthesis\.resume/);
});

test('Streamlit deployment entry wraps the static website without backend secrets', () => {
  const streamlitAppUrl = new URL('../streamlit_app.py', import.meta.url);
  const requirementsUrl = new URL('../requirements.txt', import.meta.url);

  assert.ok(existsSync(streamlitAppUrl));
  assert.ok(existsSync(requirementsUrl));

  const streamlitApp = readFileSync(streamlitAppUrl, 'utf8');
  const requirements = readFileSync(requirementsUrl, 'utf8');

  assert.match(streamlitApp, /streamlit\.components\.v1/);
  assert.match(streamlitApp, /components\.html/);
  assert.match(streamlitApp, /index\.html/);
  assert.match(streamlitApp, /src\/styles\.css/);
  assert.match(streamlitApp, /src\/platform-browser\.js/);
  assert.match(streamlitApp, /src\/app\.js/);
  assert.match(requirements, /^streamlit\b/m);
  assert.doesNotMatch(streamlitApp + requirements, /OPENAI_API_KEY\s*=/);
});

test('HTML app renders the mission map, task detail workflow, and alumni sections', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const browserData = readFileSync(new URL('../src/platform-browser.js', import.meta.url), 'utf8');

  assert.match(html, /missionStageMap/);
  assert.match(html, /taskDetailPanel/);
  assert.match(html, /cohortGrid/);
  assert.match(app, /renderMissionMap/);
  assert.match(app, /renderTaskDetail/);
  assert.match(app, /localStorage/);
  assert.match(browserData, /missionStages/);
  assert.match(browserData, /missionTasks/);
  assert.match(browserData, /cohorts/);
});

test('assess section only exposes F450 propeller inspection and four-side hover scoring', () => {
  assert.deepEqual(assessmentWorkflows.map((workflow) => workflow.key), ['propeller-inspection', 'hover-scoring']);
  assert.ok(assessmentWorkflows[0].acceptedEvidence.includes('photo'));
  assert.ok(assessmentWorkflows[0].checks.some((check) => check.includes('槳葉')));
  assert.ok(assessmentWorkflows[0].checks.some((check) => check.includes('M1')));
  assert.ok(assessmentWorkflows[0].checks.some((check) => check.includes('M4')));
  assert.ok(assessmentWorkflows[1].title.includes('四面懸停'));
  assert.ok(assessmentWorkflows.every((workflow) => !workflow.title.includes('考試題庫')));

  const result = simulateHoverAssessment('hover.mp4');
  assert.equal(result.engine, 'YOLOv8 hover scoring placeholder');
  assert.equal(result.score, 82);
  assert.match(result.teacherReview, /線下老師/);
});

test('F450 inspection page gives the propeller result enough width for M1-M4 cards', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(html, /鷹眼 AI 檢測中心/);
  assert.match(html, /F450 槳葉正反及方向檢查/);
  assert.match(html, /class="panel result-panel propeller-result-panel"/);
  assert.match(css, /\.inspection-layout\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.propeller-result-panel\s*{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(css, /\.propeller-result-panel\s*{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.propeller-result-panel\s+\.inspection-summary-panel\s*{[^}]*overflow-x:\s*visible/s);
  assert.match(css, /\.motor-check dd\s*{[^}]*white-space:\s*nowrap/s);
});

test('teacher dashboard emphasizes review efficiency and AI warnings', () => {
  assert.equal(teacherDashboard.stats.find((stat) => stat.label === '待復核').value, 7);
  assert.ok(teacherDashboard.reviewQueue.some((item) => item.aiResult === 'FAIL'));
  assert.match(teacherDashboard.reviewQueue[0].reason, /槳/);
});

test('certification checklist includes GitHub evidence upload', () => {
  assert.ok(certificationChecklist.some((item) => item.title.includes('GitHub')));
  assert.ok(certificationChecklist.some((item) => item.detail.includes('學習過程')));
});

test('calculates bounded progress percentages', () => {
  assert.equal(calculateProgress(3, 10), 30);
  assert.equal(calculateProgress(20, 10), 100);
  assert.equal(calculateProgress(-1, 10), 0);
});
