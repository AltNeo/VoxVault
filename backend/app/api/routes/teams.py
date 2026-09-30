from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import AppServices, get_services

router = APIRouter(prefix="/teams", tags=["teams"])
SERVICES_DEP = Depends(get_services)


@router.get("/call-transition")
async def get_call_transition(
    services: AppServices = SERVICES_DEP,
) -> dict[str, Any]:
    return await services.teams_call_transition_service.evaluate()
