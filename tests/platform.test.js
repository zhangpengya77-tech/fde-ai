import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hero,
  moduleSections,
  learningResources,
  practiceResources,
  buildWorkflow,
  certificationChecklist,
  simulateBuildAssistant,
  simulatePropellerAssessment,
  calculateProgress
} from '../src/platform.js';

test('defines home plus five independent sections in order', () => {
  assert.deepEqual(moduleSections.map((section) => section.key), ['home', 'learn', 'practice', 'build', 'assess', 'certify']);
  assert.deepEqual(moduleSections.slice(1).map((section) => section.label), ['學', '練', '做', '測', '證']);
});

test('defines a boot hero for an AI-assisted drone training platform', () => {
  assert.equal(hero.name, 'fde-ai');
  assert.match(hero.headline, /學、練、做、測、證/);
  assert.match(hero.summary, /AI/);
});

test('learn section contains YouTube and ground station resources', () => {
  assert.ok(learningResources.some((resource) => resource.type === 'youtube' && resource.title.includes('F450')));
  assert.ok(learningResources.some((resource) => resource.title.includes('Mission Planner')));
});

test('practice section contains simulator installation resources', () => {
  assert.ok(practiceResources.some((resource) => resource.category === 'simulator-download'));
  assert.ok(practiceResources.some((resource) => resource.steps.length >= 3));
});

test('build workflow supports photo and 30 second video evidence', () => {
  assert.ok(buildWorkflow.evidenceTypes.includes('photo'));
  assert.ok(buildWorkflow.evidenceTypes.includes('30-second-video'));
  assert.ok(buildWorkflow.stages.length >= 6);
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

test('certification checklist includes GitHub evidence upload', () => {
  assert.ok(certificationChecklist.some((item) => item.title.includes('GitHub')));
});

test('calculates bounded progress percentages', () => {
  assert.equal(calculateProgress(3, 10), 30);
  assert.equal(calculateProgress(20, 10), 100);
  assert.equal(calculateProgress(-1, 10), 0);
});
