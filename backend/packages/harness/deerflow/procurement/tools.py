"""Tools for the procurement matching workspace.

The tools keep procurement case data structured so the frontend can render a
workflow view instead of scraping free-form chat text.
"""

from __future__ import annotations

import csv
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from deerflow.agents.thread_state import ThreadState
from deerflow.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from deerflow.procurement.report_service import generate_procurement_reports

VALID_STAGES = {
    "intake",
    "standardization",
    "sourcing",
    "evidence",
    "decision",
}

MISSING_CONDITION_QUESTIONS = {
    "delivery_address": "请补充交付地址或项目所在地。",
    "due_date": "请补充期望交付日期或最晚到货时间。",
    "brand_requirement": "请确认品牌、授权或是否允许同等品要求。",
}

NAME_KEYS = ("材料", "物料", "名称", "品名", "产品", "设备")
SPEC_KEYS = ("规格", "型号", "参数", "技术参数")
QTY_KEYS = ("数量", "工程量", "采购量")
UNIT_KEYS = ("单位", "计量单位")
BRAND_KEYS = ("品牌", "厂家", "制造商")
NOTE_KEYS = ("备注", "说明", "要求")

# Construction cost BOQs use a different vocabulary from ordinary BOMs.
BOQ_NAME_KEYS = ("项目名称",)
BOQ_SPEC_KEYS = ("项目特征描述", "特征描述")
BOQ_CODE_KEYS = ("项目编码", "材料编码")
BOQ_QTY_KEYS = ("工程量", "数量")
BOQ_UNIT_KEYS = ("计量单位", "单位")
BOQ_SECTION_MARKERS = ("分部分项工程和单价措施项目清单",)
BOQ_SUBTOTAL_NAMES = {"分部小计"}
BOQ_STOP_NAMES = {"分部分项合计", "单价措施合计", "合计"}


def _tool_message(content: str, tool_call_id: str) -> list[ToolMessage]:
    return [ToolMessage(content=content, tool_call_id=tool_call_id)]


def _resolve_thread_file(runtime: ToolRuntime[ContextT, ThreadState], filepath: str) -> Path:
    thread_id = runtime.context.get("thread_id") if runtime.context else None
    if not thread_id:
        raise ValueError("Thread ID is not available in runtime context")
    if filepath.lstrip("/").startswith(VIRTUAL_PATH_PREFIX.lstrip("/")):
        return get_paths().resolve_virtual_path(thread_id, filepath)
    return Path(filepath).expanduser().resolve()


def _prefer_markdown_companion(path: Path) -> Path:
    if path.suffix.lower() in {".pdf", ".ppt", ".pptx", ".xls", ".xlsx", ".doc", ".docx"}:
        companion = path.with_suffix(".md")
        if companion.exists():
            return companion
    return path


def _read_text_file(path: Path) -> str:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        return _read_excel_as_text(path)
    path = _prefer_markdown_companion(path)
    if path.suffix.lower() == ".csv":
        return _read_csv_as_text(path)
    return path.read_text(encoding="utf-8", errors="replace")


def _read_csv_as_text(path: Path) -> str:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)


def _read_excel_as_text(path: Path) -> str:
    try:
        import pandas as pd
    except Exception as exc:  # pragma: no cover - depends on optional runtime extras
        raise ValueError("Excel parsing requires pandas and an Excel engine") from exc

    frames = pd.read_excel(path, sheet_name=None, header=None)
    chunks: list[str] = []
    for sheet_name, frame in frames.items():
        chunks.append(f"# Sheet: {sheet_name}")
        for row in frame.fillna("").astype(str).values.tolist():
            stripped = [_clean_cell(cell) for cell in row]
            if any(stripped):
                chunks.append(" | ".join(stripped))
    return "\n".join(chunks)


