"use client";

import {
  BotIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  HistoryIcon,
  HomeIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatBox, useThreadChat } from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ProcurementWorkspace } from "@/components/workspace/procurement/procurement-workspace";
import {
  normalizeProcurementState,
  prepareProcurementAction,
  procurementActionPrompt,
} from "@/components/workspace/procurement/workflow";
import { SettingsDialog } from "@/components/workspace/settings";
import { Tooltip } from "@/components/workspace/tooltip";
import { getAPIClient } from "@/core/api";
import { urlOfArtifact } from "@/core/artifacts/utils";
import { getBackendBaseURL } from "@/core/config";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import type {
  AgentThreadState,
  ProcurementAction,
  ProcurementCaseState,
} from "@/core/threads";
import { useThreads, useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const PROCUREMENT_AGENT_NAME = "procurement-agent";
type ReportFormat = "docx" | "pdf" | "json";

function downloadArtifact(threadId: string, path: string) {
  const anchor = document.createElement("a");
  anchor.href = urlOfArtifact({ filepath: path, threadId, download: true });
  anchor.download = path.split("/").at(-1) ?? "procurement-report";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function ProcurementPage() {
  const router = useRouter();
  const [settings, setSettings] = useLocalSettings();
  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  const { showNotification } = useNotification();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [procurementOverride, setProcurementOverride] =
    useState<ProcurementCaseState>();
  const procurementContext = useMemo(
    () => ({ ...settings.context, mode: "flash" as const }),
    [settings.context],
  );
  const { data: allThreads = [] } = useThreads();
  const procurementThreads = useMemo(
    () => allThreads.filter((item) => Boolean(item.values?.procurement)),
    [allThreads],
  );

  useEffect(() => {
    document.title = "采购撮合智能体";
  }, []);

  const [thread, sendMessage, isUploading] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    streamProfile: "compact",
    isMock,
    context: {
      ...procurementContext,
      agent_name: PROCUREMENT_AGENT_NAME,
    },
    onStart: (createdThreadId) => {
      setIsNewThread(false);
      history.replaceState(
        null,
        "",
        `/workspace/procurement/${createdThreadId}`,
      );
    },
    onFinish: (state) => {
      if (state.procurement) setProcurementOverride(state.procurement);
      if (document.hidden || !document.hasFocus()) {
        const lastMessage = state.messages.at(-1);
        const textContent = lastMessage ? textOfMessage(lastMessage) : null;
        showNotification(state.title ?? "采购撮合智能体", {
          body: textContent?.slice(0, 200) ?? "采购流程已更新",
        });
      }
    },
  });

  useEffect(() => {
    if (thread.values.procurement) {
      setProcurementOverride(thread.values.procurement);
    }
  }, [thread.values.procurement]);

  const procurement = normalizeProcurementState(
    procurementOverride ?? thread.values.procurement,
  );
  const projectTitle =
    procurement.project?.project_name ??
    thread.values.title ??
    "未命名采购项目";

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      void sendMessage(
        threadId,
        message,
        { agent_name: PROCUREMENT_AGENT_NAME },
        procurementOverride ? { procurement: procurementOverride } : undefined,
      );
    },
    [procurementOverride, sendMessage, threadId],
  );

  const saveDraft = useCallback(
    async (state: ProcurementCaseState) => {
      try {
        const apiClient = getAPIClient(isMock, "compact");
        await apiClient.threads.updateState(threadId, {
          values: { procurement: state },
        });
        const checkpoint = await apiClient.threads.getState<AgentThreadState>(
          threadId,
        );
        const saved = checkpoint.values?.procurement ?? state;
        setProcurementOverride(saved);
        toast.success("采购草稿已保存");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "草稿保存失败");
      }
    },
    [isMock, threadId],
  );

  const runAction = useCallback(
    (action: ProcurementAction, editedState: ProcurementCaseState) => {
      let state = editedState;
      if (action === "run_sourcing") {
        state = prepareProcurementAction(state, "confirm_requirements");
      } else if (action === "run_verification") {
        state = prepareProcurementAction(state, "confirm_suppliers");
      } else if (action === "generate_decision") {
        state = prepareProcurementAction(state, "confirm_evidence");
      }
      state = prepareProcurementAction(state, action);
      setProcurementOverride(state);
      void sendMessage(
        threadId,
        { text: procurementActionPrompt(action), files: [] },
        { agent_name: PROCUREMENT_AGENT_NAME, procurement_action: action },
        { procurement: state },
      ).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "采购动作执行失败");
      });
    },
    [sendMessage, threadId],
  );

  const exportReport = useCallback(
    async (
      format: ReportFormat,
      state: ProcurementCaseState = procurement,
    ) => {
      try {
        const response = await fetch(
          `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/procurement/reports`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              procurement: state,
              formats: [format],
              filename_prefix: "procurement-decision",
            }),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            detail?: string;
          };
          throw new Error(body.detail ?? "报告生成失败");
        }
        const body = (await response.json()) as { artifacts: string[] };
        const artifacts = Array.from(
          new Set([...(thread.values.artifacts ?? []), ...body.artifacts]),
        );
        const apiClient = getAPIClient(isMock, "compact");
        await apiClient.threads.updateState(threadId, { values: { artifacts } });
        if (body.artifacts[0]) downloadArtifact(threadId, body.artifacts[0]);
        toast.success(`${format.toUpperCase()} 报告已生成`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "报告生成失败");
      }
    },
    [isMock, procurement, thread.values.artifacts, threadId],
  );

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const openFilePicker = useCallback(() => {
    const picker = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (picker) picker.click();
    else document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, []);

  return (
    <ThreadContext.Provider value={{ thread }}>
      <ChatBox threadId={threadId}>
        <div className="flex size-full min-h-0 flex-col bg-[#f7f7f9] dark:bg-background">
          <header className="z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-white px-3 sm:px-5 dark:bg-background">
            <button
              type="button"
              onClick={() => router.push("/workspace/procurement/new")}
              className="flex min-w-0 cursor-pointer items-center gap-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white">
                <SparklesIcon className="size-4" />
              </span>
              <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                <span className="sm:hidden">采购智能体</span>
                <span className="hidden sm:inline">采购撮合智能体</span>
              </span>
            </button>
            <div className="hidden h-5 w-px bg-border sm:block" />
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="hidden min-w-0 max-w-md cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 sm:flex dark:hover:bg-zinc-900"
            >
              <span className="truncate font-medium">{projectTitle}</span>
              <ChevronDownIcon className="size-4 shrink-0 text-zinc-400" />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip content="返回普通聊天">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => router.push("/workspace/chats/new")}
                >
                  <HomeIcon />
                </Button>
              </Tooltip>
              <Tooltip content="历史采购项目">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setHistoryOpen(true)}
                >
                  <HistoryIcon />
                </Button>
              </Tooltip>
              <Tooltip content="完整对话">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setMessagesOpen(true)}
                >
                  <MessageSquareTextIcon />
                </Button>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" title="导出报告">
                    <DownloadIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void exportReport("docx")}>
                    <FileTextIcon />导出 Word
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportReport("pdf")}>
                    <FileTextIcon />导出 PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void exportReport("json")}>
                    <FileJsonIcon />导出 JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip content="设置">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSettingsOpen(true)}
                >
                  <SettingsIcon />
                </Button>
              </Tooltip>
              <Button
                size="sm"
                className="ml-1"
                onClick={() => router.push("/workspace/procurement/new")}
              >
                <PlusIcon />
                <span className="hidden sm:inline">新建项目</span>
              </Button>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <ProcurementWorkspace
              procurement={procurement}
              isRunning={thread.isLoading || isUploading}
              onAction={runAction}
              onSaveDraft={saveDraft}
              onExport={exportReport}
              onFocusComposer={openFilePicker}
            />
          </main>

          <div className="z-30 shrink-0 px-3 sm:px-6">
            <div className="mx-auto max-w-4xl border-t bg-white/95 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,.06)] backdrop-blur dark:bg-background/95">
              <div className="mb-1 flex items-center gap-2 px-3 text-[11px] text-zinc-500">
                <BotIcon className="size-3.5 text-violet-600" />
                AI 助手
                {thread.isLoading && (
                  <span className="text-violet-700">正在处理当前阶段...</span>
                )}
              </div>
              <InputBox
                className="w-full border-0 bg-transparent shadow-none"
                isNewThread={isNewThread}
                threadId={threadId}
                autoFocus={isNewThread}
                placeholder="补充采购需求、上传文件或修正当前阶段信息..."
                status={
                  thread.error
                    ? "error"
                    : thread.isLoading
                      ? "streaming"
                      : "ready"
                }
                context={procurementContext}
                disabled={
                  env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" || isUploading
                }
                onContextChange={(context) =>
                  setSettings("context", { ...context, mode: "flash" })
                }
                onSubmit={handleSubmit}
                onStop={handleStop}
              />
            </div>
          </div>
        </div>
      </ChatBox>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-[92vw] sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>历史采购项目</SheetTitle>
            <SheetDescription>切换到已有采购工作流和检查点</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <Button
              variant="outline"
              className="mb-3 w-full justify-start"
              onClick={() => {
                setHistoryOpen(false);
                router.push("/workspace/procurement/new");
              }}
            >
              <PlusIcon />新建采购项目
            </Button>
            <div className="space-y-1">
              {procurementThreads.map((item) => {
                const state = normalizeProcurementState(item.values.procurement);
                return (
                  <button
                    key={item.thread_id}
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      router.push(`/workspace/procurement/${item.thread_id}`);
                    }}
                    className={cn(
                      "w-full cursor-pointer border px-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900",
                      item.thread_id === threadId &&
                        "border-violet-300 bg-violet-50/60 dark:bg-violet-950/20",
                    )}
                  >
                    <div className="truncate text-sm font-medium">
                      {state.project?.project_name ??
                        item.values.title ??
                        "未命名采购项目"}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                      <span>{state.requirements?.length ?? 0} 条材料</span>
                      <span>{new Date(item.updated_at).toLocaleDateString("zh-CN")}</span>
                    </div>
                  </button>
                );
              })}
              {procurementThreads.length === 0 && (
                <div className="py-12 text-center text-sm text-zinc-500">
                  暂无历史采购项目
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={messagesOpen} onOpenChange={setMessagesOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-2xl">
          <SheetHeader className="border-b">
            <SheetTitle>项目对话记录</SheetTitle>
            <SheetDescription>{projectTitle}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <MessageList
              className="size-full"
              threadId={threadId}
              thread={thread}
              paddingBottom={32}
            />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </ThreadContext.Provider>
  );
}
