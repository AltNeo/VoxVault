# Backend to Wispr (faster-whisper): Required Decisions

This document lists the decisions we need to make before and during migration from the current backend transcription provider to a local `faster-whisper` implementation (CPU-only, target: 8 threads).

## 1) Scope and success criteria

### Decision: What does “usable” mean for VoxVault?
- Maximum acceptable transcription latency per audio length (e.g., 5 min audio completes in under X minutes).
- Minimum transcript quality target (word error tolerance by use case: meetings, notes, action items).
- Whether this migration is a full replacement or first a provider option behind a feature flag.

### Decision: What workloads are in scope?
- English-only vs multilingual.
- Upload-only, recording-only, or both.
- Typical file lengths (short clips vs 30–120 minute recordings).

## 2) Provider strategy and rollout model

### Decision: Cutover strategy
- **Option A:** Hard switch from Chutes to `faster-whisper`.
- **Option B:** Dual provider (`ASR_PROVIDER=chutes|faster_whisper`) with staged rollout.
- **Option C:** Hybrid fallback (local first, remote fallback on failure/timeouts).

### Decision: Migration safety controls
- Do we keep Chutes code path temporarily for rollback?
- What trigger flips traffic back (error rate, timeout rate, UX complaints)?

## 3) Model and decoding configuration

### Decision: Model family and size
- Candidate sizes: `base`, `small`, `medium`, etc.
- Tradeoff: quality vs CPU speed and RAM.
- English-specific (`*.en`) vs multilingual model.

### Decision: Runtime compute settings
- `device="cpu"` (fixed).
- `cpu_threads=8` (target requirement).
- `compute_type` (`int8` strongly preferred for CPU efficiency vs `float32` quality/stability).

### Decision: Decode behavior defaults
- Beam size (`beam_size`) vs speed.
- VAD enabled or disabled (`vad_filter`) and parameter tuning.
- Prompt usage (`initial_prompt`) mapping from existing custom prompt semantics.
- Timestamp granularity: segment-only vs word timestamps.

## 4) API and contract compatibility

### Decision: Keep API responses exactly stable or evolve?
- Ensure output still matches current contract (`text`, `chunks`, status fields) for frontend compatibility.
- Decide whether `/health/provider` remains provider-centric or becomes local-engine-centric.

### Decision: Health status semantics
- Existing statuses are remote-provider oriented (`not_configured`, `auth_failed`, etc.).
- Need new local statuses (e.g., `model_loading`, `model_ready`, `model_missing`, `engine_error`).
- Decide whether to preserve legacy fields for UI compatibility during transition.

## 5) Audio pipeline behavior

### Decision: Chunking strategy with local inference
- Keep current max-size chunk split logic, or move to duration-based chunking.
- Ensure chunk boundary stitching quality (avoid sentence cuts and duplicate text).

### Decision: Preprocessing standard
- Keep current conversion to mono 16 kHz for deterministic behavior.
- Decide whether to rely on current FFmpeg pipeline vs PyAV decode path provided by `faster-whisper`.

### Decision: Prompt and language handling
- Fixed language from client (`en`) vs auto-detection.
- Per-request prompt override precedence vs stored prompt.

## 6) Concurrency and backend architecture

### Decision: Inference lifecycle
- One model singleton loaded at startup vs lazy load on first request.
- Preload model at app boot for predictable first-request latency vs faster startup.

### Decision: Execution isolation
- How to keep CPU-bound inference from blocking API responsiveness:
  - Thread pool/offload from request loop.
  - Request queue with bounded concurrency.
- Decide maximum concurrent transcriptions on CPU-only system.

### Decision: Backpressure policy
- Queue depth limits.
- Rejection behavior when overloaded (429 vs 503, with retry guidance).

## 7) Packaging, deployment, and offline behavior

### Decision: Model artifact strategy
- Download on first run from Hugging Face cache.
- Pre-bundle model with app installer.
- Enterprise/offline mode with local-only model path.

### Decision: Storage and cache location
- Where model/cache lives on Windows for Electron-managed backend.
- Disk quota and cleanup behavior for stale/unused model files.

### Decision: Dependency policy
- Pin exact `faster-whisper` and `ctranslate2` versions.
- Validate wheel availability and compatibility for target Python runtime.
- Reproducible environment lock strategy.

## 8) Reliability and error handling

### Decision: Error taxonomy updates
- Map local engine failures to stable API error codes.
- Distinguish user-fixable errors (missing model, unsupported file) vs internal engine failures.

### Decision: Timeout policy
- Per-request timeout thresholds for CPU inference.
- Behavior when inference exceeds budget (cancel, partial result, or hard fail).

### Decision: Recovery behavior
- Automatic model reload after engine crash.
- Retry policy (if any) and idempotency expectations.

## 9) Observability and diagnostics

### Decision: Metrics we must collect
- End-to-end latency, decode latency, queue wait time, audio length, failure codes.
- Throughput under 8-thread setting.
- Memory footprint and startup/model-load timings.

### Decision: Baseline and comparison method
- Define A/B benchmark set against current provider.
- Establish pass/fail thresholds before full rollout.

## 10) Security and privacy

### Decision: Data handling guarantees
- Explicitly define local-only processing guarantees for marketing/product messaging.
- Ensure no accidental outbound calls when local mode is enabled (except optional model download path).

### Decision: Sensitive data retention
- Audio/transcript retention policy in local storage and logs.
- Redaction policy for diagnostics if transcripts include sensitive content.

## 11) Test strategy and acceptance gates

### Decision: Test coverage needed before launch
- Unit tests for local provider adapter and chunk merge behavior.
- Integration tests for upload/transcribe/history flows.
- Regression tests for prompt behavior and language handling.

### Decision: Performance acceptance gates
- Test matrix by audio duration and file type.
- Pass criteria for latency and failure rate on representative hardware.

### Decision: Release gating
- Staged release with telemetry checkpoints.
- Rollback criteria and owner on-call process.

## 12) Recommended default starting choices (to accelerate implementation)

If we want a low-risk first implementation:
- Provider mode: dual-provider feature flag.
- Model: `small.en` (or `small` if multilingual required).
- Runtime: `device="cpu"`, `cpu_threads=8`, `compute_type="int8"`.
- Decoding: conservative beam size, VAD enabled, segment timestamps.
- Architecture: singleton model + bounded request queue + clear overload errors.
- Rollout: internal dogfood first, then gradual user rollout with rollback ready.

## 13) Immediate decision checklist for kickoff

1. Choose rollout mode (hard switch vs dual-provider).
2. Choose first model + compute type for CPU.
3. Lock latency/quality acceptance thresholds.
4. Decide model download/bundling strategy.
5. Approve API/health status compatibility approach.
6. Approve queue/concurrency policy.
7. Approve benchmark plan and rollout gates.

