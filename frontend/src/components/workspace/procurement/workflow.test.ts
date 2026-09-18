import assert from "node:assert/strict";
import test from "node:test";

import type { ProcurementCaseState } from "../../../core/threads/types";

const {
  invalidateProcurementState,
  normalizeProcurementState,
  prepareProcurementAction,
  validateStandardization,
  validateSupplierSelections,
} = await import(new URL("./workflow.ts", import.meta.url).href);

const completeState: ProcurementCaseState = {
  stage: "standardization",
  project: {
    delivery_address: "苏州市工业园区",
    due_date: "2026-10-01",
    brand_requirement: "指定品牌或同等品",
  },
  requirements: [
    { id: "req-1", material_name: "消防水泵", quantity: 2, unit: "台" },
  ],
};

test("legacy procurement state receives a compatible workflow", () => {
  const state = normalizeProcurementState({
    ...completeState,
    stage: "decision",
    decision: { summary: "完成" },
  });
  assert.equal(state.workflow?.status, "ready");
  assert.ok(state.workflow?.confirmed_stages.includes("decision"));
});

test("candidate aliases are linked back to their requirements", () => {
  const state = normalizeProcurementState({
    ...completeState,
    stage: "sourcing",
    candidates: [
      {
        id: "candidate-1",
        supplier_name: "苏州消防设备供应商",
        matched_requirement_ids: ["req-1"],
        region: "江苏苏州",
        source_urls: ["https://example.com"],
        risk_notes: ["授权待确认"],
      },
    ],
  });
  const candidate = state.candidates?.[0];
  assert.equal(candidate?.requirement_id, "req-1");
  assert.equal(candidate?.material_name, "消防水泵");
  assert.equal(candidate?.location, "江苏苏州");
  assert.deepEqual(candidate?.evidence_urls, ["https://example.com"]);
  assert.deepEqual(candidate?.risks, ["授权待确认"]);
});

test("legacy candidate arrays do not crash state normalization", () => {
  const state = normalizeProcurementState({
    ...completeState,
    stage: "sourcing",
    candidates: [
      {
        id: "candidate-legacy",
        requirement_id: "req-1",
        supplier_name: "历史供应商",
        material_name: ["消防水泵"] as unknown as string,
      },
    ],
  });
  assert.equal(state.candidates?.[0]?.material_name, "消防水泵");
});

test("standardization validates required sourcing fields", () => {
  assert.deepEqual(validateStandardization(completeState), []);
  const errors = validateStandardization({
    stage: "standardization",
    project: {},
    requirements: [{ id: "req-1", material_name: "", quantity: null }],
  });
  assert.ok(errors.length >= 5);
});

test("supplier selection is required only when candidates exist", () => {
  assert.deepEqual(validateSupplierSelections(completeState), []);
  const withCandidate: ProcurementCaseState = {
    ...completeState,
    stage: "sourcing",
    candidates: [
      {
        id: "candidate-1",
        requirement_id: "req-1",
        supplier_name: "示例供应商",
      },
    ],
  };
  assert.deepEqual(validateSupplierSelections(withCandidate), [
    "消防水泵尚未选择供应商",
  ]);
  assert.deepEqual(
    validateSupplierSelections({
      ...withCandidate,
      selections: { "req-1": "candidate-1" },
    }),
    [],
  );
});

test("requirement edits invalidate every downstream result", () => {
  const state = invalidateProcurementState(
    {
      ...completeState,
      stage: "decision",
      candidates: [{ id: "c-1", supplier_name: "供应商" }],
      selections: { "req-1": "c-1" },
      evidence: [{ id: "e-1" }],
      decision: { summary: "旧决策" },
    },
    "requirements",
  );
  assert.equal(state.stage, "standardization");
  assert.deepEqual(state.candidates, []);
  assert.deepEqual(state.selections, {});
  assert.deepEqual(state.evidence, []);
  assert.deepEqual(state.decision, {});
});

test("actions record stage confirmation and running status", () => {
  const confirmed = prepareProcurementAction(completeState, "confirm_requirements");
  assert.ok(confirmed.workflow?.confirmed_stages.includes("standardization"));
  const sourcing = prepareProcurementAction(confirmed, "run_sourcing");
  assert.equal(sourcing.stage, "sourcing");
  assert.equal(sourcing.workflow?.status, "running");
});
