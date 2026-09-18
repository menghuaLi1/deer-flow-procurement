from types import SimpleNamespace

import pytest

from deerflow.config.agents_config import load_agent_config, load_agent_soul
from deerflow.procurement.tools import (
    _extract_boq_requirements,
    procurement_parse_requirements_tool,
    procurement_render_report_tool,
    procurement_save_state_tool,
)


def _runtime(tmp_path, state=None):
    outputs = tmp_path / "outputs"
    uploads = tmp_path / "uploads"
    outputs.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(
        state={
            "thread_data": {
                "outputs_path": str(outputs),
                "uploads_path": str(uploads),
            },
            **(state or {}),
        },
        context={"thread_id": "thread-1"},
    )


def test_builtin_procurement_agent_loads():
    cfg = load_agent_config("procurement-agent")

    assert cfg is not None
    assert cfg.name == "procurement-agent"
    assert "procurement" in (cfg.tool_groups or [])
    assert "Procurement Agent" in (load_agent_soul("procurement-agent") or "")


def test_procurement_parse_requirements_from_text(tmp_path):
    result = procurement_parse_requirements_tool.func(
        runtime=_runtime(tmp_path),
        filepaths=None,
        free_text=(
            "| 材料名称 | 规格型号 | 数量 | 单位 | 备注 |\n"
            "| --- | --- | --- | --- | --- |\n"
            "| 消防水泵 | Q=40L/s, H=80m | 3 | 台 | 立式 |\n"
            "| 湿式报警阀组 | ZSFZ150 | 6 | 组 | 1.6MPa |\n"
        ),
        project_name="苏州工业园区消防工程",
        delivery_address="苏州市工业园区项目现场",
        due_date="2026-09-15前",
        budget="40万以内",
        brand_requirement="允许同等品",
        allow_equivalent=True,
        tool_call_id="tc-1",
    )

    procurement = result.update["procurement"]
    assert procurement["stage"] == "standardization"
    assert procurement["metrics"]["requirements_total"] == 2
    assert procurement["requirements"][0]["material_name"] == "消防水泵"
    assert procurement["requirements"][0]["quantity"] == 3.0
    assert procurement["pending_questions"] == []


def test_boq_parser_extracts_material_items_and_ignores_measure_rows():
    text = (
        "## 1 表-08 分部分项工程和单价措施项目清单与计价表\n"
        "| 序号 | 项目编码 | 项目名称 | 项目特征描述 | 计量\\n单位 | 工程量 | 金额（元） |\n"
        "| --- | --- | --- | --- | --- | --- | --- |\n"
        "| 1 | 030901002001 | 消火栓钢管 | 1.镀锌钢管DN65，丝接 | m | 12.5 | |\n"
        "| 2 | 030901010001 | 室内消火栓 | 减压稳压型组合式消防柜700×240×1800 | 个 | NaN | |\n"
        "| NaN | NaN | 分部小计 | NaN | NaN | NaN | |\n"
        "| NaN | NaN | 分部分项合计 | NaN | NaN | NaN | |\n"
        "| 3 | 031301017001 | 脚手架搭拆 | NaN | 项 | NaN | |\n"
        "## 2 表-11 总价措施项目清单与计价表\n"
        "| 序号 | 项目编码 | 项目名称 | 计算基础 |\n"
        "| 1 | 031302001001 | 安全文明施工费 | |\n"
    )

    requirements = _extract_boq_requirements(text)

    assert len(requirements) == 2
    assert requirements[0]["item_code"] == "030901002001"
    assert requirements[0]["specification"] == "1.镀锌钢管DN65，丝接"
    assert requirements[0]["status"] == "standardized"
    assert requirements[1]["material_name"] == "室内消火栓"
    assert requirements[1]["quantity"] is None
    assert requirements[1]["status"] == "needs_confirmation"
    assert "quantity" in requirements[1]["missing_fields"]


def test_procurement_save_state_rejects_bad_stage(tmp_path):
    result = procurement_save_state_tool.func(
        runtime=_runtime(tmp_path),
        procurement={"stage": "contracting"},
        tool_call_id="tc-2",
    )

    assert "procurement" not in result.update
    assert "Invalid procurement stage" in result.update["messages"][0].content


def test_procurement_save_state_links_candidate_aliases_to_requirement(tmp_path):
    result = procurement_save_state_tool.func(
        runtime=_runtime(tmp_path),
        procurement={
            "stage": "sourcing",
            "requirements": [
                {
                    "id": "R1",
                    "material_name": "感烟探测器",
                    "quantity": 10,
                    "unit": "只",
                }
            ],
            "candidates": [
                {
                    "id": "C1",
                    "supplier_name": "示例供应商",
                    "matched_requirement_ids": ["R1"],
                    "items": ["感烟探测器", "探测器底座"],
                    "region": "江苏苏州",
                    "source_urls": ["https://example.com"],
                    "risk_notes": ["授权待确认"],
                }
            ],
        },
        tool_call_id="tc-candidate-aliases",
    )

    candidate = result.update["procurement"]["candidates"][0]
    assert candidate["requirement_id"] == "R1"
    assert candidate["material_name"] == "感烟探测器"
    assert candidate["location"] == "江苏苏州"
    assert candidate["evidence_urls"] == ["https://example.com"]
    assert candidate["risks"] == ["授权待确认"]


