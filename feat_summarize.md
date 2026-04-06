# Feature: LFM2 2.6B Meeting Summarization

Post-processing pipeline that generates structured meeting summaries from transcription text using the LFM2-2.6B model running locally via `llama-cpp-python` (GGUF format, CPU inference).

## Architecture Addition

```
Existing:  Audio → Whisper Transcription → Display text
New:       Transcription text → LFM2 2.6B (local GGUF) → Structured Summary → Display
```

```
┌─────────────────────────────────────────────────────┐
│                   BACKEND (FastAPI)                  │
│                                                     │
│  Existing:                    New:                  │
│  ┌────────────────────┐      ┌──────────────────┐   │
│  │ TranscriptionProv. │      │ SummaryService   │   │
│  │ (Whisper / Chutes) │      │ (LFM2 2.6B GGUF)│   │
│  └────────────────────┘      └──────────────────┘   │
│           │                         │               │
│           ▼                         ▼               │
│  transcriptions table       summary_text column     │
│                             summary_prompt setting  │
│                             .model-cache/lfm2/      │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1 — Backend: Model Service

**New file:** `backend/app/services/summary_service.py`

Wraps `llama-cpp-python` to load and run the LFM2-2.6B GGUF model.

| Concern | Detail |
|---|---|
| Model file | `LiquidAI/LFM2-2.6B-GGUF` — `Q4_K_M` quant (~1.67 GB) |
| Download | On `warmup()`, check if GGUF exists under `Settings.summary_model_download_root`. If missing, download via `huggingface_hub.hf_hub_download()` |
| Loading | `Llama(model_path=..., n_ctx=8192, n_threads=4, verbose=False)` |
| Inference | `model.create_chat_completion(messages=[...], max_tokens=1024, temperature=0.3)` |
| Default system prompt | "You are a meeting summarizer. Given a meeting transcript, produce a structured summary with: Key Topics, Decisions Made, Action Items (with owners if mentioned), and a Brief Summary paragraph." |
| Custom prompt | User-overridable via `summary_custom_prompt` setting |
| Thread safety | Run inference in `asyncio.to_thread()` — `llama-cpp-python` is blocking |

**Methods:**

```python
async def warmup() -> None        # download model if needed, load into memory
def is_ready() -> bool             # model loaded check
async def summarize(transcript_text: str, custom_prompt: str | None = None) -> str
def unload() -> None               # free model from memory
```

---

## Phase 2 — Backend: Storage Changes

**File:** `backend/app/db/storage.py`

| Change | Detail |
|---|---|
| New column | `ALTER TABLE transcriptions ADD COLUMN summary_text TEXT DEFAULT NULL` |
| Migration | Add to `initialize()` — check `PRAGMA table_info`, add if missing (same pattern as `title` migration) |
| New setting key | `summary_custom_prompt` in `app_settings` table |
| `update_transcription()` | Add optional `summary_text` parameter |
| `_deserialize()` | Include `summary_text` in returned dict |

---

## Phase 3 — Backend: Schema Changes

**File:** `backend/app/models/schemas.py`

| Change | Detail |
|---|---|
| `TranscriptionSummary` | Add `summary_text: str \| None = None` |
| `Transcription` | Inherits it automatically |
| New request | `SummarizeRequest` with optional `custom_prompt: str \| None = None` |
| New response | `SummaryResponse` with `id: str`, `summary_text: str` |
| `TranscriptionUpdateRequest` | Add optional `summary_text: str \| None = None` |
| New models | `SummaryPromptResponse`, `SummaryPromptUpdateRequest` |

---

## Phase 4 — Backend: New API Routes

**File:** `backend/app/api/routes/transcriptions.py`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/transcriptions/{id}/summarize` | Generate summary for existing transcription |
| `GET` | `/summary-prompt` | Get current custom summary prompt |
| `PUT` | `/summary-prompt` | Update custom summary prompt |
| `GET` | `/health/summary-model` | Check if LFM2 model is loaded |

**`POST /transcriptions/{id}/summarize` flow:**

1. Fetch transcription from storage — 404 if not found
2. Validate `transcription.text` is non-empty
3. Resolve effective prompt: request body > stored setting > default
4. Call `summary_service.summarize(text, prompt)` via `asyncio.to_thread`
5. Store `summary_text` via `storage.update_transcription()`
6. Return `SummaryResponse`

---

## Phase 5 — Backend: Dependency & Config

**`requirements.txt`** — add:

```
llama-cpp-python
huggingface-hub
```

**`config.py`** — new fields:

```python
summary_model_enabled: bool = True
summary_model_repo: str = "LiquidAI/LFM2-2.6B-GGUF"
summary_model_filename: str = "LFM2-2.6B-Q4_K_M.gguf"
summary_model_download_root: Path = REPO_ROOT / "backend" / ".model-cache" / "lfm2"
summary_max_tokens: int = 1024
summary_n_ctx: int = 8192
summary_n_threads: int = 4
```

**`main.py`** — add `SummaryService` to `AppServices`, call `warmup()` on startup (non-fatal).

**`deps.py`** — add `summary_service` to `AppServices` dataclass.

---

## Phase 6 — Frontend: Type Changes

**File:** `frontend/src/types/api.ts`

