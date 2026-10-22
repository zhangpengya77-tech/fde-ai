# Phase 2 - Plan C: Power-Line Inspection Visual Recognition Prototype

> This document is a plan for the next phase, not a current-round task.
> The current round (2026-10-17) only produces this planning document.
> No model training, no large dependencies, no migration of the simulator engine in this round.

---

## 1. Goal

Design and prepare a bounded, independently testable visual-recognition prototype for power-line inspection, so that a later phase can:

- Detect the first inspection target defect (insulator disc missing) in real and synthetic drone imagery.
- Produce evaluation metrics, an error-case catalogue, and an integration-boundary specification.
- Plug a real model into the FDE training loop without ever confusing it with the existing deterministic Mock AI.

The prototype lives in a **separate workspace** (`D:\FDE-Inspection-Vision-Proto` or an agreed location), not inside `FDE-Power-Inspection-Simulator/src/**`, so its dependencies and data never pollute the teaching loop.

---

## 2. Preconditions

- First recognition target decided and written down: **insulator disc missing** on transmission-line insulator strings (matches the FDE Phase 1 teaching defect `MISSING_INSULATOR_DISC`).
- Data sources explicitly approved by the user:
  - User-supplied drone photos of transmission lines (with written consent for training and testing).
  - Public / open-license aerial inspection datasets (license verified and recorded in `THIRD_PARTY_NOTICES.md`).
  - Synthetic images rendered from the FDE scene (with a recorded generation script and seed).
- Annotation standard decided and stored in `proto/annotation-guideline.md` (created at step 1).
- A user-signed data-authorization checklist stored at `proto/data-authorization.md` (created at step 1).
- No production data, no personal data, no third-party proprietary photos without written permission.

---

## 3. File Scope

New (separate prototype repo or a clearly isolated branch; never inside `FDE-Power-Inspection-Simulator/src/**`):

- `proto/`
  - `README.md` - goals, scope, non-goals.
  - `data-authorization.md` - signed, dated list of approved sources.
  - `annotation-guideline.md` - label classes, bounding-box / segmentation rules, ambiguity rules, quality bar.
  - `dataset-card.md` - splits, sizes, label distribution, known biases.
  - `baseline-model.md` - the minimal model the prototype uses (architecture, training config, hardware assumptions, license).
  - `evaluation.md` - metrics, error-case catalogue, baseline numbers.
  - `integration-boundary.md` - how the prototype would call into the FDE app: the contract and what stays out.

Optional supporting code (created in a later round, NOT this one):

- `proto/scripts/render_synthetic.py` - if synthetic data is used, recorded with seed.
- `proto/scripts/eval.py` - the evaluation harness.
- `proto/notebooks/` - only the small subset that reproduces the reported numbers.

Do NOT touch in this round:

- `D:\FDE-Power-Inspection-Simulator\src\**` - the simulator engine stays untouched.
- `D:\FDE-Power-Inspection-Simulator\package.json` - no new dependency in the simulator.
- Any real customer or third-party proprietary imagery without written approval.

---

## 4. Workflow (6 steps, each with a verifiable artifact)

1. Lock target and scope
   - Record the first recognition target, non-goals, success bar, and what is "out of scope for this prototype".
   - Acceptance: `proto/README.md` is signed off.

2. Lock data and authorization
   - User signs `proto/data-authorization.md`. Every dataset has a row: source, license, approval date, approver, allowed uses.
   - Acceptance: no row is "TBD"; every row has a license line.

3. Annotation standard
   - `proto/annotation-guideline.md` covers: target class, label format (bbox / mask), inclusion and exclusion rules, ambiguity rules, minimum annotator-agreement target.
   - Acceptance: the guideline is concrete enough that two annotators on 20 sample images reach the target agreement.

4. Dataset construction
   - Build train / validation / test splits. No image appears in more than one split.
   - Record label distribution per split and any known bias (e.g. camera angle, weather, lighting).
   - Acceptance: `proto/dataset-card.md` lists sizes, distributions, and the split rule; a script can deterministically regenerate the split from a seed.

