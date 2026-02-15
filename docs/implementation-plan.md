# Implementation Plan: VoxVault — Multi-Stream Delivery

This document defines the execution model for independent backend/Electron delivery with controlled integration.

## 1. Streams, Ownership, and Responsibilities

| Stream | Owner | Responsibilities | Primary Outputs |
|---|---|---|---|
| `S1-Backend` | Backend Lead | API design/implementation, audio processing, persistence, Chutes.ai integration, backend tests | FastAPI endpoints, OpenAPI spec, backend test report |
| `S2-Electron` | Frontend Lead | Electron main/preload setup, system audio capture, React renderer, IPC channels, UI tests | Electron app, IPC contract, UI components, test report |
| `S3-Integration` | Architect (with QA Owner) | Contract governance, dependency management, integration validation, packaging, release gating | Gate checklists, E2E report, Windows installer, release decision |

## 2. Delivery Phases and Gates

| Phase | Gate | Objective | Completion Criteria |
|---|---|---|---|
| `P0 Alignment` | `Gate 0` | Lock scope and ownership | Scope/non-goals approved; owner map published; risks logged with owners |
| `P1 Architecture` | `Gate 1` | Establish technical baseline with Electron scaffolding | Architecture + test strategy documented; Electron captures system audio; backlogs approved |
| `P2 Contract Freeze` | `Gate 2` | Freeze API + IPC contracts to unlock independent delivery | OpenAPI + IPC channels signed off by S1/S2/S3; fixtures/mocks published |
| `P3 Stream Build` | `Gate 3` | Complete backend/Electron independently | Stream-level acceptance criteria met; test suites pass; no blocker defects |
| `P4 Integration` | `Gate 4` | Validate integrated behavior end-to-end | E2E and contract tests green in shared environment |
| `P5 Release` | `Gate 5` | Package installer and verify operational readiness | Windows .exe installer works; release checklist complete; owner sign-off complete |

## 3. API + IPC Contract Freeze Milestone (Gate 2)

Required artifacts:
- Versioned OpenAPI contract for all in-scope endpoints.
- IPC channel definitions with request/response types (TypeScript interfaces).
- Canonical request/response JSON examples for success and error paths.
- Error taxonomy (`4xx`, `5xx`, validation errors) with stable codes/messages.
- Electron mock handlers and frontend fixtures generated from frozen contracts.

Change policy after freeze:
- No breaking changes to API or IPC channels without explicit approval from Architect + both stream leads.
- Any approved breaking change requires version increment and migration notes.
- Non-breaking additions must update contract docs and fixtures in the same change.

## 4. Phase Execution Detail

### P0 Alignment (to Gate 0)
- `S3-Integration`
  - Produce scope table (in/out) and owner assignment matrix.
  - Establish gate checklist template.
- Dependencies
  - None.
- Completion criteria
  - Scope and ownership accepted.
  - Risks and assumptions tracked with owners.

### P1 Architecture (to Gate 1)
- `S1-Backend`
  - Confirm endpoint set: `/api/upload`, `/api/transcriptions`, `/api/transcriptions/{id}`, `/api/audio/{id}`, `/api/health`.
  - Define storage and audio conversion boundaries.
- `S2-Electron`
  - Scaffold Electron project with Vite + React integration.
  - Implement `desktopCapturer` proof-of-concept for system audio capture.
  - Define IPC channel architecture (main ↔ renderer communication).
  - Define UI state model for record/upload/transcription/history.
- `S3-Integration`
  - Publish dependency matrix and critical path.
- Dependencies
  - P0 complete.
- Completion criteria
  - Electron app launches and captures system audio successfully.
  - Architecture decisions captured.
  - Both stream backlogs are implementation-ready.

### P2 Contract Freeze (to Gate 2)
- `S1-Backend`
  - Publish OpenAPI and schema definitions.
  - Provide sample payloads and error responses.
- `S2-Electron`
  - Document IPC channels with TypeScript interfaces.
  - Generate/prepare API mocks and typed client interfaces.
  - Validate all planned UI flows against API + IPC contracts.
- `S3-Integration`
  - Facilitate review and obtain signatures for both API and IPC contracts.
- Dependencies
  - P1 complete.
- Completion criteria
  - API contract freeze signed and timestamped.
  - IPC channel contract documented and signed.
  - Electron can execute independently using mocks.

### P3 Stream Build (to Gate 3)
- `S1-Backend`
  - Implement endpoints/services and backend tests.
  - Verify backup behavior and metadata retrieval.
- `S2-Electron`
  - Implement system audio recorder with `desktopCapturer`.
  - Implement file upload, transcription display, history, and failure states.
  - Add unit/component tests for both main and renderer processes.
- `S3-Integration`
  - Track blockers and enforce contract compliance.
- Dependencies
  - P2 complete.
- Completion criteria
  - Backend acceptance: endpoint behavior matches frozen contract; backend tests pass.
  - Electron acceptance: system audio capture works; UI flows complete; tests pass with frozen fixtures.
  - No open blocker defects.

### P4 Integration (to Gate 4)
- `S1-Backend` + `S2-Electron`
  - Integrate Electron app with running FastAPI backend.
  - Resolve mismatches between API contract and actual behavior.
- `S3-Integration`
  - Run contract regression and end-to-end scenarios.
- Dependencies
  - P3 complete for both streams.
- Completion criteria
  - Critical journey passes: capture system audio -> upload -> transcribe -> display history.
  - Negative-path checks pass (invalid file, provider failure, timeout behavior).
  - Contract tests remain green.

### P5 Release (to Gate 5)
- `S3-Integration`
  - Run release checklist and collect final approvals.
  - Build Windows installer with electron-builder.
  - Test installation on clean Windows system.
- `S1-Backend`
  - Validate health endpoint, deployment steps, and rollback path.
  - Document backend startup instructions for end users.
- `S2-Electron`
  - Validate production build and environment configuration.
  - Ensure packaged app connects to local backend correctly.
- Dependencies
  - P4 complete.
- Completion criteria
  - Windows `.exe` installer works on clean system.
  - Operational readiness confirmed.
  - Known issues documented and accepted.
  - Final sign-off from S1, S2, and S3 owners.

## 5. Dependency Matrix

| Dependency | Producer | Consumer | Needed By |
|---|---|---|---|
| Architecture decisions | `S3-Integration` | `S1-Backend`, `S2-Electron` | Gate 1 |
| Electron scaffolding with system audio | `S2-Electron` | `S3-Integration` (validates capability) | Gate 1 |
| OpenAPI + schemas | `S1-Backend` | `S2-Electron`, `S3-Integration` | Gate 2 |
| IPC channel contract | `S2-Electron` | `S3-Integration` | Gate 2 |
| API fixtures/mocks | `S2-Electron` (from contract) | `S2-Electron` tests, `S3-Integration` checks | Gate 2 |
| Stream acceptance reports | `S1-Backend`, `S2-Electron` | `S3-Integration` | Gate 3 |
| E2E validation report | `S3-Integration` | Release decision | Gate 4 |
| Windows installer | `S3-Integration` | Release | Gate 5 |

## 6. Definition of Done (Global)

A phase is complete only when:
- Gate artifacts are present and reviewed.
- Phase-specific completion criteria are met.
- Open defects are triaged with no unresolved blockers.
- Ownership sign-off is recorded for the gate.
