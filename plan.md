# Plan: Multi-Stream Execution Model

This plan enables independent frontend and backend delivery with explicit gates, ownership, and contract control.

## Streams and Ownership

| Stream | Scope | Primary Owner | Secondary Owner |
|---|---|---|---|
| `S1-Backend` | FastAPI API, audio processing, storage, integrations | Backend Lead | Architect |
| `S2-Frontend` | React UI, recording/upload UX, state management | Frontend Lead | Architect |
| `S3-Integration` | Contract governance, end-to-end validation, release gate | Architect | QA Owner |

## Dependency Model

- `S1-Backend` and `S2-Frontend` run in parallel after Gate 1.
- `S2-Frontend` may use mocks until API contract freeze at Gate 2.
- No breaking API changes are allowed after Gate 2 without Architect approval and version bump.
- `S3-Integration` begins hard integration after Gate 3 (both streams functionally complete).

## Phase Gates

| Gate | Milestone | Required Outputs | Completion Criteria |
|---|---|---|---|
| `Gate 0` | Kickoff + Scope Lock | In-scope features, non-goals, owner assignments | Scope and owners documented; unresolved decisions are assigned |
| `Gate 1` | Architecture Baseline | Architecture outline, risk log, test approach | Both streams have implementation backlogs and dependency map |
| `Gate 2` | **API Contract Freeze** | OpenAPI spec, request/response schemas, error model, examples | Backend + Frontend + Architect sign-off; mocks/fixtures available; change control enabled |
| `Gate 3` | Stream Complete | Independent stream feature completion reports | Backend API tests pass; Frontend UI/unit tests pass; no Sev-1 defects |
| `Gate 4` | Integrated System Ready | Shared-environment integration and E2E report | Core flow passes: record/upload -> transcribe -> history retrieval |
| `Gate 5` | Release Readiness | Release checklist, rollback plan, known issues | Health checks validated; docs updated; all stream owners sign off |

## Phase Plan

### Phase 0: Alignment (to Gate 0)
- `S3-Integration`: finalize scope, acceptance criteria, and ownership map.
- Completion criteria:
  - Feature list and exclusions are frozen.
  - Risk register exists with owner per risk.

### Phase 1: Architecture + Contract Draft (to Gate 1)
- `S1-Backend`: define API/resource boundaries and processing architecture.
- `S2-Frontend`: define view states and required data contract.
- `S3-Integration`: publish stream dependency map and test strategy.
- Completion criteria:
  - Backlogs for both streams are approved.
  - Cross-stream dependencies are explicit and scheduled.

### Phase 2: Contract Freeze + Parallel Build Start (to Gate 2)
- `S1-Backend`: publish OpenAPI and typed schemas.
- `S2-Frontend`: bind API layer to contract and generate mocks.
- `S3-Integration`: enforce contract change policy.
- Completion criteria:
  - API contract freeze signed.
  - Frontend can continue independently on mocks.

### Phase 3: Independent Stream Delivery (to Gate 3)
- `S1-Backend`: implement `/api/upload`, `/api/transcriptions`, `/api/audio/{id}`, `/api/health`; add tests.
- `S2-Frontend`: implement recorder/upload, transcription view, history view, loading/error states; add tests.
- `S3-Integration`: monitor readiness and defect triage.
- Completion criteria:
  - Backend tests pass for critical API paths.
  - Frontend tests pass against contract fixtures.
  - No blocker defects remain.

### Phase 4: Integration + Hardening (to Gate 4)
- `S1-Backend` + `S2-Frontend`: integrate on shared environment and resolve defects.
- `S3-Integration`: execute E2E happy path and key negative path checks.
- Completion criteria:
  - E2E flow is stable across target environments.
  - Contract tests remain green after integration fixes.

### Phase 5: Release Gate (to Gate 5)
- `S3-Integration`: run final readiness review.
- `S1-Backend`: validate deployment, rollback, and health behavior.
- `S2-Frontend`: validate production build and runtime config.
- Completion criteria:
  - Release checklist is complete.
  - Runbook and implementation docs are current.

## Working Rules

- Contract-breaking changes after Gate 2 require rationale, approval from Architect + both stream leads, and versioned migration notes.
- A phase closes only when its completion criteria are met; schedule date alone does not close a phase.
