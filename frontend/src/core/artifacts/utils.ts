import { getBackendBaseURL } from "../config";
import type { AgentThread } from "../threads";

const VIRTUAL_USER_DATA_PREFIX = "/mnt/user-data";

function normalizeArtifactPath(filepath: string, threadId: string) {
  if (filepath.startsWith(VIRTUAL_USER_DATA_PREFIX)) {
    return filepath;
  }

  const threadUserDataMarker = `/threads/${threadId}/user-data`;
  const markerIndex = filepath.indexOf(threadUserDataMarker);
  if (markerIndex >= 0) {
    const relativePath = filepath.slice(
      markerIndex + threadUserDataMarker.length,
    );
    return `${VIRTUAL_USER_DATA_PREFIX}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
  }

  return filepath.startsWith("/") ? filepath : `/${filepath}`;
}

export function urlOfArtifact({
  filepath,
  threadId,
  download = false,
  isMock = false,
}: {
  filepath: string;
  threadId: string;
  download?: boolean;
  isMock?: boolean;
}) {
  const normalizedPath = normalizeArtifactPath(filepath, threadId);
  if (isMock) {
    return `${getBackendBaseURL()}/mock/api/threads/${threadId}/artifacts${normalizedPath}${download ? "?download=true" : ""}`;
  }
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts${normalizedPath}${download ? "?download=true" : ""}`;
}

export function extractArtifactsFromThread(thread: AgentThread) {
  return thread.values.artifacts ?? [];
}

export function resolveArtifactURL(absolutePath: string, threadId: string) {
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts${normalizeArtifactPath(absolutePath, threadId)}`;
}
