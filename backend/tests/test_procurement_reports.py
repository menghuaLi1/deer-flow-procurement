import json
import zipfile
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import procurement
from deerflow.config.paths import Paths
from deerflow.procurement.report_service import generate_procurement_reports


@pytest.fixture
def procurement_state():
    return {
        "stage": "decision",
        "project": {
            "project_name": "消防材料采购项目",
            "delivery_address": "江苏省苏州市",
            "due_date": "2026-10-01",
            "brand_requirement": "指定品牌或同等品",
        },
        "requirements": [
            {
                "id": "req-1",
                "material_name": "消防水泵",
                "specification": "Q=40L/s, H=80m",
                "quantity": 2,
                "unit": "台",
            }
        ],
        "candidates": [
            {
                "id": "candidate-1",
                "requirement_id": "req-1",
                "supplier_name": "示例供应商",
                "match_score": 88,
                "price_range": "待询价",
                "lead_time": "待确认",
                "risks": ["授权函待核验"],
            }
        ],
        "selections": {"req-1": "candidate-1"},
        "evidence": [
            {
                "title": "产品页",
                "status": "verified",
                "url": "https://example.com/product",
            }
        ],
        "decision": {"summary": "建议询价后确定成交供应商。", "risks": ["报价待确认"]},
    }


def test_generate_procurement_reports_contains_chinese_and_links(tmp_path, procurement_state):
    paths = generate_procurement_reports(procurement_state, tmp_path, formats=("docx", "pdf", "json"), filename_prefix="report")

    assert [path.suffix for path in paths] == [".docx", ".pdf", ".json"]
    assert paths[1].read_bytes().startswith(b"%PDF")
    assert paths[1].stat().st_size > 1000
    payload = json.loads(paths[2].read_text(encoding="utf-8"))
    assert payload["requirements"][0]["material_name"] == "消防水泵"

    with zipfile.ZipFile(paths[0]) as archive:
        document_xml = archive.read("word/document.xml").decode("utf-8")
    assert "消防材料采购项目" in document_xml
    assert "示例供应商" in document_xml
    assert "https://example.com/product" in document_xml


def test_generate_procurement_reports_rejects_unknown_format(tmp_path, procurement_state):
    with pytest.raises(ValueError, match="Unsupported report format"):
        generate_procurement_reports(procurement_state, tmp_path, formats=("exe",))


def test_procurement_report_endpoint_returns_artifact_paths(tmp_path, procurement_state):
    app = FastAPI()
    app.include_router(procurement.router)
    paths = Paths(tmp_path)

    with patch("app.gateway.routers.procurement.get_paths", return_value=paths):
        with TestClient(app) as client:
            response = client.post(
                "/api/threads/thread-report/procurement/reports",
                json={"procurement": procurement_state, "formats": ["json"]},
            )

    assert response.status_code == 200
    artifact = response.json()["artifacts"][0]
    assert artifact.startswith("/mnt/user-data/outputs/")
    assert paths.resolve_virtual_path("thread-report", artifact).exists()


def test_procurement_report_endpoint_rejects_invalid_thread_id(tmp_path, procurement_state):
    app = FastAPI()
    app.include_router(procurement.router)

    with patch("app.gateway.routers.procurement.get_paths", return_value=Paths(tmp_path)):
        with TestClient(app) as client:
            response = client.post(
                "/api/threads/thread.with.dot/procurement/reports",
                json={"procurement": procurement_state, "formats": ["json"]},
            )

    assert response.status_code == 422
