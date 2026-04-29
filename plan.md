# Plan: VoxVault — Electron Audio Transcription Application

A desktop application (Electron + React) with Python/FastAPI backend that captures system audio and microphone, backs up recordings locally, transcribes primarily with local Whisper Small on CPU, falls back to Chutes when needed, and displays results.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ELECTRON APP (Desktop)                           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 Renderer Process (React)                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │ │
│  │  │ System Audio │  │ File Upload  │  │ Transcription View  │ │ │
│  │  │ Recorder     │  │ Component    │  │ + History           │ │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                          │ IPC                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                 Main Process (Node.js)                         │ │
│  │  - desktopCapturer for system audio                           │ │
│  │  - File system access for local backup                        │ │
│  │  - IPC bridge to renderer                                     │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                           │ HTTP (localhost:8000)
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND (FastAPI)                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ API Routes: /upload, /transcriptions, /audio/{id}, /health   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐   │
│  │ Audio Backup   │  │ Format Convert │  │ Local Whisper Small │   │
│  │ (Local FS)     │  │ (FFmpeg)       │  │ + Chutes Fallback   │   │
│  └────────────────┘  └────────────────┘  └─────────────────────┘   │
│           │                                       │                 │
│           ▼                                       ▼                 │
│   ./backups/*.wav                    ./backend/.model-cache         │
└─────────────────────────────────────────────────────────────────────┘
```

## Why Electron?

Browser-based web apps cannot capture system audio (security sandbox). Since the use case requires recording Teams/Zoom meetings without a bot, Electron's `desktopCapturer` API enables:
- **System audio capture** via screen share with audio (no admin required)
- **Microphone capture** simultaneously
- **Local file system access** for backups without user prompts
- **Single integrated experience** — no browser tab required

## Streams and Ownership

| Stream | Scope | Primary Owner | Secondary Owner |
|---|---|---|---|
| `S1-Backend` | FastAPI API, audio processing, storage, local Whisper integration, Chutes fallback | Backend Lead | Architect |
| `S2-Electron` | Electron main/renderer, system audio capture, React UI, IPC | Frontend Lead | Architect |
| `S3-Integration` | Contract governance, E2E validation, packaging, release gate | Architect | QA Owner |

## Frontend Structure (Electron + React)

```
frontend/
├── electron/
│   ├── main.ts                # Electron main process entry
│   ├── preload.ts             # Secure IPC bridge (contextBridge)
│   └── ipc-handlers.ts        # IPC channel handlers
├── src/
│   ├── components/
│   │   ├── SystemAudioRecorder.tsx   # desktopCapturer integration
│   │   ├── FileUploader.tsx          # Drag-drop + file picker
│   │   ├── AudioPlayer.tsx           # Playback with waveform
│   │   ├── TranscriptionView.tsx     # Display transcription text
│   │   └── TranscriptionHistory.tsx  # List of past transcriptions
│   ├── hooks/
│   │   ├── useSystemAudio.ts         # IPC calls for audio capture
│   │   └── useTranscription.ts       # Backend API calls
│   ├── services/
│   │   └── api.ts                    # HTTP client for FastAPI
│   ├── pages/
│   │   └── Home.tsx                  # Main page layout
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── electron-builder.json             # Packaging config
├── vite.config.ts
└── tsconfig.json
```

## Backend Structure (FastAPI — Unchanged)

```
backend/
├── app/
│   ├── main.py                # FastAPI app entry
│   ├── api/
│   │   ├── routes/
│   │   │   ├── transcription.py   # /transcribe, /transcriptions
│   │   │   └── audio.py           # /upload, /audio/{id}
│   │   └── deps.py
│   ├── services/
│   │   ├── local_whisper_client.py # Local Whisper Small wrapper
│   │   ├── chutes_client.py       # Chutes.ai fallback wrapper
│   │   ├── transcription_provider.py # Provider orchestration
│   │   ├── audio_processor.py     # FFmpeg conversion
│   │   └── backup_service.py      # Local file storage
│   ├── models/
│   │   └── schemas.py
│   ├── core/
│   │   ├── config.py
│   │   └── exceptions.py
│   └── db/
│       └── storage.py             # SQLite metadata
├── backups/
├── requirements.txt
└── .env
```

## System Audio Capture Flow

```
1. User clicks "Start Recording" in Electron app
       │
       ▼
2. Renderer requests audio sources via IPC
       │
       ▼
3. Main process calls desktopCapturer.getSources({ types: ['screen'] })
       │
       ▼
4. Renderer gets stream via navigator.mediaDevices.getUserMedia({
     audio: { mandatory: { chromeMediaSource: 'desktop' } },
     video: { mandatory: { chromeMediaSource: 'desktop' } }
   })
       │
       ▼
5. Extract audio track, discard video track
       │
       ▼
6. MediaRecorder captures audio chunks (WebM/Opus)
       │
       ▼
7. On stop: Blob → File → POST to /api/upload
       │
       ▼
8. Backend: backup → convert → transcribe → return
```

## Phase Gates

| Gate | Milestone | Required Outputs | Completion Criteria |
|---|---|---|---|
| `Gate 0` | Kickoff + Scope Lock | In-scope features, non-goals, owner assignments | Scope frozen; risks logged |
| `Gate 1` | Architecture Baseline | Architecture diagram, Electron scaffolding, test approach | Backlogs approved |
| `Gate 2` | **API Contract Freeze** | OpenAPI spec, IPC channel definitions, error model | Backend + Electron sign-off |
| `Gate 3` | Stream Complete | Independent stream feature completion | Tests pass; no blockers |
| `Gate 4` | Integrated System Ready | E2E validation report | Core flow passes |
| `Gate 5` | Release Readiness | Packaged installer, release checklist | All owners sign off |

## Phase Plan

### Phase 0: Alignment (to Gate 0)
- `S3-Integration`: finalize scope, acceptance criteria, and ownership map.
- Completion criteria:
  - Feature list and exclusions are frozen.
  - Risk register exists with owner per risk.

### Phase 1: Architecture + Electron Setup (to Gate 1)
- `S1-Backend`: define API/resource boundaries and processing architecture.
- `S2-Electron`: scaffold Electron project with Vite + React; implement desktopCapturer proof-of-concept.
- `S3-Integration`: publish stream dependency map and test strategy.
- Completion criteria:
  - Electron app launches and captures system audio.
  - Backlogs for both streams are approved.

### Phase 2: Contract Freeze + Parallel Build (to Gate 2)
- `S1-Backend`: publish OpenAPI and typed schemas.
- `S2-Electron`: define IPC channels; bind API layer to contract; generate mocks.
- `S3-Integration`: enforce contract change policy.
- Completion criteria:
  - API contract freeze signed.
  - IPC channel contract documented.

### Phase 3: Independent Stream Delivery (to Gate 3)
- `S1-Backend`: implement `/api/upload`, `/api/transcriptions`, `/api/audio/{id}`, `/api/health`; add tests.
- `S2-Electron`: implement system audio recorder, file upload, transcription view, history; add tests.
- `S3-Integration`: monitor readiness and defect triage.
- Completion criteria:
  - Backend tests pass for critical API paths.
  - Electron UI tests pass.
  - No blocker defects remain.

### Phase 4: Integration + Hardening (to Gate 4)
- `S1-Backend` + `S2-Electron`: integrate and resolve defects.
- `S3-Integration`: execute E2E happy path and negative path checks.
- Completion criteria:
  - Core flow passes: record system audio → backup → transcribe → display.
  - Contract tests remain green.

### Phase 5: Release Gate (to Gate 5)
- `S3-Integration`: run final readiness review.
- `S1-Backend`: validate health endpoint and deployment.
- `S2-Electron`: build Windows installer with electron-builder; test installation.
- Completion criteria:
  - Packaged `.exe` installer works on clean Windows system.
  - Release checklist complete.

## Key Electron Considerations

### IPC Security (Context Isolation)
- Use `contextBridge` in preload script to expose safe APIs.
- Never expose `ipcRenderer` directly to renderer process.

```typescript
// preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  getAudioSources: () => ipcRenderer.invoke('get-audio-sources'),
  saveRecording: (buffer: ArrayBuffer) => ipcRenderer.invoke('save-recording', buffer),
});
```

### Packaging
- Use `electron-builder` for Windows `.exe` installer.
- Bundle backend Python as optional (user runs separately) or embed with PyInstaller.

### Development Workflow
- `npm run dev` — starts Vite dev server + Electron in dev mode
- `npm run build` — builds React app
- `npm run package` — creates distributable installer

## Working Rules

- Contract-breaking changes after Gate 2 require rationale, approval from Architect + both stream leads, and versioned migration notes.
- A phase closes only when its completion criteria are met; schedule date alone does not close a phase.
- Electron IPC channels are part of the contract and require the same change control as API endpoints.
