# FDE-AI Website v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static FDE-AI 1.0 AI instructor website that covers Learn, Practice, Build, Assess, and Certify with simulated assessment outputs.

**Architecture:** The website uses plain HTML, CSS, and JavaScript. Domain data and assessment simulation live in `src/platform.js`; UI rendering and interactions live in `src/app.js`; styles live in `src/styles.css`.

**Tech Stack:** HTML5, CSS3, JavaScript ES modules, Node.js built-in test runner.

## Global Constraints

- No login in v1.
- No real AI model integration in v1.
- Assessment results are simulated but the code must expose clean replacement points for future YOLOv8 and rules.yaml integration.
- Use GitHub private repository `https://github.com/Elijahieee/fde-ai.git`.

---

### Task 1: Domain Model and Assessment Simulation

**Files:**
- Create: `src/platform.js`
- Test: `tests/platform.test.js`

**Interfaces:**
- Produces: `modules`, `buildStages`, `certificationItems`, `simulatePhotoAssessment(fileName)`, `simulateHoverAssessment(fileName)`, and `calculateProgress(completed, total)`.

- [ ] **Step 1: Write failing tests**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/platform.test.js`
Expected: FAIL because `src/platform.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create the exported arrays and functions described above.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/platform.test.js`
Expected: PASS.

### Task 2: Static Website Interface

**Files:**
- Create: `index.html`
- Create: `src/app.js`
- Create: `src/styles.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: all exports from `src/platform.js`.
- Produces: a browser-usable dashboard with module navigation, build SOP, upload simulation, and certification display.

- [ ] **Step 1: Create the UI shell**

Add HTML regions for navigation, dashboard panels, assessment upload controls, and certification records.

- [ ] **Step 2: Render content from platform data**

Use `src/app.js` to render modules, build stages, and certification items from `src/platform.js`.

- [ ] **Step 3: Wire assessment buttons**

Use file input names to call `simulatePhotoAssessment()` and `simulateHoverAssessment()`, then render the result cards.

- [ ] **Step 4: Style as an AI instructor dashboard**

Use compact panels, clear navigation, progress indicators, dark control surfaces, and high-contrast status labels.

- [ ] **Step 5: Document local usage**

Update `README.md` with the project goal, v1 scope, local open instructions, and future AI integration notes.

### Task 3: Verify and Publish

**Files:**
- Modify: repository state only.

**Interfaces:**
- Consumes: completed website and tests.
- Produces: pushed GitHub commit on `main`.

- [ ] **Step 1: Run automated tests**

Run: `node --test tests/platform.test.js`
Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run: `git status -sb` and review changed files.

- [ ] **Step 3: Commit changes**

Run: `git add ...` and `git commit -m "Build FDE-AI website v1"`.

- [ ] **Step 4: Push to GitHub**

Run: `git push origin main`.

## Self Review

- Spec coverage: The plan covers the static website, five modules, simulated assessments, documentation, testing, and GitHub publishing.
- Placeholder scan: No implementation placeholder remains in the deliverable scope.
- Type consistency: The exports in Task 1 are the same names consumed by Task 2.
