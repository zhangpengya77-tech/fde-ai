# Phase 1A.2 Mobile HTTPS and Model Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Provide an isolated disposable HTTPS path and a reproducible independent CW/CCW qualification workflow without changing production or entering Phase 1B.

**Architecture:** Keep the current browser → Live Backend :8030 → HTTP Vision :8765 architecture. Add development-only Quick Tunnel lifecycle scripts, manual device evidence forms, and an offline qualification CLI that reads a new independent-test manifest and existing best.pt.

**Tech Stack:** PowerShell, Cloudflare Quick Tunnel, Python, Ultralytics, CSV/JSON, unittest.

**Spec:** Approved Phase 1A.2 instruction in this conversation.

## Global Constraints

- Work only in `D:\FDE-AI-UAS-v2.0` on `fde-ai-v2.0-dev`.
- Do not modify v1.5C, production Worker/Tunnel/ORIGIN_URL/secrets, best.pt, or production threshold.
- No WebSocket, automatic FPS, RAG, Voice AI, SOP implementation, retraining, or production deployment.
- Missing physical-device evidence remains `NOT TESTED`; missing/insufficient independent data yields `MODEL_NOT_QUALIFIED`.

### Task 1: Dev-only HTTPS lifecycle
- Create `ops/v2/start-phase1a2-tunnel.ps1`, `stop-phase1a2-tunnel.ps1`, and `status-phase1a2-tunnel.ps1`.
- Add safety tests proving only localhost:8030 and no production identifiers.
- Start the services and disposable Quick Tunnel; record its temporary URL.

### Task 2: Device verification protocol
- Create one checklist/result form each for Windows Webcam, iPhone Safari, and Android Chrome.
- Default every device result to `NOT TESTED` and include required metrics/errors.

### Task 3: Independent qualification protocol and CLI
- Define a 60-image minimum manifest: 30 CW and 30 CCW, new smartphone captures only.
- TDD metric calculation, confusion matrix, error categories, and thresholds 0.50/0.60/0.70/0.80.
- Run the tool against the currently empty independent set and emit `MODEL_NOT_QUALIFIED` without substituting training data.

### Task 4: Reports and regression
- Document the Phase 1B backpressure design only.
- Run all regressions, verify stable v1.5C, update handoff, and stop without implementing Phase 1B.

