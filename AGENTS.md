# Repository Guidelines

## Project Structure & Module Organization
This repository is split by runtime:
- `backend/`: Python/FastAPI service. Keep application code under `backend/app/` (for example: `api/routes/`, `services/`, `models/`, `core/`).
- `frontend/`: React + TypeScript client. Keep UI and logic under `frontend/src/` (for example: `components/`, `hooks/`, `services/`, `pages/`).
- `plan.md`: implementation blueprint and architecture notes.

Store generated or persisted audio in `backend/backups/` (do not commit large media files).

## Build, Test, and Development Commands
Run commands from the relevant subfolder:
- `cd backend && uvicorn app.main:app --reload --port 8000`: start API locally.
- `cd backend && ruff check . && ruff format .`: lint and format Python.
- `cd backend && pytest -q`: run backend tests.
- `cd frontend && npm install`: install frontend dependencies.
- `cd frontend && npm run dev`: start Vite dev server (default `localhost:5173`).
- `cd frontend && npm run build`: create production frontend build.
- `cd frontend && npx prettier --write .`: format frontend code.

## Coding Style & Naming Conventions
Python (`backend/ruff.toml`):
- Python `3.10`, 4-space indentation, max line length `100`.
- Use double quotes; keep imports sorted.
- File/module names: `snake_case`; classes: `PascalCase`; functions/variables: `snake_case`.

Frontend (`frontend/.prettierrc`):
- 2-space indentation, `singleQuote: true`, semicolons enabled, width `100`.
- React components: `PascalCase` (for example `AudioRecorder.tsx`).
- Hooks: `useXxx` naming (for example `useTranscription.ts`).

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
