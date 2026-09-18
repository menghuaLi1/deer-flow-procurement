"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getLangGraphBaseURL } from "../config";

import {
  joinRunStreamWithStatusGuard,
  sanitizeRunStreamOptions,
  type StreamProfile,
} from "./stream-mode";

function createCompatibleClient(
  isMock?: boolean,
  streamProfile: StreamProfile = "default",
): LangGraphClient {
  const client = new LangGraphClient({
    apiUrl: getLangGraphBaseURL(isMock),
  });

  const originalRunStream = client.runs.stream.bind(client.runs);
  client.runs.stream = ((threadId, assistantId, payload) =>
    originalRunStream(
      threadId,
      assistantId,
      sanitizeRunStreamOptions(payload, streamProfile),
    )) as typeof client.runs.stream;

  const originalJoinStream = client.runs.joinStream.bind(client.runs);
  client.runs.joinStream = ((threadId, runId, options) => {
    const sanitizedOptions = sanitizeRunStreamOptions(options, streamProfile);
    return joinRunStreamWithStatusGuard(
      streamProfile,
      async () =>
        threadId
          ? (await client.runs.get(threadId, runId)).status
          : "unknown",
      () => originalJoinStream(threadId, runId, sanitizedOptions),
    );
  }) as typeof client.runs.joinStream;

  return client;
}

const clients = new Map<string, LangGraphClient>();

export function getAPIClient(
  isMock?: boolean,
  streamProfile: StreamProfile = "default",
): LangGraphClient {
  const key = `${isMock ? "mock" : "live"}:${streamProfile}`;
  let client = clients.get(key);
  if (!client) {
    client = createCompatibleClient(isMock, streamProfile);
    clients.set(key, client);
  }
  return client;
}
