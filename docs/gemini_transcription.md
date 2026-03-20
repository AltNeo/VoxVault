# Gemini Cloud Transcription

This repository now supports a second cloud transcription provider using Google AI Studio's Gemini API.

## What was added

- Backend provider selection via `TRANSCRIPTION_PROVIDER`
- Gemini REST client in `backend/app/services/gemini_client.py`
- Provider factory in `backend/app/services/provider_factory.py`
- Shared provider interface in `backend/app/services/transcription_provider.py`

## How it works

1. Backend receives the uploaded or recorded audio as usual.
2. Existing chunking stays in place, so large files are still split before transcription.
3. When `TRANSCRIPTION_PROVIDER=gemini`, each chunk is uploaded to the Gemini Files API.
4. Backend calls `models/{model}:generateContent` with:
   - the uploaded file URI
   - a transcription prompt
   - a JSON schema requesting:
     - `text`
     - `chunks[]` with `start`, `end`, and `text`
5. The uploaded Gemini file is deleted after the request on a best-effort basis.

## Environment variables

Set these in the root `.env` file:

```env
TRANSCRIPTION_PROVIDER=gemini
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com
REQUEST_TIMEOUT_SECONDS=1800
MAX_UPLOAD_SIZE_MB=500
```

Notes:

- `gemini-2.5-flash` is the default stable model in the code.
- If you want to test against the audio guide examples, you can override with `GEMINI_MODEL=gemini-3-flash-preview`.
- Gemini is being used here as prompt-based audio transcription, not a dedicated speech-to-text endpoint.
- Gemini docs currently say this is not for real-time transcription. That matches this app's upload and batch-style flow.

## Why this shape fits the current backend

- No route changes were needed for the frontend.
- Existing backup, conversion, chunking, storage, and diagnostics are reused.
- Chutes stays available as the default provider.
- Switching providers is an env change, not a code change.

## Next step when the key is ready

1. Add `GEMINI_API_KEY`.
2. Set `TRANSCRIPTION_PROVIDER=gemini`.
3. Start the backend in the project environment.
4. Hit `GET /api/health/provider`.
5. Upload a short MP3 or WAV and inspect transcript quality and timestamps.