5. Baseline model and evaluation
   - Pick the smallest model that can plausibly learn the target (start from an open-license detector; do NOT reach for a large bespoke model first).
   - Train only after data + annotation are approved. Evaluate on the test split with the metrics below; collect every false positive / false negative into `proto/evaluation.md` as an error-case catalogue (with the image id, predicted label, true label, and a one-line reason).
   - Acceptance: `proto/evaluation.md` reports metrics on the held-out test split and at least 10 documented error cases.

6. Integration boundary
   - Define a thin contract so the FDE app can call the prototype as the real AI replacing `MockInspectionAI`, while keeping the deterministic mock as the fallback. List exactly what the FDE side must provide (image bytes, telemetry, scene context) and what the model returns (defect id, confidence, bbox).
   - Acceptance: `proto/integration-boundary.md` states the contract, the fallback behaviour, and the explicit non-goals (no scoring, no flight, no persistence changes).

---

## 5. Evaluation Metrics

- Primary: precision, recall, F1 on the "insulator disc missing" class at a fixed confidence threshold (e.g. 0.5).
- Secondary: average precision (AP) over the confidence sweep; per-image inference latency on the target hardware.
- Robustness probes (counts as error-case evidence): same defect under varied lighting, distance, and camera angle; occlusion cases.
- Human-readable report: an error-case table grouped by failure mode (missed small target, confused with disc-shadow, low-light, motion blur) so the next iteration has a concrete to-do list.

---

## 6. Acceptance Criteria (DoD for Phase 2-C itself - the planning deliverable)

- `proto/data-authorization.md` is signed and dated; all sources licensed.
- `proto/annotation-guideline.md` is concrete and was validated by a two-annotator agreement check.
- `proto/dataset-card.md` describes a reproducible split with no leakage across splits.
- `proto/baseline-model.md` documents a minimal, open-license model choice and its license.
- `proto/evaluation.md` contains metrics on a held-out test split and >= 10 error cases.
- `proto/integration-boundary.md` defines the FDE contract and the Mock-AI fallback.
- No code, training, or dependency change in `FDE-Power-Inspection-Simulator` in this round.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Data-rights violation | `data-authorization.md` signed before any download; no unapproved proprietary images ever in the set |
| Model-quality overpromise | Start from a small open-license baseline; report honest metrics; no claim of "production ready" without a held-out evaluation |
| Leakage between splits | Deterministic seed split; a script verifies no image id appears in two splits |
| Dependency pollution of FDE | Prototype lives outside the simulator; `package.json` of the simulator is untouched |
| Confusing real AI with Mock AI | Integration keeps `MockInspectionAI` as the deterministic fallback; the contract in `integration-boundary.md` is explicit |
| Scope creep into scoring / flight | `README.md` non-goals and `integration-boundary.md` non-goals forbid it |

---

## 8. Expected Work Order

1. Lock target and scope; write `proto/README.md` (sign-off blocker; user-driven).
2. Lock data and authorization; write `proto/data-authorization.md`; record licenses.
3. Write `proto/annotation-guideline.md`; run a two-annotator agreement check.
4. Build `proto/dataset-card.md` with a seeded, leakage-free split.
5. Document `proto/baseline-model.md`; train only after steps 1-4 are signed off.
6. Produce `proto/evaluation.md` (metrics + error-case catalogue).
7. Write `proto/integration-boundary.md`; present the contract to the FDE maintainer for review before any implementation.

---

## 9. Stop Conditions (this round)

- No model training; no dataset download; no code execution in this round.
- No large dependency introduced into `FDE-Power-Inspection-Simulator`; the simulator stays at HEAD = `8d23ad5`.
- No engine migration; Three.js / Vite / Vitest / Playwright stack unchanged.
- No whole-project refactor.
- This round produces ONLY: this plan plus the `proto/*.md` documents, in a separate prototype workspace or an isolated branch.
