from fastapi import APIRouter

from app.api.routes.teams import router as teams_router
from app.api.routes.transcriptions import router as transcriptions_router

router = APIRouter()
router.include_router(teams_router)
router.include_router(transcriptions_router)
