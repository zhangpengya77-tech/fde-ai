# FDE-AI Public Home and Authentication Routing Design

**Date:** 2026-09-15  
**Status:** Approved in conversation; awaiting document review before implementation planning  
**Target branch:** `fde-ai-v1.5b`

## 1. Purpose

Make the existing FDE-AI learning platform publicly accessible while keeping personal learning records and the real teacher workspace protected. Public visitors must be able to browse the FDE-AI site and use the RAG assistant and AI inspection experience without creating an account or logging in.

The platform remains one product. The v1.5 Django layer adds identity-aware navigation and protected account workflows around the existing learning content; it does not replace the learning platform with a second course site.

## 2. Current State

- The Django home view redirects authenticated students and teachers directly to their dashboards.
- `/platform/` and its static assets currently require authentication.
- The existing platform contains the public learning material, task map, videos, RAG assistant, AI inspection, results, and a static teacher-review sample section.
- The browser currently calls RAG and AI services through loopback URLs such as `127.0.0.1`. A visitor's browser interprets those addresses as the visitor's own device, so those requests are not a working public service path.
- Student login supports a safe `next` redirect. Registration and email activation do not currently preserve that target through the complete flow.

## 3. Approved Product Decisions

1. The home page and existing platform content are public for anonymous and authenticated visitors.
2. RAG questions and AI inspection requests do not require login.
3. Student learning records and the real teacher dashboard remain protected by role and ownership checks.
4. The existing static “教師復核中心” is retained as a public demonstration using sample data. It is not the real teacher dashboard and must not contain real student records.
5. The actual teacher workspace is reached through teacher login.
6. The original v1.2 `index.html`, `src/` application files, and the current GitHub Pages deployment remain unchanged. The v1.5 Django layer provides public routing, role-aware identity navigation, and an adapter for public AI requests.
7. Existing login, registration, and email-verification architecture is retained. No SMTP configuration, payment, deployment, or growth-record feature work is part of this design.

## 4. Route and Access Matrix

| Route family | Anonymous | Student | Teacher |
| --- | --- | --- | --- |
| `/` | Public FDE-AI platform | Same public platform | Same public platform |
| `/platform/` and public app assets/routes | Public | Public | Public |
| `/login/`, `/register/`, `/activate/...` | Public | Public | Public |
| `/student/**`, course enrollment, growth records | Redirect to student login with safe `next` | Own records only | Denied without logging the teacher out |
| `/teacher/**` | Redirect to teacher login with safe `next` | Denied | Teacher-authorized cohorts only |
| Public RAG and AI proxy APIs | Allowed without account login | Allowed | Allowed |
| Static teacher-review sample section | Public sample only | Public sample only | Public sample only |

Public routes must never serialize student profiles, enrollment data, evidence, teacher notes, or full email addresses. Existing object-level authorization remains in force for student evidence and teacher cohort access.

## 5. Public Home and Navigation

The root route and `/platform/` serve the existing FDE-AI learning application so the public home includes the existing task map, course content, videos, AI experiences, RAG assistant, and showcase. The home route no longer redirects authenticated users away.

The v1.5 Django serving layer supplies a separate identity-aware navigation area without editing the original v1.2 page or application source:

- Anonymous: student login, student registration, and teacher login.
- Student: FDE ID, nickname, “我的學習成長日誌”, “我的課程”, and logout.
- Teacher: teacher dashboard, class/student review, teacher account identifier, and logout.

The static teacher-review section remains clearly identified as a demonstration. Real class and student review data are available only from the Django teacher dashboard after teacher authentication.

## 6. Login, Registration, and Return Flow

When an anonymous visitor opens a protected student page, the application redirects to student login and carries the requested local URL as `next`. A successful login returns to that URL. Teacher routes use teacher login in the same way.

If the visitor chooses registration from a protected destination, the same safe destination is preserved across registration, email activation, and the subsequent login. After activation, the existing login step remains; successful login then returns the student to the original destination.

