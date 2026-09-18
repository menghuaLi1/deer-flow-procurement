"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BadgeCheckIcon,
  Building2Icon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  PackageIcon,
  PackageSearchIcon,
  PencilLineIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TruckIcon,
  UploadCloudIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  ProcurementAction,
  ProcurementCandidate,
  ProcurementCaseState,
  ProcurementEvidence,
  ProcurementRequirement,
  ProcurementStage,
} from "@/core/threads";
import { cn } from "@/lib/utils";

import {
  PROCUREMENT_STAGES,
  PROCUREMENT_STAGE_LABELS,
  invalidateProcurementState,
  normalizeProcurementState,
  validateStandardization,
  validateSupplierSelections,
} from "./workflow";

const STAGE_ICONS: Record<ProcurementStage, ComponentType<{ className?: string }>> = {
  intake: ClipboardListIcon,
  standardization: ClipboardCheckIcon,
  sourcing: PackageSearchIcon,
  evidence: ShieldCheckIcon,
  decision: TruckIcon,
};

const EVIDENCE_STATUSES = [
  ["verified", "已核验"],
  ["partial", "部分核验"],
  ["pending", "待确认"],
  ["rejected", "不通过"],
] as const;

type ReportFormat = "docx" | "pdf" | "json";

export interface ProcurementWorkspaceProps {
  procurement?: ProcurementCaseState;
  isRunning?: boolean;
  onAction: (action: ProcurementAction, state: ProcurementCaseState) => void;
  onSaveDraft: (state: ProcurementCaseState) => Promise<void> | void;
  onExport: (
    format: ReportFormat,
    state: ProcurementCaseState,
  ) => Promise<void> | void;
  onFocusComposer?: () => void;
}

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    verified: "已核验",
    partial: "部分核验",
    confirmed_partial: "部分核验",
    pending: "待确认",
    pending_manual: "待确认",
    pending_manual_confirmation: "待确认",
    rejected: "不通过",
    standardized: "已标准化",
    needs_confirmation: "需补充",
  };
  return labels[status ?? ""] ?? status ?? "待确认";
}

function StatusBadge({ status }: { status?: string }) {
  const value = (status ?? "pending").toLowerCase();
  const success =
    value.includes("verified") ||
    value.includes("standardized") ||
    value === "已核验";
  const danger =
    value.includes("reject") || value.includes("failed") || value === "不通过";
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-sm border px-2 py-0.5 font-normal",
        success && "border-emerald-200 bg-emerald-50 text-emerald-700",
        danger && "border-red-200 bg-red-50 text-red-700",
        !success &&
          !danger &&
          "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {statusLabel(status)}
    </Badge>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center border border-dashed bg-white px-6 py-12 text-center dark:bg-background">
      <div className="mb-4 flex size-11 items-center justify-center rounded-md bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
        <Icon className="size-5" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
        {description}
      </p>
    </div>
  );
}