def test_procurement_render_report_writes_artifacts(tmp_path):
    state = {
        "procurement": {
            "stage": "decision",
            "project": {"project_name": "消防工程"},
            "requirements": [
                {
                    "id": "req-1",
                    "material_name": "消防水泵",
                    "specification": "Q=40L/s, H=80m",
                    "quantity": 3,
                    "unit": "台",
                    "status": "standardized",
                }
            ],
            "candidates": [
                {
                    "supplier_name": "示例供应商",
                    "material_name": "消防水泵",
                    "match_score": 88,
                    "price_range": "待确认",
                    "lead_time": "待确认",
                    "risks": ["公开报价不足"],
                }
            ],
            "evidence": [{"title": "供应商官网", "url": "https://example.com", "status": "pending_manual_confirmation"}],
            "decision": {"summary": "建议先人工确认报价和授权。", "manual_confirmation_required": True},
            "pending_questions": [],
        }
    }

    result = procurement_render_report_tool.func(
        runtime=_runtime(tmp_path, state),
        filename_prefix="procurement-test",
        tool_call_id="tc-3",
    )

    artifacts = result.update["artifacts"]
    assert len(artifacts) == 4
    assert artifacts[0].endswith(".docx")
    assert artifacts[1].endswith(".pdf")
    assert artifacts[2].endswith(".json")
    assert artifacts[3].endswith(".md")
    assert result.update["procurement"]["project"]["project_name"] == "消防工程"

    outputs_dir = tmp_path / "outputs"
    assert any(path.name.startswith("procurement-test") and path.suffix == ".md" for path in outputs_dir.iterdir())


def test_procurement_render_report_normalizes_model_alias_fields(tmp_path):
    state = {
        "procurement": {
            "stage": "decision",
            "project_name": "苏州工业园区A栋消防改造项目",
            "delivery_address": "江苏省苏州市工业园区星湖街328号A栋",
            "due_date": "2026-09-20",
            "budget": {"currency": "CNY", "upper_limit": 180000, "note": "含税含运优先"},
            "brand_requirement": "优先海湾；允许同等品",
            "project": {"name": "苏州工业园区A栋消防改造项目"},
            "requirements": [
                {
                    "item": "点型光电感烟火灾探测器",
                    "spec": "JTY-GD-G3T，编码型，含底座",
                    "qty": 120,
                    "unit": "只",
                    "brand": "海湾或同等品",
                    "note": "需3C认证",
                }
            ],
            "candidates": [
                {
                    "name": "智淼君安（江苏）消防工程技术有限公司",
                    "items": ["海湾火灾报警设备"],
                    "evidence": [{"url": "http://www.gstxf.com", "desc": "官网"}],
                    "verification": "confirmed_partial",
                    "total_score": 80,
                    "cons": "授权函、报价、交期需确认",
                }
            ],
            "evidence": [
                {
                    "item": "海湾JTY-GD-G3T感烟探测器",
                    "source_url": "https://example.com/gst",
                    "verified": True,
                    "note": "海湾品牌，3C认证",
                }
            ],
            "decision": {
                "rationale": "建议从授权渠道统一采购。",
                "risk_notes": ["需核验授权函"],
                "pending_confirmations": ["含税含运报价"],
            },
            "pending_questions": [
                {"field": "budget", "question": "请补充预算上限或可接受价格区间。"},
            ],
        }
    }

    result = procurement_render_report_tool.func(
        runtime=_runtime(tmp_path, state),
        filename_prefix="procurement-alias",
        tool_call_id="tc-alias",
    )

    md_path = tmp_path / "outputs" / result.update["artifacts"][3].rsplit("/", 1)[-1]
    markdown = md_path.read_text(encoding="utf-8")

    assert "苏州工业园区A栋消防改造项目" in markdown
    assert "CNY 180000 (含税含运优先)" in markdown
    assert "点型光电感烟火灾探测器" in markdown
    assert "智淼君安（江苏）消防工程技术有限公司" in markdown
    assert "海湾火灾报警设备" in markdown
    assert "[海湾JTY-GD-G3T感烟探测器](https://example.com/gst)" in markdown
    assert "建议从授权渠道统一采购。" in markdown
    assert "请补充预算上限" not in markdown


@pytest.mark.parametrize("name", ["Procurement-Agent", "procurement-agent"])
def test_builtin_procurement_agent_name_is_case_insensitive(name):
    assert load_agent_config(name).name == "procurement-agent"
