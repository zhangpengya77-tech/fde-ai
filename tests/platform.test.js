import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modules,
  buildStages,
  certificationItems,
  simulatePhotoAssessment,
  simulateHoverAssessment,
  calculateProgress
} from '../src/platform.js';

test('defines the five FDE-AI modules in order', () => {
  assert.deepEqual(modules.map((module) => module.key), ['learn', 'practice', 'build', 'assess', 'certify']);
});

test('contains ten F450 build stages', () => {
  assert.equal(buildStages.length, 10);
  assert.equal(buildStages[0].title, '零件檢查');
  assert.equal(buildStages[9].title, '飛行模式設定');
});

test('simulates photo assessment with actionable build feedback', () => {
  const result = simulatePhotoAssessment('pixhawk-direction-check.jpg');
  assert.equal(result.type, 'photo');
  assert.equal(result.status, 'NEEDS_RECHECK');
  assert.match(result.summary, /Pixhawk|照片|檢查/);
  assert.ok(result.findings.length >= 3);
});

test('simulates hover assessment with a numeric score', () => {
  const result = simulateHoverAssessment('four-side-hover.mp4');
  assert.equal(result.type, 'video');
  assert.equal(result.totalScore, 86);
  assert.equal(result.scores.sideCompletion, 25);
  assert.match(result.recommendation, /第三面|roll|橫滾/);
});

test('calculates bounded progress percentages', () => {
  assert.equal(calculateProgress(3, 10), 30);
  assert.equal(calculateProgress(20, 10), 100);
  assert.equal(calculateProgress(-1, 10), 0);
});

test('defines certification evidence items', () => {
  assert.ok(certificationItems.some((item) => item.includes('AI 評分')));
});
