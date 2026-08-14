# FDE-AI Website v1 Design

## Goal

Build a basic AI instructor training platform website for FDE-AI 1.0. The site presents the five-part workflow: Learn, Practice, Build, Assess, and Certify.

## Scope

The first version is a static website with no login, no database, and no real AI model integration. The assessment module accepts the concept of photo and video upload, but returns simulated assessment results so the user journey can be demonstrated before YOLOv8 and rules.yaml are installed.

## User Experience

The site opens directly to an AI instructor dashboard. A left navigation rail exposes the five modules. The main screen shows training progress, mission cards, F450 build stages, upload panels, simulated scoring, and certification records.

## Modules

- Learn: F450, Pixhawk, Mission Planner, safety, and four-side hover knowledge blocks.
- Practice: simulator drills, license theory practice, hover repetition, and mission checklists.
- Build: ten-stage F450 assembly SOP based on the source PDF.
- Assess: F450 photo inspection and four-side hover video scoring with simulated output.
- Certify: competency record, score summary, evidence checklist, and export-ready project archive guidance.

## Technical Approach

Use plain HTML, CSS, and JavaScript. Keep domain content and scoring logic in a separate JavaScript module so the simulated assessment can later be replaced by a real backend or local AI engine without rewriting the UI.

## Future Integration Points

- Replace simulated assessment functions with YOLOv8 photo and video inference.
- Load thresholds from rules.yaml instead of hardcoded demo values.
- Persist learner records to a database or repository-backed storage.
- Add teacher review and downloadable report generation.
