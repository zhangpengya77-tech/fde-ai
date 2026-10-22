# Phase 2 - Plan B: YiFei Functional Reference Analysis

> This document is a plan for the next phase, not a current-round task.
> The current round (2026-10-17) only produces this planning document.
> No cracking, reverse engineering, decompilation, or modification of YiFei is performed at any point.

---

## 1. Goal

Build a factual, source-cited reference comparison between `FDE-Power-Inspection-Simulator` (Phase 1 MVP) and the publicly observable behaviour of YiFei (the commercial power-line inspection drone application), so that future FDE phases can copy ideas, not code.

Hard rule: every claim is labelled `FACT` (observed in legal or public material), `SPECULATION` (analyst inference, not observed), or `UNKNOWN` (cannot determine legally). Anything that would require cracking, reverse engineering, scraping private APIs, sniffing traffic, decompilation, or violating a ToS is forbidden.

---

## 2. Preconditions

- A list of legally accessible materials, supplied or pre-approved by the user:
  - YiFei public product pages, official user manuals, official help center articles, official videos.
  - YiFei public release notes and changelogs.
  - YiFei in-app screens that the user personally has access to and is willing to share via screenshots or recordings.
  - Any third-party reviews or public demonstrations that the user provides or pre-approves.
- A signed-off boundaries document: what materials count as legal and accessible for this round, signed by the user, stored at `docs/yiFei-reference/scope.md` (created at step 1).
- FDE Phase 1 MVP shipped (HEAD = `8d23ad5`, all 7 P1 stages PASS).
- No access to YiFei binaries, no network traffic capture, no login bypass, no scraping behind authentication walls.

---

## 3. File Scope

New (analysis docs only; do not pollute application code):

- `docs/yiFei-reference/`
  - `scope.md` - which materials were approved, by whom, on what date.
  - `fact-catalog.md` - observable YiFei features, each with a citation (link, page, timestamp, screenshot file).
  - `comparison.md` - side-by-side FDE vs YiFei, every cell tagged `FACT` / `SPECULATION` / `UNKNOWN`.
  - `feature-ideas.md` - candidate features FDE could consider in Phase 2+, each tied to a `FACT` cell in the catalog and a feasibility note.
  - `out-of-scope.md` - what we deliberately did not look at and why.

Read-only:

- `docs/superpowers/specs/2026-10-16-power-inspection-simulator-v1-design.md` - the FDE design spec to compare against.

Do NOT touch:

- `src/**`, `tests/**`, build configuration
- Any YiFei binary, APK / IPA, server endpoint, or internal API
- Any third-party material the user has not approved
- Other FDE projects

---

## 4. Workflow (5 steps, each with a verifiable artifact)

1. Scope the legal access
   - User signs off `scope.md` (what counts as legal, what does not).
   - Acceptance: a written, dated scope with at least one named approver.

2. Collect observations (FACT only)
   - For each YiFei screen, flow, or metric, record: source URL or screenshot file, observation time, what was seen, exact wording if any.
   - No inference in this step; only what is on the screen.
   - Acceptance: every entry in `fact-catalog.md` carries a source citation.

3. Compare to FDE
   - Build a matrix: row = FDE feature or metric; column = YiFei equivalent; cell = `FACT` / `SPECULATION` / `UNKNOWN` plus a one-line note.
   - Reject any cell that cannot be supported by `fact-catalog.md`; mark it `UNKNOWN`.
   - Acceptance: every cell is labelled; no unmarked cells.

4. Distill feature ideas
   - Only from `FACT` cells, propose candidate FDE features for Phase 2+: each must say what the idea is, what user value it adds, what FDE work it would require (file-level scope), and what risk it carries.
   - Acceptance: each idea traces to a `FACT` cell and a feasibility note.

5. Risk and ethics review
   - Cross-check the entire `docs/yiFei-reference/` against the scope document. Anything that came from a non-approved source is removed.
   - Acceptance: `out-of-scope.md` lists what was deliberately not pursued, and the rest of the documents cite only approved sources.

---

## 5. Acceptance Criteria (DoD for Phase 2-B itself)

- `scope.md` is signed and dated.
- `fact-catalog.md` has at least N entries (target N = 20, TBD with the user), each cited.
- `comparison.md` covers all major FDE Phase 1 surfaces: input, flight, scene, mission, inspection, scoring, teacher review.
- `feature-ideas.md` contains only ideas that trace to `FACT` cells, with feasibility notes.
- No cell in any document references material outside `scope.md`.
- No code, build, or dependency change in this round.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| IP / copyright / ToS violation | Strict scope document; any non-approved material is removed at step 5 |
| Analysing private APIs or scraping | Explicitly forbidden; all observations are public surfaces only |
| Speculation disguised as fact | Hard tag rule; reviewers reject unmarked or `SPECULATION` cells in any commit |
| Feature creep into FDE roadmap | `feature-ideas.md` is a backlog, not a commitment; the user decides what enters the FDE plan |
| Bias toward parity with YiFei | Every idea must show what user value it adds in the FDE context, not just parity |
| Leakage of YiFei material into FDE tests | Tests and code never import YiFei names, screenshots, or assets |

---

## 7. Expected Work Order

1. User signs `scope.md` with the legal list of materials (this is a blocker, not a step the assistant takes unilaterally).
2. Create `fact-catalog.md` and start populating it from approved public materials; aim for 20+ entries.
3. Draft `comparison.md` row by row, tagging every cell.
4. Distill `feature-ideas.md` from `FACT` cells only.
5. Run the risk and scope review; remove anything out of scope; commit the docs to a new branch (e.g. `phase2-yifei-reference`); do not mix with FDE application code.
6. Present the comparison and feature backlog to the user; wait for explicit go-ahead before any feature enters an FDE task plan.

---

## 8. Stop Conditions (this round)

- No code change, no test change, no dependency change in `D:\FDE-Power-Inspection-Simulator`.
- No cracking, reverse engineering, decompilation, traffic capture, scraping, or authentication bypass of YiFei.
- No copying of YiFei assets, names, or text into the FDE repository.
- This round produces ONLY: this plan plus the four documents under `docs/yiFei-reference/`, on a separate branch.
