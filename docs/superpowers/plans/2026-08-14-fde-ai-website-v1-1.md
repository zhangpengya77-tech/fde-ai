# FDE-AI Website v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the static FDE-AI website into five independent Learn, Practice, Build, Assess, and Certify sections with a drone boot hero and placeholders for RAG voice support and YOLOv8 propeller checks.

**Architecture:** Keep the app as a static HTML/CSS/JavaScript site that opens directly from `index.html`. Store all module content, links, workflow data, and simulated AI outputs in `src/platform.js`; mirror the same data in `src/platform-browser.js` for direct browser loading; render section-based UI in `src/app.js`.

**Tech Stack:** HTML5, CSS3, JavaScript ES modules, Node.js built-in test runner, local Chrome/Playwright verification.

## Global Constraints

- No login.
- Keep `index.html` directly openable without a dev server.
- Real RAG, GPT voice, and YOLOv8 are not implemented in v1.1; expose clear interface placeholders and simulated results.
- Preserve GitHub private repository publishing to `https://github.com/Elijahieee/fde-ai.git`.
- Sync the final static files to `E:\fde-ai website`.

---

### Task 1: Platform Data Contract

**Files:**
- Modify: `tests/platform.test.js`
- Modify: `src/platform.js`

**Interfaces:**
- Produces: `moduleSections`, `hero`, `learningResources`, `practiceResources`, `buildWorkflow`, `certificationChecklist`, `simulateBuildAssistant(input)`, `simulatePropellerAssessment(fileName)`, and `calculateProgress(completed, total)`.
- Consumes: none.

- [ ] **Step 1: Write failing tests**

```javascript
test('defines five independent sections in order', () => {
  assert.deepEqual(moduleSections.map((section) => section.key), ['home', 'learn', 'practice', 'build', 'assess', 'certify']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/platform.test.js`
Expected: FAIL because `moduleSections` does not exist.

- [ ] **Step 3: Implement platform data**

Define the exported objects and arrays with the five section content, resource links, build workflow, and simulated AI results.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/platform.test.js`
Expected: PASS.

### Task 2: Five-Section Website UI

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `src/platform-browser.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: the platform data contract from Task 1.
- Produces: a five-section site with separate Learn, Practice, Build, Assess, and Certify panels.

- [ ] **Step 1: Replace the stacked layout**

Create individual full-page sections and navigation anchors for Home, Learn, Practice, Build, Assess, and Certify.

- [ ] **Step 2: Render each module independently**

Render video links, simulator links, build workflow, RAG/GPT placeholder UI, YOLOv8 propeller upload placeholder, and GitHub certification checklist.

- [ ] **Step 3: Add boot visual**

Use CSS to create a transparent blue drone animation in the homepage hero.

- [ ] **Step 4: Wire simulated interactions**

Connect the build assistant button and propeller assessment button to the simulated platform functions.

- [ ] **Step 5: Update docs**

Document v1.1 scope, placeholders, and next integration steps.

### Task 3: Verification, Publish, and Local Sync

**Files:**
- Modify: repository state and `E:\fde-ai website`.

**Interfaces:**
- Consumes: completed v1.1 site.
- Produces: pushed GitHub commit and synced E drive static copy.

- [ ] **Step 1: Run tests**

Run: `node --test tests/platform.test.js`
Expected: PASS.

- [ ] **Step 2: Run syntax checks**

Run: `node --check src/app.js`, `node --check src/platform.js`, and `node --check src/platform-browser.js`.
Expected: all exit 0.

- [ ] **Step 3: Browser verification**

Open `index.html` with Chrome/Playwright, click simulated buttons, confirm the five section headings and results render.

- [ ] **Step 4: Commit and push**

Commit with `Improve FDE-AI website structure` and push `main`.

- [ ] **Step 5: Sync E drive**

Copy `.gitignore`, `README.md`, `docs`, `index.html`, `package.json`, `src`, and `tests` to `E:\fde-ai website`.

## Self Review

- Spec coverage: The plan covers separate sections, learning links, simulator links, build assistant placeholder, propeller assessment placeholder, and GitHub certification.
- Placeholder scan: No vague work remains; real AI systems are explicitly scoped as placeholders for v1.1.
- Type consistency: Export names in Task 1 match Task 2 consumers.
