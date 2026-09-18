import type { Message } from "@langchain/langgraph-sdk";

import type { AgentThread } from "./types";

export function isProcurementThread(thread: AgentThread) {
  return Boolean(thread.values?.procurement);
}

export function pathOfThread(thread: AgentThread | string) {
  if (typeof thread === "string") {
    return `/workspace/chats/${thread}`;
  }

  if (isProcurementThread(thread)) {
    return `/workspace/procurement/${thread.thread_id}`;
  }

  return `/workspace/chats/${thread.thread_id}`;
}

export function textOfMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        return part.text;
      }
    }
  }
  return null;
}

export function titleOfThread(thread: AgentThread) {
  return thread.values?.title ?? "Untitled";
}
