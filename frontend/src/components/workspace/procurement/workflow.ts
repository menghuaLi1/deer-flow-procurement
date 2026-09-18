import type {
  ProcurementAction,
  ProcurementCaseState,
  ProcurementStage,
} from "../../../core/threads/types.ts";

export const PROCUREMENT_STAGES: ProcurementStage[] = [
  "intake",
  "standardization",
  "sourcing",
  "evidence",
  "decision",
];

export const PROCUREMENT_STAGE_LABELS: Record<ProcurementStage, string> = {
  intake: "需求接收",
  standardization: "需求标准化",
  sourcing: "寻源匹配",
  evidence: "证据核验",
  decision: "采购决策",
};

export function createEmptyProcurementState(): ProcurementCaseState {
  return {
    stage: "intake",
    workflow: {
      status: "draft",
      confirmed_stages: [],
      invalidated_stages: [],
    },
    project: { allow_equivalent: false },
    requirements: [],
    candidates: [],
    selections: {},
    evidence: [],
    decision: {},
    pending_questions: [],
    metrics: {},
    sources: [],
  };
}

export function normalizeProcurementState(
  value?: ProcurementCaseState,
): ProcurementCaseState {
  if (!value) return createEmptyProcurementState();

  const stage = PROCUREMENT_STAGES.includes(value.stage)
    ? value.stage
    : "intake";
  const requirements = value.requirements ?? [];
  const requirementsById = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  );
  const candidates = (value.candidates ?? []).map((candidate) => {
    const requirementId =
      candidate.requirement_id ?? candidate.matched_requirement_ids?.[0];
    const requirement = requirementId
      ? requirementsById.get(requirementId)
      : undefined;
    const candidateMaterialName =
      typeof candidate.material_name === "string"
        ? candidate.material_name.trim()
        : "";
    return {
      ...candidate,
      requirement_id: requirementId,
      material_name: candidateMaterialName || requirement?.material_name,
      location: candidate.location ?? candidate.region,
      evidence_urls: candidate.evidence_urls ?? candidate.source_urls ?? [],
      risks:
        candidate.risks?.length
          ? candidate.risks
          : (candidate.risk_notes ?? []),
    };
  });
  const stageIndex = PROCUREMENT_STAGES.indexOf(stage);
  const legacyConfirmed = PROCUREMENT_STAGES.slice(0, stageIndex);
  if (stage === "decision" && value.decision) legacyConfirmed.push("decision");

  return {
    ...createEmptyProcurementState(),
    ...value,
    stage,
    project: { allow_equivalent: false, ...(value.project ?? {}) },
    requirements,
    candidates,
    selections: value.selections ?? {},
    evidence: value.evidence ?? [],
    decision: value.decision ?? {},
    pending_questions: value.pending_questions ?? [],
    metrics: value.metrics ?? {},
    sources: value.sources ?? [],
    workflow: {
      status:
        value.workflow?.status ??
        (stage === "decision" ? "ready" : "awaiting_confirmation"),
      confirmed_stages:
        value.workflow?.confirmed_stages ?? legacyConfirmed,
      invalidated_stages: value.workflow?.invalidated_stages ?? [],
      last_action: value.workflow?.last_action ?? "legacy_import",
    },
  };
}

export function validateStandardization(state: ProcurementCaseState): string[] {
  const errors: string[] = [];
  if (!state.requirements?.length) errors.push("至少需要一条材料需求");
  state.requirements?.forEach((row, index) => {
    const prefix = `第 ${index + 1} 行`;
    if (!row.material_name?.trim()) errors.push(`${prefix}缺少材料名称`);
    if (row.quantity === null || row.quantity === undefined || row.quantity <= 0)
      errors.push(`${prefix}缺少有效数量`);
    if (!row.unit?.trim()) errors.push(`${prefix}缺少单位`);
  });
  const project = state.project ?? {};
  if (!project.delivery_address?.trim()) errors.push("缺少交付地址");
  if (!project.due_date?.trim()) errors.push("缺少要求交期");
  if (!project.brand_requirement?.trim() && !project.allow_equivalent) {
    errors.push("请填写品牌要求或明确允许同等品");
  }
  return errors;
}