function StageProgress({
  state,
  viewedStage,
  onView,
}: {
  state: ProcurementCaseState;
  viewedStage: ProcurementStage;
  onView: (stage: ProcurementStage) => void;
}) {
  const currentIndex = PROCUREMENT_STAGES.indexOf(state.stage);
  const confirmed = new Set(state.workflow?.confirmed_stages ?? []);
  const invalidated = new Set(state.workflow?.invalidated_stages ?? []);
  return (
    <div className="overflow-x-auto border-b bg-white dark:bg-background">
      <div className="mx-auto flex min-w-[720px] max-w-[1500px] px-5 lg:px-8">
        {PROCUREMENT_STAGES.map((stage, index) => {
          const Icon = STAGE_ICONS[stage];
          const active = stage === viewedStage;
          const complete = confirmed.has(stage) || index < currentIndex;
          const stale = invalidated.has(stage);
          const available = index <= currentIndex || complete || stale;
          return (
            <button
              key={stage}
              type="button"
              disabled={!available}
              onClick={() => onView(stage)}
              className={cn(
                "relative flex h-20 min-w-36 flex-1 items-center gap-3 border-b-2 px-3 text-left transition-colors",
                active
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-zinc-500",
                available
                  ? "cursor-pointer hover:bg-zinc-50"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md border",
                  active && "border-violet-200 bg-violet-50 text-violet-700",
                  complete &&
                    !active &&
                    "border-emerald-200 bg-emerald-50 text-emerald-700",
                  stale && "border-amber-200 bg-amber-50 text-amber-700",
                )}
              >
                {complete && !stale ? (
                  <CheckCircle2Icon className="size-4" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[11px]">步骤 {index + 1}</span>
                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {PROCUREMENT_STAGE_LABELS[stage]}
                </span>
                <span
                  className={cn(
                    "block text-[11px]",
                    stale && "text-amber-700",
                  )}
                >
                  {stale
                    ? "结果已失效"
                    : active
                      ? "当前查看"
                      : complete
                        ? "已确认"
                        : index === currentIndex
                          ? "待确认"
                          : "待执行"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2 text-xs font-semibold text-violet-700">
          {eyebrow}
        </div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          {title}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
          {description}
        </p>
      </div>
      {action}
    </header>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {label}
      </span>
      {children}
    </label>
  );
}

function IntakeView({ onFocusComposer }: { onFocusComposer?: () => void }) {
  const capabilities: Array<
    [ComponentType<{ className?: string }>, string, string]
  > = [
    [FileSpreadsheetIcon, "表格清单", "识别材料、规格、数量和单位"],
    [FileTextIcon, "采购文档", "提取项目条件和品牌要求"],
    [ImageIcon, "图片资料", "通过文件解析提取可编辑文本"],
  ];
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="开始一个采购项目"
        title="把采购清单交给智能体"
        description="上传工程量清单、BOM、询价文件或直接描述采购需求。系统先解析内容，只有经过人工确认后才会进入供应商寻源。"
      />
      <button
        type="button"
        onClick={onFocusComposer}
        className="group flex min-h-72 w-full cursor-pointer flex-col items-center justify-center border-2 border-dashed border-violet-200 bg-white px-8 py-12 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/30 dark:bg-background"
      >
        <span className="mb-5 flex size-14 items-center justify-center rounded-md bg-violet-100 text-violet-700 group-hover:bg-violet-200">
          <UploadCloudIcon className="size-7" />
        </span>
        <span className="text-base font-semibold">上传采购文件或输入需求</span>
        <span className="text-muted-foreground mt-2 text-sm">
          支持 Excel、PDF、Word、图片和普通文字
        </span>
        <span className="mt-5 inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white">
          <PlusIcon className="size-4" /> 选择文件
        </span>
      </button>
      <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-3">
        {capabilities.map(([Icon, title, description]) => (
          <div
            key={title}
            className="flex gap-3 bg-white p-5 dark:bg-background"
          >
            <Icon className="mt-0.5 size-5 shrink-0 text-violet-600" />
            <div>
              <div className="text-sm font-medium">{title}</div>
              <div className="text-muted-foreground mt-1 text-xs leading-5">
                {description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StandardizationView({
  state,
  setState,
}: {
  state: ProcurementCaseState;
  setState: (state: ProcurementCaseState) => void;
}) {
  const project = state.project ?? {};
  const requirements = state.requirements ?? [];
  const updateRequirement = (
    id: string,
    patch: Partial<ProcurementRequirement>,
  ) => {
    const next = invalidateProcurementState(state, "requirements");
    setState({
      ...next,
      requirements: requirements.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    });
  };
  const updateProject = (
    patch: Partial<NonNullable<ProcurementCaseState["project"]>>,
  ) => {
    const onlyName = Object.keys(patch).every(
      (key) => key === "project_name",
    );
    const next = invalidateProcurementState(
      state,
      onlyName ? "project_name" : "requirements",
    );
    setState({ ...next, project: { ...project, ...patch } });
  };
  const removeRow = (id: string) =>
    setState({
      ...invalidateProcurementState(state, "requirements"),
      requirements: requirements.filter((item) => item.id !== id),
    });
  const addRow = () => {
    const next = invalidateProcurementState(state, "requirements");
    setState({
      ...next,
      requirements: [
        ...requirements,
        {
          id: `req-manual-${Date.now()}`,
          material_name: "",
          quantity: null,
          unit: "",
          status: "needs_confirmation",
        },
      ],
    });
  };
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="步骤 2 / 5"
        title="确认标准化采购需求"
        description="核对材料清单和项目条件。材料、地址、交期或品牌规则发生变化后，已有寻源和核验结果会自动失效。"
        action={
          <Button variant="outline" onClick={addRow}>
            <PlusIcon />新增材料
          </Button>
        }
      />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            材料清单{" "}
            <span className="text-muted-foreground font-normal">
              ({requirements.length})
            </span>
          </h2>
          <span className="text-muted-foreground text-xs">
            带 * 的字段为寻源必填项
          </span>
        </div>
        <div className="hidden overflow-x-auto border bg-white lg:block dark:bg-background">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-900">
              <tr>
                <th className="w-10 px-3 py-3">#</th>
                <th className="min-w-40 px-3 py-3">材料名称 *</th>
                <th className="min-w-56 px-3 py-3">规格型号</th>
                <th className="w-28 px-3 py-3">数量 *</th>
                <th className="w-24 px-3 py-3">单位 *</th>
                <th className="min-w-36 px-3 py-3">品牌</th>
                <th className="min-w-44 px-3 py-3">备注</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {requirements.map((row, index) => (
                <tr
                  key={row.id}
                  className="align-top hover:bg-zinc-50/60 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-3 py-3 text-zinc-400">{index + 1}</td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.material_name}
                      onChange={(event) =>
                        updateRequirement(row.id, {
                          material_name: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.specification ?? ""}
                      onChange={(event) =>
                        updateRequirement(row.id, {
                          specification: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="0"
                      value={row.quantity ?? ""}
                      onChange={(event) =>
                        updateRequirement(row.id, {
                          quantity: event.target.value
                            ? Number(event.target.value)
                            : null,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.unit ?? ""}
                      onChange={(event) =>
                        updateRequirement(row.id, { unit: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.brand_requirement ?? ""}
                      onChange={(event) =>
                        updateRequirement(row.id, {
                          brand_requirement: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.notes ?? ""}
                      onChange={(event) =>
                        updateRequirement(row.id, { notes: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="删除材料"
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 lg:hidden">
          {requirements.map((row, index) => (
            <div
              key={row.id}
              className="border bg-white p-4 dark:bg-background"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">材料 {index + 1}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="材料名称 *">
                  <Input
                    value={row.material_name}
                    onChange={(event) =>
                      updateRequirement(row.id, {
                        material_name: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="规格型号">
                  <Input
                    value={row.specification ?? ""}
                    onChange={(event) =>
                      updateRequirement(row.id, {
                        specification: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="数量 *">
                  <Input
                    type="number"
                    value={row.quantity ?? ""}
                    onChange={(event) =>
                      updateRequirement(row.id, {
                        quantity: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </Field>
                <Field label="单位 *">
                  <Input
                    value={row.unit ?? ""}
                    onChange={(event) =>
                      updateRequirement(row.id, { unit: event.target.value })
                    }
                  />
                </Field>
                <Field label="品牌">
                  <Input
                    value={row.brand_requirement ?? ""}
                    onChange={(event) =>
                      updateRequirement(row.id, {
                        brand_requirement: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="备注">
                  <Input
                    value={row.notes ?? ""}
                    onChange={(event) =>
                      updateRequirement(row.id, { notes: event.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
        {requirements.length === 0 && (
          <EmptyState
            icon={PackageIcon}
            title="尚未识别到材料"
            description="请返回需求接收阶段上传清单，或点击新增材料手工录入。"
          />
        )}
      </section>
      <section className="border-t pt-7">
        <h2 className="mb-4 text-sm font-semibold">采购条件</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="项目名称">
            <Input
              value={project.project_name ?? ""}
              onChange={(event) =>
                updateProject({ project_name: event.target.value })
              }
            />
          </Field>
          <Field label="交付地址 *">
            <Input
              value={project.delivery_address ?? ""}
              onChange={(event) =>
                updateProject({ delivery_address: event.target.value })
              }
            />
          </Field>
          <Field label="要求交期 *">
            <Input
              type="date"
              value={project.due_date ?? ""}
              onChange={(event) =>
                updateProject({ due_date: event.target.value })
              }
            />
          </Field>
          <Field label="预算（可选）">
            <Input
              value={typeof project.budget === "string" ? project.budget : ""}
              placeholder="例如：不超过 20 万元"
              onChange={(event) => updateProject({ budget: event.target.value })}
            />
          </Field>
          <Field label="品牌/授权要求 *">
            <Input
              value={project.brand_requirement ?? ""}
              placeholder="例如：海湾或同等品"
              onChange={(event) =>
                updateProject({ brand_requirement: event.target.value })
              }
            />
          </Field>
          <div className="flex min-h-16 items-center justify-between border px-4 py-3">
            <div>
              <div className="text-sm font-medium">允许同等品</div>
              <div className="text-muted-foreground mt-1 text-xs">
                允许推荐满足参数的替代品牌
              </div>
            </div>
            <Switch
              checked={project.allow_equivalent ?? false}
              onCheckedChange={(checked) =>
                updateProject({ allow_equivalent: checked })
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function CandidateIcon({ candidate }: { candidate: ProcurementCandidate }) {
  if (candidate.image_url) {
    return (
      <img
        src={candidate.image_url}
        alt=""
        className="size-12 rounded-md border object-cover"
      />
    );
  }
  return (
    <span className="flex size-12 items-center justify-center rounded-md border bg-zinc-50 text-zinc-500">
      <Building2Icon className="size-5" />
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-14 bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <div className="text-zinc-400">{label}</div>
      <div className="mt-1 line-clamp-1 font-medium text-zinc-700 dark:text-zinc-200">
        {value}
      </div>
    </div>
  );
}

function SourcingView({
  state,
  setState,
}: {
  state: ProcurementCaseState;
  setState: (state: ProcurementCaseState) => void;
}) {
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const candidates = state.candidates ?? [];
  const selections = state.selections ?? {};
  const choose = (requirementId: string, candidateId: string) => {
    const next = invalidateProcurementState(state, "suppliers");
    setState({
      ...next,
      selections: { ...selections, [requirementId]: candidateId },
    });
  };
  const addManual = (requirement: ProcurementRequirement) => {
    if (!manualName.trim()) return;
    const candidate: ProcurementCandidate = {
      id: `candidate-manual-${Date.now()}`,
      requirement_id: requirement.id,
      material_name: requirement.material_name,
      supplier_name: manualName.trim(),
      source_type: "manual",
      manual_entry: true,
      status: "pending_manual",
      verification_status: "pending",
      risks: ["人工录入供应商，尚未完成公开证据核验"],
    };
    const next = invalidateProcurementState(state, "suppliers");
    setState({
      ...next,
      candidates: [...candidates, candidate],
      selections: { ...selections, [requirement.id]: candidate.id! },
    });
    setManualName("");
    setManualFor(null);
  };
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="步骤 3 / 5"
        title="选择候选供应商"
        description="候选信息来自公开来源或人工录入。报价、库存、授权和交期未核实时保持待确认，不会被当作确定事实。"
        action={
          <div className="text-muted-foreground text-sm">
            已选择 {Object.keys(selections).length} /{" "}
            {state.requirements?.length ?? 0}
          </div>
        }
      />
      {(state.requirements ?? []).map((requirement) => {
        const rows = candidates.filter(
          (item) =>
            [
              item.requirement_id === requirement.id,
              item.matched_requirement_ids?.includes(requirement.id) ?? false,
              !item.requirement_id &&
                item.material_name === requirement.material_name,
            ].some(Boolean),
        );
        return (
          <section
            key={requirement.id}
            className="border-t pt-6 first:border-t-0 first:pt-0"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{requirement.material_name}</h2>
                <p className="text-muted-foreground mt-1 text-xs">
                  {requirement.specification ?? "规格待补充"} ·{" "}
                  {requirement.quantity ?? "?"} {requirement.unit}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setManualFor(
                    manualFor === requirement.id ? null : requirement.id,
                  )
                }
              >
                <PlusIcon />手工新增
              </Button>
            </div>
            {manualFor === requirement.id && (
              <div className="mb-4 flex gap-2 border bg-zinc-50 p-3 dark:bg-zinc-900">
                <Input
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="输入供应商名称"
                />
                <Button onClick={() => addManual(requirement)}>添加并选择</Button>
              </div>
            )}
            {rows.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {rows.map((candidate) => {
                  const selected =
                    selections[requirement.id] === candidate.id;
                  const score = Number.parseFloat(
                    String(candidate.match_score ?? ""),
                  );
                  return (
                    <button
                      key={candidate.id ?? candidate.supplier_name}
                      type="button"
                      onClick={() =>
                        candidate.id && choose(requirement.id, candidate.id)
                      }
                      className={cn(
                        "cursor-pointer border bg-white p-4 text-left transition-all dark:bg-background",
                        selected
                          ? "border-violet-500 ring-2 ring-violet-100"
                          : "hover:border-violet-300",
                      )}
                    >
                      <div className="flex gap-3">
                        <CandidateIcon candidate={candidate} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold">
                              {candidate.supplier_name}
                            </h3>
                            {candidate.manual_entry ||
                            candidate.source_type === "manual" ? (
                              <Badge variant="outline" className="rounded-sm">
                                人工录入
                              </Badge>
                            ) : null}
                            {selected && (
                              <Badge className="rounded-sm bg-violet-600">
                                已选择
                              </Badge>
                            )}
                          </div>
                          <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span>
                              匹配度{" "}
                              {Number.isFinite(score) ? `${score}%` : "待评估"}
                            </span>
                            <span>{candidate.location ?? "区域待确认"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-px bg-border text-xs sm:grid-cols-4">
                        <Metric
                          label="价格信号"
                          value={candidate.price_range ?? "待询价"}
                        />
                        <Metric
                          label="预计交期"
                          value={candidate.lead_time ?? "待确认"}
                        />
                        <Metric
                          label="核验状态"
                          value={statusLabel(
                            candidate.verification_status ?? candidate.status,
                          )}
                        />
                        <Metric
                          label="证据"
                          value={`${candidate.evidence_urls?.length ?? 0} 条`}
                        />
                      </div>
                      {!!candidate.risks?.length && (
                        <div className="mt-3 flex gap-2 text-xs text-amber-700">
                          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                          <span>{candidate.risks.join("；")}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={PackageSearchIcon}
                title="暂无候选供应商"
                description="可继续保留为待确认项，或手工新增已知供应商；系统不会自动编造候选或报价。"
              />
            )}
          </section>
        );
      })}
      {!state.requirements?.length && (
        <EmptyState
          icon={PackageIcon}
          title="没有可寻源的材料"
          description="请先返回需求标准化阶段录入并确认材料。"
        />
      )}
    </div>
  );
}

function EvidenceView({
  state,
  setState,
}: {
  state: ProcurementCaseState;
  setState: (state: ProcurementCaseState) => void;
}) {
  const evidence = state.evidence ?? [];
  const update = (id: string, patch: Partial<ProcurementEvidence>) => {
    const next = invalidateProcurementState(state, "evidence");
    setState({
      ...next,
      evidence: evidence.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  };
  const add = () => {
    const next = invalidateProcurementState(state, "evidence");
    setState({
      ...next,
      evidence: [
        ...evidence,
        {
          id: `evidence-manual-${Date.now()}`,
          evidence_type: "manual",
          status: "pending",
          checked_at: new Date().toISOString(),
          manual_note: "",
          manual_conclusion: "pending",
        },
      ],
    });
  };
  const candidateName = (candidateId?: string) =>
    state.candidates?.find((item) => item.id === candidateId)?.supplier_name;
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="步骤 4 / 5"
        title="核验证据与风险"
        description="逐项核对工商、产品、授权、案例、报价、库存和交期证据。允许带待确认项进入决策，但必须保留人工结论和风险说明。"
        action={
          <Button variant="outline" onClick={add}>
            <PlusIcon />补充证据
          </Button>
        }
      />
      {evidence.length ? (
        <div className="overflow-x-auto border bg-white dark:bg-background">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-3">供应商 / 证据</th>
                <th className="w-36 px-4 py-3">证据类型</th>
                <th className="w-36 px-4 py-3">核验状态</th>
                <th className="min-w-64 px-4 py-3">摘要与人工备注</th>
                <th className="w-44 px-4 py-3">核验时间</th>
                <th className="w-20 px-4 py-3">来源</th>
                <th className="w-12 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {evidence.map((item, index) => (
                <tr key={item.id ?? index} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {item.supplier_name ??
                        candidateName(item.candidate_id) ??
                        "待关联供应商"}
                    </div>
                    <Input
                      className="mt-2"
                      value={item.title ?? ""}
                      placeholder="证据标题"
                      onChange={(event) =>
                        item.id && update(item.id, { title: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={item.evidence_type ?? ""}
                      placeholder="工商/产品/授权"
                      onChange={(event) =>
                        item.id &&
                        update(item.id, { evidence_type: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={
                        item.manual_conclusion ?? item.status ?? "pending"
                      }
                      onValueChange={(value) =>
                        item.id &&
                        update(item.id, {
                          manual_conclusion: value,
                          status: value,
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVIDENCE_STATUSES.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Textarea
                      className="min-h-20"
                      value={item.manual_note ?? item.notes ?? ""}
                      placeholder="填写摘要、缺口或人工判断"
                      onChange={(event) =>
                        item.id &&
                        update(item.id, { manual_note: event.target.value })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {item.checked_at
                      ? new Date(item.checked_at).toLocaleString("zh-CN")
                      : "待核验"}
                  </td>
                  <td className="px-4 py-3">
                    {item.url ? (
                      <Button
                        asChild
                        size="icon-sm"
                        variant="outline"
                        title="查看来源"
                      >
                        <a href={item.url} target="_blank" rel="noreferrer">
                          <ExternalLinkIcon />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-zinc-400">无链接</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="删除证据"
                      onClick={() =>
                        setState({
                          ...invalidateProcurementState(state, "evidence"),
                          evidence: evidence.filter((row) => row !== item),
                        })
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheckIcon}
          title="尚未生成核验证据"
          description="先确认供应商选择并执行证据核验；也可以手工补充已有的授权函、报价单或资质链接。"
        />
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        {EVIDENCE_STATUSES.map(([value, label]) => (
          <div
            key={value}
            className="flex items-center justify-between border bg-white px-4 py-3 dark:bg-background"
          >
            <StatusBadge status={value} />
            <span className="text-lg font-semibold">
              {
                evidence.filter(
                  (item) =>
                    (item.manual_conclusion ?? item.status) === value,
                ).length
              }
            </span>
            <span className="sr-only">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionView({
  state,
  onExport,
}: {
  state: ProcurementCaseState;
  onExport: ProcurementWorkspaceProps["onExport"];
}) {
  const project = state.project ?? {};
  const decision = state.decision ?? {};
  const selections = state.selections ?? {};
  const allocations = (state.requirements ?? []).map((requirement) => ({
    requirement,
    candidate: state.candidates?.find(
      (candidate) => candidate.id === selections[requirement.id],
    ),
  }));
  const pendingEvidence = (state.evidence ?? []).filter(
    (item) =>
      !["verified", "已核验"].includes(
        item.manual_conclusion ?? item.status ?? "",
      ),
  );
  const risks = [
    ...(decision.risks ?? []),
    ...pendingEvidence.map(
      (item) =>
        `${item.title ?? item.evidence_type ?? "证据"}：${statusLabel(item.manual_conclusion ?? item.status)}`,
    ),
  ];
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="步骤 5 / 5"
        title="采购决策与报告"
        description="决策基于已确认需求、供应商选择和证据状态生成。所有未核验信息继续保留为风险或人工确认项。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onExport("json", state)}>
              <DownloadIcon />JSON
            </Button>
            <Button variant="outline" onClick={() => onExport("pdf", state)}>
              <FileTextIcon />PDF
            </Button>
            <Button onClick={() => onExport("docx", state)}>
              <DownloadIcon />Word
            </Button>
          </div>
        }
      />
      <div className="grid gap-px border bg-border sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="项目名称" value={project.project_name ?? "未填写"} />
        <Metric label="交付地址" value={project.delivery_address ?? "待确认"} />
        <Metric label="要求交期" value={project.due_date ?? "待确认"} />
        <Metric
          label="预算"
          value={
            typeof project.budget === "string" ? project.budget : "未设置"
          }
        />
        <Metric label="预估总价" value={decision.estimated_total ?? "待询价"} />
      </div>
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
        <div>
          <h2 className="mb-3 text-sm font-semibold">材料与供应商分配</h2>
          <div className="overflow-x-auto border bg-white dark:bg-background">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3">材料</th>
                  <th className="px-4 py-3">供应商</th>
                  <th className="px-4 py-3">价格</th>
                  <th className="px-4 py-3">交期</th>
                  <th className="px-4 py-3">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allocations.map(({ requirement, candidate }) => (
                  <tr key={requirement.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {requirement.material_name}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {requirement.quantity} {requirement.unit}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {candidate?.supplier_name ?? (
                        <span className="text-amber-700">待选择</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {candidate?.price_range ?? "待询价"}
                    </td>
                    <td className="px-4 py-3">
                      {candidate?.lead_time ?? "待确认"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={
                          candidate?.verification_status ?? candidate?.status
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="space-y-5">
          <div className="border-l-4 border-violet-500 bg-white p-5 dark:bg-background">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BadgeCheckIcon className="size-4 text-violet-600" />AI 推荐
            </div>
            <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
              {decision.summary ??
                decision.recommendation ??
                "尚未生成采购决策，请先确认前序阶段。"}
            </p>
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold">风险与人工确认</h2>
            {risks.length ? (
              <ul className="space-y-2">
                {risks.map((risk, index) => (
                  <li
                    key={`${risk}-${index}`}
                    className="flex gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    {risk}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex gap-2 border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                <CheckCircle2Icon className="size-4" />暂无已记录风险
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StageActions({
  state,
  viewedStage,
  isRunning,
  onBack,
  onAction,
  onSaveDraft,
}: {
  state: ProcurementCaseState;
  viewedStage: ProcurementStage;
  isRunning?: boolean;
  onBack: () => void;
  onAction: ProcurementWorkspaceProps["onAction"];
  onSaveDraft: ProcurementWorkspaceProps["onSaveDraft"];
}) {
  const [errors, setErrors] = useState<string[]>([]);
  if (viewedStage === "intake" || viewedStage === "decision") return null;
  const config: Record<
    Exclude<ProcurementStage, "intake" | "decision">,
    { action: ProcurementAction; label: string }
  > = {
    standardization: {
      action: "run_sourcing",
      label: "确认需求并开始寻源",
    },
    sourcing: {
      action: "run_verification",
      label: "确认供应商并开始核验",
    },
    evidence: {
      action: "generate_decision",
      label: "确认证据并生成决策",
    },
  };
  const current = config[viewedStage];
  const submit = () => {
    const nextErrors =
      viewedStage === "standardization"
        ? validateStandardization(state)
        : viewedStage === "sourcing"
          ? validateSupplierSelections(state)
          : [];
    setErrors(nextErrors);
    if (nextErrors.length) return;
    onAction(current.action, state);
  };
  return (
    <div className="sticky bottom-0 z-20 mt-8 border bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:bg-background/95">
      {errors.length > 0 && (
        <div className="mb-3 flex gap-2 text-xs text-red-700">
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span>
            {errors.slice(0, 3).join("；")}
            {errors.length > 3 ? `，另有 ${errors.length - 3} 项` : ""}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />返回上一步
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={isRunning}
            onClick={() => void onSaveDraft(state)}
          >
            <PencilLineIcon />保存草稿
          </Button>
          <Button disabled={isRunning} onClick={submit}>
            {isRunning ? <CircleDashedIcon className="animate-spin" /> : null}
            {current.label}
            <ArrowRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProcurementWorkspace({
  procurement,
  isRunning,
  onAction,
  onSaveDraft,
  onExport,
  onFocusComposer,
}: ProcurementWorkspaceProps) {
  const normalized = useMemo(
    () => normalizeProcurementState(procurement),
    [procurement],
  );
  const [state, setState] = useState(normalized);
  const [viewedStage, setViewedStage] = useState<ProcurementStage>(
    normalized.stage,
  );
  useEffect(() => {
    setState(normalized);
    setViewedStage(normalized.stage);
  }, [normalized]);
  const content: Record<ProcurementStage, React.ReactNode> = {
    intake: <IntakeView onFocusComposer={onFocusComposer} />,
    standardization: (
      <StandardizationView state={state} setState={setState} />
    ),
    sourcing: <SourcingView state={state} setState={setState} />,
    evidence: <EvidenceView state={state} setState={setState} />,
    decision: <DecisionView state={state} onExport={onExport} />,
  };
  const viewedIndex = PROCUREMENT_STAGES.indexOf(viewedStage);
  return (
    <div className="min-h-full bg-[#f7f7f9] dark:bg-background">
      <StageProgress
        state={state}
        viewedStage={viewedStage}
        onView={setViewedStage}
      />
      <div className="mx-auto max-w-[1500px] px-5 pt-7 pb-40 lg:px-8 lg:pt-9">
        {state.workflow?.invalidated_stages.includes(viewedStage) && (
          <div className="mb-5 flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="flex items-center gap-2">
              <RotateCcwIcon className="size-4" />
              上游信息已修改，本阶段结果需要重新执行。
            </span>
          </div>
        )}
        {content[viewedStage]}
        <StageActions
          state={state}
          viewedStage={viewedStage}
          isRunning={isRunning}
          onBack={() =>
            setViewedStage(PROCUREMENT_STAGES[Math.max(0, viewedIndex - 1)]!)
          }
          onAction={onAction}
          onSaveDraft={onSaveDraft}
        />
      </div>
    </div>
  );
}
