"""Procurement workflow report endpoints."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deerflow.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from deerflow.procurement.report_service import generate_procurement_reports
from deerflow.procurement.tools import _validate_procurement_state

router = APIRouter(prefix="/api/threads", tags=["procurement"])


class ProcurementReportRequest(BaseModel):
    procurement: dict[str, Any]
    formats: list[Literal["docx", "pdf", "json"]] = Field(default_factory=lambda: ["docx", "pdf", "json"])
    filename_prefix: str = "procurement-decision"


class ProcurementReportResponse(BaseModel):
    artifacts: list[str]


@router.post("/{thread_id}/procurement/reports", response_model=ProcurementReportResponse)
async def create_procurement_reports(
    thread_id: str,
    request: ProcurementReportRequest,
) -> ProcurementReportResponse:
    try:
        state = _validate_procurement_state(request.procurement)
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
        paths = generate_procurement_reports(
            state,
            outputs_dir,
            formats=request.formats,
            filename_prefix=request.filename_prefix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to generate procurement reports") from exc

    return ProcurementReportResponse(artifacts=[f"{VIRTUAL_PATH_PREFIX}/outputs/{path.name}" for path in paths])