export function validateSupplierSelections(
  state: ProcurementCaseState,
): string[] {
  const selections = state.selections ?? {};
  const candidates = state.candidates ?? [];
  return (state.requirements ?? [])
    .filter((requirement) => {
      const hasCandidate = candidates.some((candidate) =>
        [
          candidate.requirement_id === requirement.id,
          candidate.matched_requirement_ids?.includes(requirement.id) ?? false,
          !candidate.requirement_id &&
            candidate.material_name === requirement.material_name,
        ].some(Boolean),
      );
      return hasCandidate && !selections[requirement.id];
    })
    .map((item) => `${item.material_name || item.id}尚未选择供应商`);
}

export type ProcurementEditScope =
  | "project_name"
  | "requirements"
  | "suppliers"
  | "evidence";

export function invalidateProcurementState(
  input: ProcurementCaseState,
  scope: ProcurementEditScope,
): ProcurementCaseState {
  const state = normalizeProcurementState(input);
  if (scope === "project_name") return state;

  if (scope === "requirements") {
    return {
      ...state,
      stage: "standardization",
      candidates: [],
      selections: {},
      evidence: [],
      decision: {},
      workflow: {
        status: "draft",
        confirmed_stages: ["intake"],
        invalidated_stages: ["sourcing", "evidence", "decision"],
        last_action: "draft_saved",
      },
    };
  }
  if (scope === "suppliers") {
    return {
      ...state,
      stage: "sourcing",
      evidence: [],
      decision: {},
      workflow: {
        status: "draft",
        confirmed_stages: ["intake", "standardization"],
        invalidated_stages: ["evidence", "decision"],
        last_action: "draft_saved",
      },
    };
  }
  return {
    ...state,
    stage: "evidence",
    decision: {},
    workflow: {
      status: "draft",
      confirmed_stages: ["intake", "standardization", "sourcing"],
      invalidated_stages: ["decision"],
      last_action: "draft_saved",
    },
  };
}

const ACTION_STAGE: Record<ProcurementAction, ProcurementStage> = {
  confirm_requirements: "standardization",
  run_sourcing: "sourcing",
  confirm_suppliers: "sourcing",
  run_verification: "evidence",
  confirm_evidence: "evidence",
  generate_decision: "decision",
};

export function prepareProcurementAction(
  input: ProcurementCaseState,
  action: ProcurementAction,
): ProcurementCaseState {
  const state = normalizeProcurementState(input);
  const stage = ACTION_STAGE[action];
  const confirmed = new Set(state.workflow?.confirmed_stages ?? []);
  if (action === "confirm_requirements") confirmed.add("standardization");
  if (action === "confirm_suppliers") confirmed.add("sourcing");
  if (action === "confirm_evidence") confirmed.add("evidence");

  return {
    ...state,
    stage,
    updated_at: new Date().toISOString(),
    workflow: {
      status: action.startsWith("run_") || action === "generate_decision"
        ? "running"
        : "awaiting_confirmation",
      confirmed_stages: PROCUREMENT_STAGES.filter((item) => confirmed.has(item)),
      invalidated_stages: (state.workflow?.invalidated_stages ?? []).filter(
        (item) => PROCUREMENT_STAGES.indexOf(item) > PROCUREMENT_STAGES.indexOf(stage),
      ),
      last_action: action,
    },
  };
}

export function procurementActionPrompt(action: ProcurementAction): string {
  const prompts: Record<ProcurementAction, string> = {
    confirm_requirements: "已确认并提交标准化采购需求。请保存当前状态，停留在等待寻源执行。",
    run_sourcing: "执行供应商寻源匹配。只完成候选供应商生成，然后等待人工选择确认。",
    confirm_suppliers: "已确认供应商选择。请保存选择关系，停留在等待证据核验。",
    run_verification: "执行所选供应商的证据核验。只完成证据核验，然后等待人工确认。",
    confirm_evidence: "已确认证据结论和风险说明。请保存当前状态，停留在等待生成采购决策。",
    generate_decision: "根据已确认需求、供应商选择和证据生成采购决策。完成后停止。",
  };
  return `[采购动作:${action}] ${prompts[action]}`;
}
