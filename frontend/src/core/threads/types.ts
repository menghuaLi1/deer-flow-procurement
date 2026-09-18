import type { Message, Thread } from "@langchain/langgraph-sdk";

import type { Todo } from "../todos";

export interface AgentThreadState extends Record<string, unknown> {
  title: string;
  messages: Message[];
  artifacts: string[];
  todos?: Todo[];
  procurement?: ProcurementCaseState;
}

export interface AgentThread extends Thread<AgentThreadState> {}

export interface AgentThreadContext extends Record<string, unknown> {
  thread_id: string;
  model_name: string | undefined;
  thinking_enabled: boolean;
  is_plan_mode: boolean;
  subagent_enabled: boolean;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  agent_name?: string;
}

export type ProcurementStage =
  | "intake"
  | "standardization"
  | "sourcing"
  | "evidence"
  | "decision";

export type ProcurementWorkflowStatus =
  | "draft"
  | "awaiting_confirmation"
  | "running"
  | "ready"
  | "error";

export type ProcurementAction =
  | "confirm_requirements"
  | "run_sourcing"
  | "confirm_suppliers"
  | "run_verification"
  | "confirm_evidence"
  | "generate_decision";

export interface ProcurementWorkflow {
  status: ProcurementWorkflowStatus;
  confirmed_stages: ProcurementStage[];
  invalidated_stages: ProcurementStage[];
  last_action?: ProcurementAction | "draft_saved" | "legacy_import";
}

export interface ProcurementProject {
  project_name?: string;
  delivery_address?: string;
  due_date?: string;
  budget?: string;
  brand_requirement?: string;
  allow_equivalent?: boolean;
}

export interface ProcurementRequirement {
  id: string;
  item_code?: string;
  material_name: string;
  specification?: string;
  quantity?: number | null;
  unit?: string;
  brand_requirement?: string;
  notes?: string;
  status?: "standardized" | "needs_confirmation" | string;
  missing_fields?: string[];
}

export interface ProcurementCandidate {
  id?: string;
  requirement_id?: string;
  matched_requirement_ids?: string[];
  material_name?: string;
  supplier_name: string;
  match_score?: number | string;
  price_range?: string;
  lead_time?: string;
  location?: string;
  region?: string;
  evidence_urls?: string[];
  source_urls?: string[];
  risks?: string[];
  risk_notes?: string[];
  status?: string;
  score_breakdown?: Record<string, number | string>;
  source_type?: "public_web" | "supplier_library" | "manual" | string;
  verification_status?: string;
  quote_terms?: string;
  image_url?: string;
  manual_entry?: boolean;
}

export interface ProcurementEvidence {
  id?: string;
  supplier_name?: string;
  title?: string;
  url?: string;
  status?: string;
  confidence?: string;
  notes?: string;
  candidate_id?: string;
  requirement_id?: string;
  evidence_type?: string;
  checked_at?: string;
  manual_note?: string;
  manual_conclusion?: string;
}

export interface ProcurementDecision {
  summary?: string;
  recommendation?: string;
  estimated_total?: string;
  risks?: string[];
  manual_confirmation_required?: boolean;
}

export interface ProcurementPendingQuestion {
  field?: string;
  question: string;
}

export interface ProcurementCaseState {
  stage: ProcurementStage;
  workflow?: ProcurementWorkflow;
  updated_at?: string;
  project?: ProcurementProject;
  requirements?: ProcurementRequirement[];
  candidates?: ProcurementCandidate[];
  selections?: Record<string, string>;
  evidence?: ProcurementEvidence[];
  decision?: ProcurementDecision;
  pending_questions?: ProcurementPendingQuestion[];
  metrics?: Record<string, number | string | boolean | undefined>;
  sources?: Array<Record<string, string>>;
}
