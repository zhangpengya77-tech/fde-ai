import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hero,
  moduleSections,
  youtubeVideos,
  learningTracks,
  learningResources,
  practiceResources,
  buildWorkflow,
  assessmentWorkflows,
  certificationChecklist,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  simulateHoverAssessment,
  calculateProgress
} from '../src/platform.js';

test('defines home plus five independent sections in order', () => {
  assert.deepEqual(moduleSections.map((section) => section.key), ['home', 'learn', 'practice', 'build', 'assess', 'certify']);
  assert.deepEqual(moduleSections.slice(1).map((section) => section.label), ['學', '練', '做', '測', '證']);
});

test('defines a boot hero for an AI-assisted drone training platform', () => {
  assert.equal(hero.name, 'fde-ai');
  assert.equal(hero.headline, 'FDE-AI 無人載具學習平台');
  assert.match(hero.summary, /AI/);
  assert.deepEqual(hero.systems, ['AI 驅動雙師教學系統', '鷹眼 AI 評測系統']);
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

test('certification checklist includes GitHub evidence upload', () => {
  assert.ok(certificationChecklist.some((item) => item.title.includes('GitHub')));
  assert.ok(certificationChecklist.some((item) => item.detail.includes('學習過程')));
});

test('calculates bounded progress percentages', () => {
  assert.equal(calculateProgress(3, 10), 30);
  assert.equal(calculateProgress(20, 10), 100);
  assert.equal(calculateProgress(-1, 10), 0);
});
