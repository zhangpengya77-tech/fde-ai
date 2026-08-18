import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hero,
  designSystem,
  moduleSections,
  platformModes,
  missionPacks,
  learningPath,
  studentDashboard,
  youtubeVideos,
  learningTracks,
  learningResources,
  practiceResources,
  buildWorkflow,
  assessmentWorkflows,
  teacherDashboard,
  certificationChecklist,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  simulateHoverAssessment,
  calculateProgress
} from '../src/platform.js';

test('defines the five core control-center pages in order', () => {
  assert.deepEqual(moduleSections.map((section) => section.key), ['home', 'dashboard', 'missions', 'inspection', 'teacher']);
  assert.deepEqual(moduleSections.map((section) => section.title), ['科技展廳', '學生任務控制台', 'Mission Pack', '鷹眼 AI 檢測中心', '教師復核中心']);
});

test('defines a boot hero for an AI vehicle learning control center', () => {
  assert.equal(hero.name, 'fde-ai');
  assert.equal(hero.headline, 'FDE-AI 無人載具學習平台');
  assert.match(hero.summary, /學・練・作・測・證/);
  assert.deepEqual(hero.systems, ['AI 驅動雙師教學系統', '鷹眼 AI 評測系統']);
  assert.deepEqual(hero.actions.map((action) => action.label), ['進入學習平台', '觀看系統 Demo']);
});

test('defines the requested visual system and motion limits', () => {
  assert.equal(designSystem.visualMetaphor, '未來實驗室＋無人機地面站＋AI 教學控制台');
  assert.equal(designSystem.palette.background, '#07111F');
  assert.equal(designSystem.palette.primaryBlue, '#168BFF');
  assert.equal(designSystem.palette.cyan, '#00C2FF');
  assert.equal(designSystem.motion.length, 6);
  assert.ok(designSystem.motion.includes('AI 檢測掃描線'));
  assert.ok(designSystem.avoid.includes('過度霓虹'));
});

test('defines public, student, and teacher modes with distinct navigation', () => {
  assert.deepEqual(platformModes.map((mode) => mode.key), ['public', 'student', 'teacher']);
  assert.ok(platformModes.find((mode) => mode.key === 'student').nav.includes('AI 檢測'));
  assert.ok(platformModes.find((mode) => mode.key === 'teacher').nav.includes('待復核'));
});

test('defines twelve Mission Pack cards from the course outline', () => {
  assert.equal(missionPacks.length, 12);
  assert.equal(missionPacks[0].code, 'M01');
  assert.equal(missionPacks[11].title, '智慧城市＋AI 影音＋搜救應用');
  assert.equal(missionPacks.find((mission) => mission.code === 'M06').title, 'AI 檢測考核 A｜F450 組裝');
  assert.equal(missionPacks.find((mission) => mission.code === 'M10').status, '教師復核');
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
  assert.equal(youtubeVideos.length, 34);
  assert.equal(new Set(youtubeVideos.map((video) => video.url)).size, 34);
  assert.deepEqual(learningTracks.map((track) => track.key), [
    'f450',
    'phoenix',
    'license',
    'ai',
    'printing3d',
    'github'
  ]);
  assert.ok(learningTracks.find((track) => track.key === 'f450').items.some((item) => item.title.includes('DJI NAZA')));
  assert.ok(learningTracks.find((track) => track.key === 'f450').items.some((item) => item.title.includes('Pixhawk 2.4.8')));
  assert.equal(learningTracks.find((track) => track.key === 'printing3d').items.length, 16);
  assert.ok(learningResources.some((resource) => resource.type === 'youtube' && resource.url.includes('youtu.be')));
  assert.ok(learningResources.some((resource) => resource.title.includes('GitHub')));
});

test('practice section focuses on Phoenix simulator and license practice', () => {
  assert.ok(practiceResources.some((resource) => resource.category === 'phoenix-simulator'));
  assert.ok(practiceResources.some((resource) => resource.category === 'license-simulator'));
  assert.ok(practiceResources.some((resource) => resource.category === 'question-bank'));
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

test('build assistant returns a RAG and GPT voice placeholder answer', () => {
  const result = simulateBuildAssistant('槳葉方向看不懂');
  assert.equal(result.mode, 'rag-gpt-voice-placeholder');
  assert.match(result.answer, /RAG|知識庫/);
  assert.match(result.voiceStatus, /預留|尚未/);
});

test('propeller assessment simulates YOLOv8 CW and CCW checks', () => {
  const result = simulatePropellerAssessment('propeller-check.jpg');
  assert.equal(result.type, 'propeller-photo');
  assert.equal(result.engine, 'YOLOv8 placeholder');
  assert.equal(result.detections.length, 4);
  assert.ok(result.detections.some((detection) => detection.className === 'cw_propeller'));
  assert.ok(result.detections.some((detection) => detection.className === 'ccw_propeller'));
});

test('assess section includes assembly detection and four-side hover scoring', () => {
  assert.deepEqual(assessmentWorkflows.map((workflow) => workflow.key), ['assembly-detection', 'hover-scoring']);
  assert.ok(assessmentWorkflows[0].acceptedEvidence.includes('photo'));
  assert.ok(assessmentWorkflows[0].acceptedEvidence.includes('30-second-video'));
  assert.ok(assessmentWorkflows[1].title.includes('四面懸停'));

  const result = simulateHoverAssessment('hover.mp4');
  assert.equal(result.engine, 'YOLOv8 hover scoring placeholder');
  assert.equal(result.score, 82);
  assert.match(result.teacherReview, /線下老師/);
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