Every `next` value is validated against the current host and HTTPS mode. External hosts, protocol-relative URLs, and malformed values are rejected in favor of the appropriate role dashboard. Register, activation, and resend forms must preserve only a validated local destination.

If an authenticated user has the wrong role for a protected route, show a clear access-denied or role-specific destination response. Do not silently log the user out or expose the protected content.

## 7. Anonymous RAG and AI Inspection

Public AI calls use same-origin Django endpoints, with no account-login requirement. A v1.5-only compatibility adapter at the Django serving boundary maps the existing browser request paths to these endpoints, preserving the original page and application source files.

Proposed endpoint responsibilities:

- `POST /api/public/rag/ask/`: validate a question and proxy it to the configured RAG service, preserving the existing answer response contract.
- `POST /api/public/inspection/detect/`: validate and proxy the existing propeller/assembly detection request.
- `POST /api/public/inspection/hover/`: validate and proxy the existing hover-analysis request.

Upstream service addresses are server-side configuration. No provider key, private service credential, or internal upstream address is exposed as a usable browser credential. The public endpoints apply bounded request sizes, upstream timeouts, and configurable per-client rate limits. Uploaded inspection inputs are transient and are not stored as student Evidence. Public RAG questions are not attached to a user profile.

If an upstream service is absent or unavailable, the public page remains accessible and displays a clear service-unavailable result; it must not redirect the visitor to login. Same-origin POST requests retain standard CSRF protection without requiring an authenticated account.

## 8. Scope Boundaries

### Included in the future implementation

- Public home and static platform access for all session states.
- Role-aware identity navigation in the Django-served platform.
- Safe `next` continuity through login, registration, activation, and login after activation.
- Anonymous same-origin RAG and AI inspection proxy routes with validation and operational limits.
- Preservation of the public static teacher demonstration, clearly separated from the real protected teacher backend.
- Automated route, authorization, navigation, redirect-safety, and mocked-upstream tests.

### Not included

- Editing original v1.2 HTML, CSS, JavaScript, or learning content.
- Changing the current GitHub Pages branch or deploying a public backend.
- Changing anonymous account identity, password, email verification, or SMTP configuration.
- Changing R01-R08 growth records, image upload, teacher review, or existing course logic.
- Adding AI scoring, model training, payment, or new public learning content.

## 9. Acceptance Criteria

1. Anonymous `GET /` and `GET /platform/` return the public platform rather than an authentication redirect.
2. All public HTML, SPA routes, and static assets load without login.
3. Anonymous and authenticated users can access the RAG and AI inspection interfaces; anonymous test requests reach mocked upstream services without login.
4. Missing/unavailable upstream services produce a user-facing service error, not a login redirect or unhandled 500.
5. The static teacher-review sample is visible as sample content and contains no real account or student data.
6. Anonymous student access redirects to student login with a validated local `next`; successful login returns to the original growth-record URL.
7. Registration and activation preserve a valid local `next`, then return after login; unsafe external `next` values are rejected.
8. Anonymous teacher access routes to teacher login; authorized teachers can reach the real dashboard; students cannot access teacher records.
9. Students continue to access only their own enrollments, submissions, and evidence; teacher cohort authorization remains enforced.
10. Student navigation shows FDE ID and nickname but no full email. Teacher navigation shows the teacher account identifier and logout.
11. The original v1.2 source files and GitHub Pages deployment are unchanged.

## 10. Implementation Notes and Risks

- Anonymous UI access alone does not make current loopback AI services publicly reachable. The proxy requires reachable upstream services configured on the Django host. When configuration is missing, graceful unavailability is expected.
- Public AI endpoints can be abused. Request limits and rate controls are required before public deployment; this design does not authorize deployment.
- Auth-aware HTML must not be publicly cached across users. Static assets may be cached independently if safe.
- Existing unrelated uncommitted Growth Record changes must be preserved during implementation and verification.

## 11. Review State

The product decisions in Sections 3-8 were confirmed in conversation. This document is now submitted for written-spec review. Implementation planning and code changes must wait until the user approves this document.