def _normalize_header(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def _header_index(headers: list[str], candidates: tuple[str, ...]) -> int | None:
    normalized = [_normalize_header(h) for h in headers]
    for idx, header in enumerate(normalized):
        if any(key.lower() in header for key in candidates):
            return idx
    return None


def _clean_cell(value: str) -> str:
    value = "" if value is None else str(value)
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\s+", " ", value).strip().strip("|").strip()
    if value.casefold() in {"nan", "none", "null"}:
        return ""
    return value


def _split_table_line(line: str) -> list[str]:
    stripped = line.strip()
    if not stripped:
        return []
    if "|" in stripped:
        return [_clean_cell(part) for part in stripped.strip("|").split("|")]
    if "\t" in stripped:
        return [_clean_cell(part) for part in stripped.split("\t")]
    if "," in stripped:
        return [_clean_cell(part) for part in next(csv.reader([stripped]))]
    return []


def _looks_like_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r"[-:：\s]+", cell) for cell in cells)


def _quantity_parts(raw: str) -> tuple[float | None, str]:
    text = (raw or "").strip()
    if not text:
        return None, ""
    match = re.search(r"(-?\d+(?:\.\d+)?)", text.replace(",", ""))
    quantity = float(match.group(1)) if match else None
    unit = ""
    if match:
        unit = text[match.end() :].strip()
    return quantity, unit


def _requirement_from_cells(cells: list[str], headers: list[str], index: int) -> dict[str, Any] | None:
    name_idx = _header_index(headers, NAME_KEYS)
    qty_idx = _header_index(headers, QTY_KEYS)
    unit_idx = _header_index(headers, UNIT_KEYS)
    spec_idx = _header_index(headers, SPEC_KEYS)
    brand_idx = _header_index(headers, BRAND_KEYS)
    note_idx = _header_index(headers, NOTE_KEYS)

    if name_idx is None or name_idx >= len(cells):
        return None

    name = cells[name_idx].strip()
    if not name or name in {"材料名称", "物料名称", "名称", "品名"}:
        return None

    raw_qty = cells[qty_idx] if qty_idx is not None and qty_idx < len(cells) else ""
    quantity, inferred_unit = _quantity_parts(raw_qty)
    unit = cells[unit_idx].strip() if unit_idx is not None and unit_idx < len(cells) else inferred_unit

    requirement = {
        "id": f"req-{index}",
        "material_name": name,
        "specification": cells[spec_idx].strip() if spec_idx is not None and spec_idx < len(cells) else "",
        "quantity": quantity,
        "unit": unit,
        "brand_requirement": cells[brand_idx].strip() if brand_idx is not None and brand_idx < len(cells) else "",
        "notes": cells[note_idx].strip() if note_idx is not None and note_idx < len(cells) else "",
        "status": "standardized" if name and quantity is not None and unit else "needs_confirmation",
        "missing_fields": [],
    }
    if quantity is None:
        requirement["missing_fields"].append("quantity")
    if not unit:
        requirement["missing_fields"].append("unit")
    return requirement


def _extract_table_requirements(text: str) -> list[dict[str, Any]]:
    rows = [_split_table_line(line) for line in text.splitlines()]
    rows = [row for row in rows if row and not _looks_like_separator(row)]

    requirements: list[dict[str, Any]] = []
    for row_idx, row in enumerate(rows):
        header_score = sum(
            1
            for cell in row
            if any(key in cell for key in (*NAME_KEYS, *SPEC_KEYS, *QTY_KEYS, *UNIT_KEYS))
        )
        if header_score < 2:
            continue
        headers = row
        for candidate in rows[row_idx + 1 :]:
            item = _requirement_from_cells(candidate, headers, len(requirements) + 1)
            if item:
                requirements.append(item)
        if requirements:
            break
    return requirements


def _is_boq_heading(line: str) -> bool:
    compact = re.sub(r"\s+", "", line or "")
    return any(marker in compact for marker in BOQ_SECTION_MARKERS)


def _boq_blocks(text: str) -> list[str]:
    """Return only the cost-table sections that can contain procurement items."""
    lines = text.splitlines()
    blocks: list[str] = []
    active_lines: list[str] = []
    active = False
    found_heading = False

    for line in lines:
        if line.lstrip().startswith("#"):
            if active and active_lines:
                blocks.append("\n".join(active_lines))
            active_lines = []
            active = _is_boq_heading(line)
            found_heading = found_heading or active
            continue
        if active:
            active_lines.append(line)

    if active and active_lines:
        blocks.append("\n".join(active_lines))

    # User-entered text may contain the BOQ table without a Markdown heading.
    return blocks if found_heading else [text]


