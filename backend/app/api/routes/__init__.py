from fastapi import APIRouter

from app.api.routes.transcriptions import router as transcriptions_router

router = APIRouter()
router.include_router(transcriptions_router)

