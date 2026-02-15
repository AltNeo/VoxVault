# VoxVault

**Desktop audio transcription app** — Record system audio or upload files, get instant AI-powered transcriptions.

---

## What is VoxVault?

VoxVault is a desktop application that captures audio from your system (Teams, Zoom, media players) or uploaded files and transcribes them using AI. Unlike browser-based tools, the Electron app can access system audio directly—no bots joining your meetings.

### Key Features

- 🎙️ **System Audio Capture** — Record any audio playing on your computer
- 📁 **File Upload** — Drag & drop audio files (MP3, WAV, M4A, WebM)
- ⚡ **AI Transcription** — Powered by Chutes API (Whisper-based)
- 📝 **Edit & Save** — Refine transcriptions and persist them locally
- 🕒 **History** — Browse and revisit past transcriptions

---

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **FFmpeg** (must be in PATH)

### One-Click Start (Recommended)

From the repository root, run one command to set up dependencies and launch both backend and frontend:

```powershell
./run-all.ps1
```

```bash
bash ./run-all.sh
```

Force reinstall dependencies:

```powershell
./run-all.ps1 -Install
```

```bash
bash ./run-all.sh --install
```

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/voxvault.git
cd voxvault
```

### 2. Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

Create `.env` in `/backend`:

```env
CHUTES_API_TOKEN=your_api_token_here
```

Start the API:

```bash
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The Electron app will launch with hot-reload enabled.

---

## Project Structure

```
voxvault/
├── backend/           # Python/FastAPI service
│   ├── app/
│   │   ├── api/       # Route handlers
│   │   ├── services/  # Business logic (transcription, audio processing)
│   │   ├── models/    # Pydantic schemas
│   │   └── db/        # Local storage
│   └── tests/         # Pytest tests
│
├── frontend/          # Electron + React + TypeScript
│   ├── electron/      # Main process (system audio capture)
│   ├── src/           # React renderer (UI components)
│   └── dist/          # Production build output
│
├── docs/              # Documentation
│   ├── VISUAL_DESIGN.md   # UI design system
│   └── api/           # OpenAPI spec & examples
│
├── AGENTS.md          # Repository guidelines & conventions
└── plan.md            # Architecture & implementation notes
```

---

## Scripts

### Backend

| Command | Description |
|---------|-------------|
| `uvicorn app.main:app --reload` | Start API server |
| `ruff check . && ruff format .` | Lint & format Python |
| `pytest -q` | Run tests |

### Frontend

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron + Vite dev server |
| `npm run build` | Production build |
| `npm run package` | Create Windows installer |
| `npm test` | Run Vitest tests |

### Root Helpers

| Command | Description |
|---------|-------------|
| `./run-all.ps1` | One-click setup + launch backend and frontend on Windows |
| `bash ./run-all.sh` | One-click setup + launch backend and frontend on Bash shells |
| `./run-frontend.ps1` | Frontend-only setup + launch |

---

## Configuration

| Variable | Location | Description |
|----------|----------|-------------|
| `CHUTES_API_TOKEN` | `backend/.env` | API key for transcription service |
| `ALLOWED_ORIGINS` | `backend/app/core/config.py` | CORS origins |
| `MAX_UPLOAD_SIZE_MB` | `backend/app/core/config.py` | File size limit (default: 100MB) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Desktop Shell** | Electron |
| **Frontend** | React, TypeScript, Vite |
| **Backend** | Python, FastAPI |
| **Transcription** | Chutes API (Whisper) |
| **Audio Processing** | FFmpeg, Web Audio API |
| **Storage** | Local JSON (SQLite planned) |

---

## Contributing

1. Read [`AGENTS.md`](AGENTS.md) for coding conventions
2. Check [`docs/VISUAL_DESIGN.md`](docs/VISUAL_DESIGN.md) for UI guidelines
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.)
4. Run linters before committing

---

## License

MIT
