# Repository Guidelines

## Project Structure & Module Organization
This repository is split by runtime:
- `backend/`: Python/FastAPI service. Keep application code under `backend/app/` (for example: `api/routes/`, `services/`, `models/`, `core/`).
- `frontend/`: Electron + React + TypeScript desktop client.
  - `frontend/electron/`: Electron main process code (`main.ts`, `preload.ts`, `ipc-handlers.ts`).
  - `frontend/src/`: React renderer code (`components/`, `hooks/`, `services/`, `pages/`).
- `plan.md`: implementation blueprint and architecture notes.

Store generated or persisted audio in `backend/backups/` (do not commit large media files).

## Why Electron?
Browser-based web apps cannot capture system audio due to security sandboxing. Electron's `desktopCapturer` API enables system audio capture for recording Teams/Zoom meetings without a bot joining.

## Git Commit Standards (Conventional Commits)

**Format:** `<type>(<scope>): <description>`  
(Example: `feat(auth): add oauth2 login`)

### 1. Allowed Types
* **feat**: New feature for the user
* **fix**: Bug fix for the user
* **docs**: Documentation changes only
* **style**: Formatting/Linting (no logic change)
* **refactor**: Code change (neither fix nor feature)
* **perf**: Performance improvement
* **test**: Adding/correcting tests
* **chore**: Build/config/dependency updates

### 2. Strict Writing Rules
* **Imperative Mood**: Use commands (e.g., `fix: resolve leak`, NOT `fixed` or `fixes`).
* **Casing**: Type and description must be **lowercase**.
* **Punctuation**: Never end the subject line with a period.
* **Length**: Subject line $\le$ 50 chars; never exceed 72.
* **Body**: Separate from subject with one blank line if "why/how" is required.
* **Frequency**: **Atomic Commits**—commit at every logical checkpoint/single change.Commit to get now 

## Build, Test, and Development Commands
Run commands from the relevant subfolder:

**Backend:**
- `cd backend && uvicorn app.main:app --reload --port 8000`: start API locally.
- `cd backend && ruff check . && ruff format .`: lint and format Python.
- `cd backend && pytest -q`: run backend tests.

**Frontend (Electron + React):**
- `cd frontend && npm install`: install frontend dependencies.
- `cd frontend && npm run dev`: start Vite dev server + Electron in development mode.
- `cd frontend && npm run dev:renderer`: start only the Vite dev server (for UI development).
- `cd frontend && npm run build`: build React app for production.
- `cd frontend && npm run package`: create distributable Windows installer (.exe) with electron-builder.
- `cd frontend && npm run test`: run frontend tests.
- `cd frontend && npx prettier --write .`: format frontend code.

**Full Stack (from repo root):**
- `./run-frontend.ps1`: single-command Electron workflow (installs deps if needed, runs tests, runs build, then starts dev). Optional flags: `-Install`, `-SkipTest`, `-SkipBuild`.

## Coding Style & Naming Conventions
Python (`backend/ruff.toml`):
- Python `3.10`, 4-space indentation, max line length `100`.
- Use double quotes; keep imports sorted.
- File/module names: `snake_case`; classes: `PascalCase`; functions/variables: `snake_case`.

Frontend (`frontend/.prettierrc`):
- 2-space indentation, `singleQuote: true`, semicolons enabled, width `100`.
- React components: `PascalCase` (for example `AudioRecorder.tsx`).
- Hooks: `useXxx` naming (for example `useTranscription.ts`).
- Electron main process files: `kebab-case` in `electron/` (for example `ipc-handlers.ts`).
- IPC channels: `kebab-case` strings (for example `'get-audio-sources'`, `'save-recording'`).

## Testing Guidelines
- Backend tests: `pytest`, place tests in `backend/tests/`, name files `test_*.py`.
- Frontend tests: place in `frontend/src/__tests__/` or next to components as `*.test.ts(x)`.
- Cover core flows first: upload/record -> transcription -> history retrieval.

## Commit & Pull Request Guidelines
No local Git history is available in this workspace yet, so use Conventional Commits:
- `feat(api): add upload endpoint`
- `fix(frontend): handle recorder permission error`

PR requirements:
- Clear summary, scope, and linked issue (`Closes #123`).
- Test evidence (commands run and results).
- UI screenshots/GIFs for frontend changes.
- Note config/env changes (`.env`, API keys, FFmpeg assumptions).

## Security & Configuration Tips
- Never commit secrets or raw API keys; keep them in local `.env`.
- Validate uploaded file types and size limits server-side.
- Keep `backups/` out of version control except placeholders (for example `.gitkeep`).
