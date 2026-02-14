from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette import status

from app.api.deps import AppServices
from app.api.routes import router as api_router
from app.core.config import Settings, get_settings
from app.core.exceptions import APIError, build_error_payload
from app.db.storage import TranscriptionStorage
from app.services.audio_processor import AudioProcessor
from app.services.backup_service import BackupService
from app.services.chutes_client import ChutesClient


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        services: AppServices = app.state.services
        services.storage.initialize()
        services.backup_service.backup_dir.mkdir(parents=True, exist_ok=True)
        yield

    app = FastAPI(
        title=resolved_settings.app_name,
        version=resolved_settings.app_version,
        lifespan=lifespan,
    )

    app.state.services = AppServices(
        settings=resolved_settings,
        storage=TranscriptionStorage(resolved_settings.sqlite_path),
        backup_service=BackupService(resolved_settings.backup_dir),
        audio_processor=AudioProcessor(),
        chutes_client=ChutesClient(
            api_url=resolved_settings.chutes_api_url,
            api_key=resolved_settings.chutes_api_key,
            timeout_seconds=resolved_settings.request_timeout_seconds,
        ),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

    @app.exception_handler(APIError)
    async def handle_api_error(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_payload(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                request_id=_get_request_id(request),
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=build_error_payload(
                code="VALIDATION_ERROR",
                message="Request validation failed.",
                details={"errors": exc.errors()},
                request_id=_get_request_id(request),
            ),
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        details = None if isinstance(exc.detail, str) else {"detail": exc.detail}
        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_payload(
                code="HTTP_ERROR",
                message=message,
                details=details,
                request_id=_get_request_id(request),
            ),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=build_error_payload(
                code="INTERNAL_SERVER_ERROR",
                message="An unexpected error occurred.",
                request_id=_get_request_id(request),
            ),
        )

    app.include_router(api_router, prefix=resolved_settings.api_prefix)
    return app


def _get_request_id(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if isinstance(request_id, str) and request_id:
        return request_id
    return uuid4().hex


app = create_app()