def _markdown_table_rows(text: str) -> list[list[str]]:
    """Join wrapped Markdown table rows before splitting their cells."""
    rows: list[list[str]] = []
    current: str | None = None

    def flush() -> None:
        nonlocal current
        if current:
            row = _split_table_line(current)
            if row and not _looks_like_separator(row):
                rows.append(row)
        current = None

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            flush()
            current = stripped
        elif current and stripped:
            # markitdown may put a cell's embedded newline on a separate line.
            current = f"{current} {stripped}"
        elif not stripped:
            flush()
    flush()
    return rows


def _boq_header_indexes(headers: list[str]) -> dict[str, int | None]:
    return {
        "name": _header_index(headers, BOQ_NAME_KEYS),
        "spec": _header_index(headers, BOQ_SPEC_KEYS),
        "code": _header_index(headers, BOQ_CODE_KEYS),
        "quantity": _header_index(headers, BOQ_QTY_KEYS),
        "unit": _header_index(headers, BOQ_UNIT_KEYS),
    }


def _is_boq_boundary(cells: list[str], name_idx: int | None) -> bool:
    values = {_normalize_header(cell) for cell in cells if cell}
    if values.intersection(BOQ_STOP_NAMES):
        return True
    if name_idx is not None and name_idx < len(cells):
        return _normalize_header(cells[name_idx]) in BOQ_STOP_NAMES
    return False


def _is_boq_subtotal(cells: list[str], name_idx: int | None) -> bool:
    values = {_normalize_header(cell) for cell in cells if cell}
    if values.intersection(BOQ_SUBTOTAL_NAMES):
        return True
    if name_idx is not None and name_idx < len(cells):
        return _normalize_header(cells[name_idx]) in BOQ_SUBTOTAL_NAMES
    return False


def _boq_requirement_from_cells(
    cells: list[str],
    indexes: dict[str, int | None],
    index: int,
) -> dict[str, Any] | None:
    name_idx = indexes["name"]
    code_idx = indexes["code"]
    if name_idx is None or code_idx is None or name_idx >= len(cells) or code_idx >= len(cells):
        return None

    name = _clean_cell(cells[name_idx])
    item_code = _clean_cell(cells[code_idx])
    if not name or not item_code:
        return None

    spec_idx = indexes["spec"]
    quantity_idx = indexes["quantity"]
    unit_idx = indexes["unit"]
    specification = _clean_cell(cells[spec_idx]) if spec_idx is not None and spec_idx < len(cells) else ""
    raw_quantity = cells[quantity_idx] if quantity_idx is not None and quantity_idx < len(cells) else ""
    quantity, inferred_unit = _quantity_parts(_clean_cell(raw_quantity))
    unit = _clean_cell(cells[unit_idx]) if unit_idx is not None and unit_idx < len(cells) else inferred_unit

    missing_fields: list[str] = []
    if not specification:
        missing_fields.append("specification")
    if quantity is None:
        missing_fields.append("quantity")
    if not unit:
        missing_fields.append("unit")

    return {
        "id": f"req-{index}",
        "item_code": item_code,
        "material_name": name,
        "specification": specification,
        "quantity": quantity,
        "unit": unit,
        "brand_requirement": "",
        "notes": "工程量清单项目，数量和采购口径需结合原始清单/询价确认。" if quantity is None else "",
        "status": "standardized" if not missing_fields else "needs_confirmation",
        "missing_fields": missing_fields,
    }


def _extract_boq_requirements(text: str) -> list[dict[str, Any]]:
    """Extract material items from construction cost BOQ tables.

    The parser skips section subtotals but stops at the final cost-table total.
    Cost, measure, fee, tax, and owner-supplied-material sheets are not
    sourcing requirements and must not become supplier-search items.
    """
    requirements: list[dict[str, Any]] = []
    for block in _boq_blocks(text):
        first_table_line = next(
            (line.strip() for line in block.splitlines() if "|" in line and line.strip()),
            "",
        )
        if first_table_line.startswith("|"):
            rows = _markdown_table_rows(block)
        else:
            rows = [_split_table_line(line) for line in block.splitlines()]
            rows = [row for row in rows if row and not _looks_like_separator(row)]

        for row_idx, row in enumerate(rows):
            indexes = _boq_header_indexes(row)
            if any(value is None for value in indexes.values()):
                continue

            for candidate in rows[row_idx + 1 :]:
                if _is_boq_boundary(candidate, indexes["name"]):
                    break
                if _is_boq_subtotal(candidate, indexes["name"]):
                    continue
                item = _boq_requirement_from_cells(candidate, indexes, len(requirements) + 1)
                if item:
                    requirements.append(item)
            if requirements:
                return requirements
    return requirements


