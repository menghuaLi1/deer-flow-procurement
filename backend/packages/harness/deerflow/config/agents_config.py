"""Configuration and loaders for custom agents."""

import logging
import re
from typing import Any

import yaml
from pydantic import BaseModel

from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

SOUL_FILENAME = "SOUL.md"
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")
PROCUREMENT_AGENT_NAME = "procurement-agent"

PROCUREMENT_AGENT_SOUL = """You are 采购撮合智能体 (Procurement Agent), a specialized construction-material procurement matching agent.

Mission:
- Help procurement users turn multi-source demand documents into a structured sourcing case.
- Focus the MVP on building-material and fire-protection procurement.
- Follow this workflow: demand intake -> demand standardization -> sourcing match -> evidence verification -> procurement decision.

Operating rules:
- Use `procurement_parse_requirements` first when the user uploads or describes a bill of quantities, BOM, spreadsheet, PDF, image-converted text, or procurement list.
- Before sourcing, require material name, quantity, unit, delivery address, required delivery date, and an explicit brand/equivalent-product rule. Budget is optional.
- Use web_search and web_fetch for public sourcing and evidence. Claims about suppliers, qualification, authorization, price, inventory, delivery time, and cases must include source URLs.
- If public evidence is unavailable or weak, mark the item as pending manual confirmation. Never present unverifiable information as verified.
- Score candidates conservatively: material match 40%, supplier/product evidence 25%, region and delivery 15%, price signal 10%, risk deduction 10%.
- Group equivalent requirements into sourcing categories. Search by category instead of searching every line item independently.
- Prefer search snippets first, then fetch the supplier or manufacturer sources needed for verification.
- Keep the strongest relevant suppliers for each sourcing category. Low-quality or duplicate public results do not need to be copied into the procurement state.
- Submit independent web tool calls together in one turn when possible, then synthesize their results in one model pass.
- Read the action marker in the latest user message. Execute only that single action, update the complete procurement state once, and stop for human confirmation.
- `confirm_requirements` only saves edited requirements. `run_sourcing` only creates candidates.
- `confirm_suppliers` only saves selections. `run_verification` only verifies selected candidates.
- `confirm_evidence` only saves human evidence conclusions. `generate_decision` only creates the final decision.
- Never automatically continue from one stage into the next. Set workflow.status to `awaiting_confirmation` after each completed action, except while the current action is actively running.
- Preserve the submitted `selections` mapping and all fields marked as manual input.
- Every candidate must include `requirement_id`; grouped candidates must also include every linked requirement ID in `matched_requirement_ids`.
- Use `location`, `evidence_urls`, `risks`, and `verification_status` as the canonical candidate fields.
- Every evidence item must include the selected `candidate_id` and its `requirement_id` so the workspace can preserve the material-supplier-evidence relationship.
- Use `procurement_save_state` when the current stage materially changes. Do not save an unchanged state.
- Use `procurement_render_report` when the user asks for a final report, export, or procurement recommendation package.

Output requirements:
- Keep procurement conclusions actionable and concise.
- Do not repeat raw web page content, the full requirement table, or the complete procurement JSON in the chat response.
- Separate verified facts from assumptions and pending confirmations.
- For MVP, do not proceed into order placement, contracts, payment, approval workflows, or fulfillment management.
"""

class AgentConfig(BaseModel):
    """Configuration for a custom agent."""

    name: str
    description: str = ""
    model: str | None = None
    tool_groups: list[str] | None = None


BUILTIN_AGENTS: dict[str, AgentConfig] = {
    PROCUREMENT_AGENT_NAME: AgentConfig(
        name=PROCUREMENT_AGENT_NAME,
        description="Construction material procurement matching agent",
        tool_groups=["web", "file:read", "file:write", "procurement"],
    )
}


def load_agent_config(name: str | None) -> AgentConfig | None:
    """Load the custom or default agent's config from its directory.

    Args:
        name: The agent name.

    Returns:
        AgentConfig instance.

    Raises:
        FileNotFoundError: If the agent directory or config.yaml does not exist.
        ValueError: If config.yaml cannot be parsed.
    """

    if name is None:
        return None

    if not AGENT_NAME_PATTERN.match(name):
        raise ValueError(f"Invalid agent name '{name}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")

    normalized_name = name.lower()
    if normalized_name in BUILTIN_AGENTS:
        return BUILTIN_AGENTS[normalized_name]

    agent_dir = get_paths().agent_dir(name)
    config_file = agent_dir / "config.yaml"

    if not agent_dir.exists():
        raise FileNotFoundError(f"Agent directory not found: {agent_dir}")

    if not config_file.exists():
        raise FileNotFoundError(f"Agent config not found: {config_file}")

    try:
        with open(config_file, encoding="utf-8") as f:
            data: dict[str, Any] = yaml.safe_load(f) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"Failed to parse agent config {config_file}: {e}") from e

    # Ensure name is set from directory name if not in file
    if "name" not in data:
        data["name"] = name

    # Strip unknown fields before passing to Pydantic (e.g. legacy prompt_file)
    known_fields = set(AgentConfig.model_fields.keys())
    data = {k: v for k, v in data.items() if k in known_fields}

    return AgentConfig(**data)


def load_agent_soul(agent_name: str | None) -> str | None:
    """Read the SOUL.md file for a custom agent, if it exists.

    SOUL.md defines the agent's personality, values, and behavioral guardrails.
    It is injected into the lead agent's system prompt as additional context.

    Args:
        agent_name: The name of the agent or None for the default agent.

    Returns:
        The SOUL.md content as a string, or None if the file does not exist.
    """
    normalized_name = agent_name.lower() if agent_name else None
    if normalized_name == PROCUREMENT_AGENT_NAME:
        return PROCUREMENT_AGENT_SOUL

    agent_dir = get_paths().agent_dir(agent_name) if agent_name else get_paths().base_dir
    soul_path = agent_dir / SOUL_FILENAME
    if not soul_path.exists():
        return None
    content = soul_path.read_text(encoding="utf-8").strip()
    return content or None


def list_custom_agents() -> list[AgentConfig]:
    """Scan the agents directory and return all valid custom agents.

    Returns:
        List of AgentConfig for each valid agent directory found.
    """
    agents_dir = get_paths().agents_dir

    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []

    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir():
            continue

        config_file = entry / "config.yaml"
        if not config_file.exists():
            logger.debug(f"Skipping {entry.name}: no config.yaml")
            continue

        try:
            agent_cfg = load_agent_config(entry.name)
            agents.append(agent_cfg)
        except Exception as e:
            logger.warning(f"Skipping agent '{entry.name}': {e}")

    return sorted(agents, key=lambda agent: agent.name)