```typescript
// Add to TranscriptionSummary
summary_text: string | null;

// New types
interface SummaryResponse {
  id: string;
  summary_text: string;
}

interface SummaryPromptResponse {
  custom_prompt: string;
}

interface SummaryModelHealthResponse {
  ready: boolean;
  model_name: string | null;
  detail: string | null;
}
```

---

## Phase 7 — Frontend: API Client

**File:** `frontend/src/services/api.ts`

Add to `ApiClient` interface and both HTTP/mock implementations:

| Method | HTTP call |
|---|---|
| `summarizeTranscription(id, customPrompt?)` | `POST /api/transcriptions/{id}/summarize` |
| `getSummaryPrompt()` | `GET /api/summary-prompt` |
| `updateSummaryPrompt(prompt)` | `PUT /api/summary-prompt` |
| `summaryModelHealth()` | `GET /api/health/summary-model` |

---

## Phase 8 — Frontend: Hook Changes

**File:** `frontend/src/hooks/useTranscription.ts`

Extend with:

```typescript
isSummarizing: boolean;
generateSummary: (id: string, customPrompt?: string) => Promise<void>;
```

Calls the summarize API, then re-fetches the transcription to update `activeTranscription` with the new `summary_text`. Keeps one source of truth.

---

## Phase 9 — Frontend: UI Changes

### 9a. `TranscriptionView.tsx` — Summary Section

Below the existing transcript textarea:

- **"Generate Summary" button** — visible when `transcription` exists and `summary_text` is null. Calls `generateSummary(transcription.id)`.
- **Summary display** — read-only block showing `summary_text` when populated. Whitespace-preserving.
- **"Regenerate Summary" button** — visible when `summary_text` already exists.
- **"Copy Summary" button** — copies `summary_text` to clipboard.
- **Loading state** — spinner + "Generating summary..." while `isSummarizing` is true.

### 9b. `TranscriptionHistory.tsx` — Summary Indicator

Small visual indicator on history items that have a `summary_text` set — lets the user see which transcriptions have been summarized.

### 9c. `Home.tsx` — Summary Prompt Toggle

Mirror the existing "Known Misspellings" popover:

- New toggle button in topbar: **"Summary Prompt"**
- Popover with textarea to edit the summary system prompt
- Save/Reset buttons bound to `GET/PUT /api/summary-prompt`

### 9d. `ProviderStatusIndicator.tsx` — Model Status

Secondary status line showing LFM2 model readiness:

- Call `GET /api/health/summary-model`
- Display "Summary model: ready" or "Summary model: not loaded"

---

## Phase 10 — Frontend: CSS

| Element | Notes |
|---|---|
| `.summary-section` | Distinct block below transcript, border-top separator |
| `.summary-body` | Pre-wrap text, slightly different background |
| `.summary-actions` | Button row for Generate/Regenerate/Copy |
| `.summary-indicator` | Small badge on history items |
| `.summary-loading` | Spinner + fade animation |

---

## File Change Matrix

### New files

| File | Purpose |
|---|---|
| `backend/app/services/summary_service.py` | LFM2 model wrapper |

### Modified files

| File | Changes |
|---|---|
| `backend/requirements.txt` | Add `llama-cpp-python`, `huggingface-hub` |
| `backend/app/core/config.py` | Summary model settings |
| `backend/app/models/schemas.py` | Summary schemas, `summary_text` field |
| `backend/app/db/storage.py` | `summary_text` column + migration |
| `backend/app/api/routes/transcriptions.py` | Summarize + prompt routes |
| `backend/app/api/deps.py` | `summary_service` on `AppServices` |
| `backend/app/main.py` | Wire `SummaryService`, warmup |
| `frontend/src/types/api.ts` | Summary types |
| `frontend/src/services/api.ts` | Summary API methods |
| `frontend/src/hooks/useTranscription.ts` | `generateSummary` + state |
| `frontend/src/components/TranscriptionView.tsx` | Summary section UI |
| `frontend/src/components/TranscriptionHistory.tsx` | Summary indicator |
| `frontend/src/components/ProviderStatusIndicator.tsx` | Model health line |
| `frontend/src/pages/Home.tsx` | Summary prompt popover |
| `frontend/src/App.css` | Summary styles |

---

## Implementation Order

1. `requirements.txt` + `config.py` — dependencies and settings
2. `summary_service.py` — model download, load, inference
3. `storage.py` — `summary_text` column migration
4. `schemas.py` — new models
5. `transcriptions.py` — `/summarize`, `/summary-prompt`, `/health/summary-model` routes
6. `deps.py` + `main.py` — wiring
7. `types/api.ts` — frontend types
8. `api.ts` — API client methods
9. `useTranscription.ts` — hook extension
10. `TranscriptionView.tsx` — summary section UI
11. `TranscriptionHistory.tsx` — indicator
12. `Home.tsx` + `ProviderStatusIndicator.tsx` — prompt toggle, status
13. CSS — styles

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| ~1.67 GB model download on first run | Show progress in health endpoint; lazy-download on first summarize call |
| ~2 GB RAM for loaded model (on top of Whisper ~1 GB) | Lazy-load only when summary requested; unload after idle timeout |
| CPU inference ~30-60s for 1K token output | Async with spinner; user can continue using app |
| Very long transcripts exceeding 8K context | Truncate to ~6K tokens (~24K chars); or chunk-summarize-merge |
| `llama-cpp-python` C++ build on Windows | Pre-built wheels on PyPI; document build prereqs if needed |