def _extract_line_requirements(text: str) -> list[dict[str, Any]]:
    requirements: list[dict[str, Any]] = []
    pattern = re.compile(
        r"(?P<name>[\u4e00-\u9fa5A-Za-z0-9（）()·/\-]+)"
        r"(?:\s+(?P<spec>(?:DN|Q=|H=|ZS|SG|[A-Za-z0-9./\-])+[^\s，,]*)|)"
        r".{0,18}?"
        r"(?P<qty>\d+(?:\.\d+)?)\s*(?P<unit>套|台|组|米|m|个|件|只|批)"
    )
    for match in pattern.finditer(text):
        name = match.group("name").strip()
        if len(name) < 2:
            continue
        requirements.append(
            {
                "id": f"req-{len(requirements) + 1}",
                "material_name": name,
                "specification": (match.group("spec") or "").strip(),
                "quantity": float(match.group("qty")),
                "unit": match.group("unit"),
                "brand_requirement": "",
                "notes": "",
                "status": "standardized",
                "missing_fields": [],
            }
        )
    return requirements


def _pending_questions(project: dict[str, Any]) -> list[dict[str, str]]:
    questions: list[dict[str, str]] = []
    for key, question in MISSING_CONDITION_QUESTIONS.items():
        if key == "brand_requirement" and project.get("allow_equivalent"):
            continue
        value = project.get(key)
        if value is None or value == "" or value == []:
            questions.append({"field": key, "question": question})
    return questions


def _project_data(
    project_name: str,
    delivery_address: str,
    due_date: str,
    budget: str,
    brand_requirement: str,
    allow_equivalent: bool,
) -> dict[str, Any]:
    return {
        "project_name": project_name.strip(),
        "delivery_address": delivery_address.strip(),
        "due_date": due_date.strip(),
        "budget": budget.strip(),
        "brand_requirement": brand_requirement.strip(),
        "allow_equivalent": allow_equivalent,
    }


def _first_present(*values: Any) -> Any:
    for value in values:
        if value is not None and value != "" and value != []:
            return value
    return ""


def _as_list(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    return [value]


def _format_report_value(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        return value.replace("|", "\\|").replace("\n", " ")
    if isinstance(value, list):
        return "; ".join(filter(None, (_format_report_value(item) for item in value)))
    if isinstance(value, dict):
        amount = _first_present(value.get("amount"), value.get("upper_limit"), value.get("value"))
        currency = _first_present(value.get("currency"), value.get("unit"))
        note = _first_present(value.get("note"), value.get("budget_note"), value.get("description"))
        if amount or currency or note:
            price = " ".join(filter(None, (_format_report_value(currency), _format_report_value(amount))))
            return " ".join(filter(None, (price, f"({_format_report_value(note)})" if note else "")))
        return "; ".join(
            f"{key}: {_format_report_value(item)}"
            for key, item in value.items()
            if _format_report_value(item)
        )
    return str(value)


def _normalize_project(state: dict[str, Any]) -> dict[str, Any]:
    project = dict(state.get("project") or {})
    if not project.get("project_name"):
        project["project_name"] = _first_present(project.get("name"), state.get("project_name"), state.get("name"))
    for key in ("project_name", "delivery_address", "due_date", "budget", "brand_requirement", "allow_equivalent"):
        if not project.get(key) and state.get(key) not in (None, "", []):
            project[key] = state[key]
    return project


def _normalize_requirement(row: dict[str, Any], index: int) -> dict[str, Any]:
    material_name = _first_present(row.get("material_name"), row.get("material"), row.get("name"), row.get("item"))
    specification = _first_present(row.get("specification"), row.get("spec"), row.get("model"), row.get("parameters"))
    quantity = _first_present(row.get("quantity"), row.get("qty"), row.get("count"))
    unit = _first_present(row.get("unit"), row.get("uom"))
    notes = _first_present(row.get("notes"), row.get("note"), row.get("remark"))
    status = _first_present(row.get("status"), "standardized" if material_name and quantity != "" and unit else "needs_confirmation")
    normalized = dict(row)
    normalized.update(
        {
            "id": _first_present(row.get("id"), f"req-{index}"),
            "material_name": material_name,
            "specification": specification,
            "quantity": quantity,
            "unit": unit,
            "brand_requirement": _first_present(row.get("brand_requirement"), row.get("brand")),
            "notes": notes,
            "status": status,
            "missing_fields": row.get("missing_fields") or [],
        }
    )
    return normalized


def _normalize_candidate(
    row: dict[str, Any],
    index: int,
    requirements_by_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized = dict(row)
    risks = _first_present(
        row.get("risks"),
        row.get("risk_notes"),
        row.get("risk_items"),
        row.get("pending"),
        row.get("cons"),
    )
    evidence_urls = _first_present(row.get("evidence_urls"), row.get("source_urls"), row.get("urls"))
    if not evidence_urls and isinstance(row.get("evidence"), list):
        evidence_urls = [
            item.get("url")
            for item in row["evidence"]
            if isinstance(item, dict) and item.get("url")
        ]
    matched_requirement_ids = _as_list(
        _first_present(row.get("matched_requirement_ids"), row.get("requirement_ids"))
    )
    requirement_id = _first_present(
        row.get("requirement_id"),
        row.get("material_id"),
        matched_requirement_ids[0] if matched_requirement_ids else None,
    )
    requirement = (requirements_by_id or {}).get(str(requirement_id), {})
    material_name = _first_present(
        row.get("material_name"),
        row.get("material"),
        row.get("category"),
        requirement.get("material_name"),
        row.get("items"),
    )
    if isinstance(material_name, list):
        material_name = "; ".join(str(item) for item in material_name if item not in (None, ""))
    normalized.update(
        {
            "id": _first_present(row.get("id"), f"candidate-{index}"),
            "requirement_id": requirement_id,
            "matched_requirement_ids": matched_requirement_ids,
            "supplier_name": _first_present(row.get("supplier_name"), row.get("supplier"), row.get("name")),
            "material_name": material_name,
            "match_score": _first_present(row.get("match_score"), row.get("total_score"), row.get("score")),
            "price_range": _first_present(row.get("price_range"), row.get("price"), row.get("quote")),
            "lead_time": _first_present(row.get("lead_time"), row.get("delivery_time"), row.get("delivery")),
            "location": _first_present(row.get("location"), row.get("region")),
            "evidence_urls": evidence_urls,
            "risks": _as_list(risks),
            "status": _first_present(row.get("status"), row.get("verification")),
            "verification_status": _first_present(
                row.get("verification_status"), row.get("verification"), row.get("status")
            ),
        }
    )
    return normalized


def _normalize_evidence(row: dict[str, Any], index: int) -> dict[str, Any]:
    status = _first_present(row.get("status"), row.get("confidence"))
    if not status and row.get("verified") is not None:
        status = "已核验" if row.get("verified") else "待确认"
    normalized = dict(row)
    normalized.update(
        {
            "id": _first_present(row.get("id"), f"evidence-{index}"),
            "supplier_name": _first_present(row.get("supplier_name"), row.get("supplier")),
            "title": _first_present(row.get("title"), row.get("item"), row.get("name")),
            "url": _first_present(row.get("url"), row.get("source_url")),
            "status": status,
            "notes": _first_present(row.get("notes"), row.get("summary"), row.get("note"), row.get("evidence")),
        }
    )
    return normalized


def _normalize_decision(state: dict[str, Any]) -> dict[str, Any]:
    decision = dict(state.get("decision") or {})
    risks = _first_present(decision.get("risks"), decision.get("risk_items"), decision.get("risk_notes"), state.get("risks"))
    pending = _as_list(_first_present(decision.get("pending_confirmations"), state.get("pending_confirmations")))
    normalized = {
        **decision,
        "summary": _first_present(decision.get("summary"), decision.get("rationale"), state.get("summary")),
        "recommendation": _first_present(decision.get("recommendation"), state.get("recommendation")),
        "estimated_total": _first_present(decision.get("estimated_total"), state.get("estimated_total"), decision.get("budget_note")),
        "risks": _as_list(risks),
        "manual_confirmation_required": bool(_first_present(decision.get("manual_confirmation_required"), pending, risks)),
    }
    if pending:
        normalized["pending_confirmations"] = pending
    return normalized


def _filter_pending_questions(project: dict[str, Any], pending: list[Any]) -> list[Any]:
    filtered: list[Any] = []
    for item in pending:
        field = item.get("field") if isinstance(item, dict) else None
        if field and project.get(field) not in (None, "", []):
            continue
        filtered.append(item)
    return filtered


def _initial_procurement_state(
    *,
    project: dict[str, Any],
    requirements: list[dict[str, Any]],
    sources: list[str],
) -> dict[str, Any]:
    pending = _pending_questions(project)
    missing_requirements = sum(1 for req in requirements if req.get("status") != "standardized")
    stage = "standardization" if requirements else "intake"
    return {
        "stage": stage,
        "workflow": {
            "status": "awaiting_confirmation" if requirements else "draft",
            "confirmed_stages": ["intake"] if requirements else [],
            "invalidated_stages": [],
            "last_action": "legacy_import" if requirements else None,
        },
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "project": project,
        "requirements": requirements,
        "candidates": [],
        "selections": {},
        "evidence": [],
        "decision": {
            "summary": "",
            "recommendation": "",
            "estimated_total": "",
            "risks": [],
            "manual_confirmation_required": pending or missing_requirements > 0,
        },
        "pending_questions": pending,
        "sources": [{"type": "uploaded_file", "path": path} for path in sources],
        "metrics": {
            "requirements_total": len(requirements),
            "requirements_standardized": len(requirements) - missing_requirements,
            "requirements_needing_confirmation": missing_requirements,
        },
    }


def _validate_procurement_state(state: dict[str, Any]) -> dict[str, Any]:
    stage = state.get("stage") or "intake"
    if stage not in VALID_STAGES:
        raise ValueError(f"Invalid procurement stage: {stage}")

    normalized = dict(state)
    normalized["stage"] = stage
    workflow = dict(state.get("workflow") or {})
    ordered_stages = ["intake", "standardization", "sourcing", "evidence", "decision"]
    legacy_confirmed = ordered_stages[: ordered_stages.index(stage)]
    if stage == "decision" and state.get("decision"):
        legacy_confirmed.append("decision")
    normalized["workflow"] = {
        **workflow,
        "status": workflow.get("status") or ("ready" if stage == "decision" else "awaiting_confirmation"),
        "confirmed_stages": workflow.get("confirmed_stages") or legacy_confirmed,
        "invalidated_stages": workflow.get("invalidated_stages") or [],
        "last_action": workflow.get("last_action") or "legacy_import",
    }
    normalized.setdefault("updated_at", datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"))
    normalized["project"] = _normalize_project(state)
    normalized["requirements"] = [
        _normalize_requirement(row, index)
        for index, row in enumerate(state.get("requirements") or [], start=1)
        if isinstance(row, dict)
    ]
    requirements_by_id = {
        str(requirement.get("id")): requirement
        for requirement in normalized["requirements"]
        if requirement.get("id")
    }
    normalized["candidates"] = [
        _normalize_candidate(row, index, requirements_by_id)
        for index, row in enumerate(state.get("candidates") or [], start=1)
        if isinstance(row, dict)
    ]
    normalized["selections"] = dict(state.get("selections") or {})
    normalized["evidence"] = [
        _normalize_evidence(row, index)
        for index, row in enumerate(state.get("evidence") or [], start=1)
        if isinstance(row, dict)
    ]
    pending = state.get("pending_questions") or _pending_questions(normalized["project"])
    normalized["pending_questions"] = _filter_pending_questions(normalized["project"], pending)
    normalized["decision"] = _normalize_decision(state)
    normalized.setdefault("sources", [])
    normalized.setdefault("metrics", {})
    normalized["metrics"].setdefault("requirements_total", len(normalized["requirements"]))
    return normalized


def _report_lines(state: dict[str, Any]) -> list[str]:
    project = state.get("project") or {}
    decision = state.get("decision") or {}
    lines = [
        "# 采购决策建议报告",
        "",
        f"- 项目名称: {_format_report_value(project.get('project_name')) or '未填写'}",
        f"- 交付地址: {_format_report_value(project.get('delivery_address')) or '待确认'}",
        f"- 要求交期: {_format_report_value(project.get('due_date')) or '待确认'}",
        f"- 预算: {_format_report_value(project.get('budget')) or '待确认'}",
        f"- 品牌/等品: {_format_report_value(project.get('brand_requirement')) or ('允许同等品' if project.get('allow_equivalent') else '待确认')}",
        "",
        "## AI 决策摘要",
        "",
        _format_report_value(decision.get("summary")) or "尚未形成完整采购决策。请先完成寻源匹配和证据核验。",
        "",
        f"推荐方案: {_format_report_value(decision.get('recommendation')) or '待确认'}",
        f"预估总价: {_format_report_value(decision.get('estimated_total')) or '待确认'}",
        "",
        "## 材料清单",
        "",
        "| 材料 | 规格型号 | 数量 | 单位 | 状态 |",
        "| --- | --- | ---: | --- | --- |",
    ]
    for req in state.get("requirements") or []:
        lines.append(
            "| {name} | {spec} | {qty} | {unit} | {status} |".format(
                name=_format_report_value(req.get("material_name")),
                spec=_format_report_value(req.get("specification")),
                qty=_format_report_value(req.get("quantity")),
                unit=_format_report_value(req.get("unit")),
                status=_format_report_value(req.get("status")),
            )
        )

    lines.extend(["", "## 候选供应商", "", "| 材料 | 供应商 | 匹配度 | 报价 | 交期 | 风险 |", "| --- | --- | ---: | --- | --- | --- |"])
    for candidate in state.get("candidates") or []:
        risks = candidate.get("risks") or []
        lines.append(
            "| {material} | {supplier} | {score} | {price} | {lead_time} | {risks} |".format(
                material=_format_report_value(candidate.get("material_name") or candidate.get("requirement_id")),
                supplier=_format_report_value(candidate.get("supplier_name")),
                score=_format_report_value(candidate.get("match_score")),
                price=_format_report_value(candidate.get("price_range")) or "待确认",
                lead_time=_format_report_value(candidate.get("lead_time")) or "待确认",
                risks=_format_report_value(risks),
            )
        )

    lines.extend(["", "## 证据与待确认项", ""])
    evidence_items = state.get("evidence") or []
    if evidence_items:
        for item in evidence_items:
            title = _format_report_value(item.get("title") or item.get("supplier_name")) or "证据"
            url = _format_report_value(item.get("url"))
            status = _format_report_value(item.get("status") or item.get("confidence")) or "待确认"
            if url:
                lines.append(f"- [{title}]({url}) - {status}")
            else:
                lines.append(f"- {title} - {status}")
    else:
        lines.append("- 暂无公开证据，请完成网页搜索和核验。")

    pending = state.get("pending_questions") or []
    if pending:
        lines.extend(["", "## 仍需人工确认", ""])
        for item in pending:
            lines.append(f"- {_format_report_value(item.get('question') if isinstance(item, dict) else item)}")

    risks = decision.get("risks") or []
    if risks:
        lines.extend(["", "## 风险提示", ""])
        for risk in risks:
            lines.append(f"- {_format_report_value(risk)}")

    pending_confirmations = decision.get("pending_confirmations") or []
    if pending_confirmations:
        lines.extend(["", "## 待人工确认事项", ""])
        for item in pending_confirmations:
            lines.append(f"- {_format_report_value(item)}")

    return lines


@tool("procurement_parse_requirements", parse_docstring=True)
def procurement_parse_requirements_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    filepaths: list[str] | None,
    free_text: str,
    project_name: str,
    delivery_address: str,
    due_date: str,
    budget: str,
    brand_requirement: str,
    allow_equivalent: bool,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Parse procurement requirements from uploaded files or user text and save initial procurement state.

    Use this first for procurement cases after the user uploads a bill of
    quantities, BOM, spreadsheet, PDF-converted markdown, or provides raw text.
    The tool extracts material name, specification, quantity, and unit. Missing
    project conditions are written to pending_questions for the frontend.

    Args:
        filepaths: Uploaded file paths from /mnt/user-data/uploads. Prefer markdown companions for PDF/Excel when present.
        free_text: Procurement requirement text supplied directly by the user. Use an empty string if not available.
        project_name: Project name if known.
        delivery_address: Delivery address or project location if known.
        due_date: Required delivery date or latest arrival time if known.
        budget: Budget cap or acceptable price range if known.
        brand_requirement: Brand, authorization, or equivalent-product requirement if known.
        allow_equivalent: Whether equivalent products are allowed when brand is not fixed.
    """
    collected_text: list[str] = []
    source_paths: list[str] = []
    errors: list[str] = []

    for filepath in filepaths or []:
        try:
            actual = _resolve_thread_file(runtime, filepath)
            collected_text.append(_read_text_file(actual))
            source_paths.append(filepath)
        except Exception as exc:
            errors.append(f"{filepath}: {exc}")

    if free_text.strip():
        collected_text.append(free_text)

    combined_text = "\n\n".join(collected_text)
    requirements = _extract_boq_requirements(combined_text)
    if not requirements:
        requirements = _extract_table_requirements(combined_text)
    if not requirements:
        requirements = _extract_line_requirements(combined_text)

    project = _project_data(
        project_name=project_name,
        delivery_address=delivery_address,
        due_date=due_date,
        budget=budget,
        brand_requirement=brand_requirement,
        allow_equivalent=allow_equivalent,
    )
    state = _initial_procurement_state(project=project, requirements=requirements, sources=source_paths)

    message = {
        "requirements_total": len(requirements),
        "pending_questions": state["pending_questions"],
        "errors": errors,
    }
    return Command(
        update={
            "procurement": state,
            "messages": _tool_message(json.dumps(message, ensure_ascii=False), tool_call_id),
        }
    )


@tool("procurement_save_state", parse_docstring=True)
def procurement_save_state_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    procurement: dict[str, Any],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Save the full structured procurement case state for frontend rendering.

    Use this after sourcing, evidence verification, or decision analysis. Always
    include the full procurement object, not only the changed fields. Candidate
    and evidence items that come from public web search must include source URLs;
    unverifiable items should be marked as pending/manual confirmation.

    Args:
        procurement: Complete ProcurementCaseState object with stage, project, requirements, candidates, evidence, decision, and pending_questions.
    """
    try:
        state = _validate_procurement_state(procurement)
    except Exception as exc:
        return Command(update={"messages": _tool_message(f"Error: {exc}", tool_call_id)})

    return Command(
        update={
            "procurement": state,
            "messages": _tool_message("Procurement state saved", tool_call_id),
        }
    )


@tool("procurement_render_report", parse_docstring=True)
def procurement_render_report_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    filename_prefix: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Render the current procurement state as Word, PDF, JSON and Markdown files.

    Use this when the user asks to export, review, or finalize procurement
    recommendations. The files are saved in /mnt/user-data/outputs and presented
    in the artifact panel.

    Args:
        filename_prefix: Safe filename prefix, such as procurement-decision.
    """
    if runtime.state is None:
        return Command(update={"messages": _tool_message("Error: Thread state is not available", tool_call_id)})

    state = _validate_procurement_state(runtime.state.get("procurement") or {})
    thread_id = runtime.context.get("thread_id") if runtime.context else None
    thread_data = runtime.state.get("thread_data") or {}
    outputs_path = thread_data.get("outputs_path")
    if outputs_path:
        outputs_dir = Path(outputs_path)
    elif thread_id:
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
    else:
        return Command(update={"messages": _tool_message("Error: Thread outputs path is not available", tool_call_id)})

    paths = generate_procurement_reports(
        state,
        outputs_dir,
        formats=("docx", "pdf", "json", "md"),
        filename_prefix=filename_prefix,
    )
    artifacts = [f"{VIRTUAL_PATH_PREFIX}/outputs/{path.name}" for path in paths]
    return Command(
        update={
            "procurement": state,
            "artifacts": artifacts,
            "messages": _tool_message("Procurement report rendered", tool_call_id),
        }
    )
