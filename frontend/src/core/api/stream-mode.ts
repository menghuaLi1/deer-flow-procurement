const SUPPORTED_RUN_STREAM_MODES = new Set<string>([
  "values",
  "messages",
  "messages-tuple",
  "updates",
  "events",
  "debug",
  "tasks",
  "checkpoints",
  "custom",
] as const);

const COMPACT_RUN_STREAM_MODES = ["updates"] as const;
const COMPACT_RUN_STREAM_MODE_SET = new Set<string>(COMPACT_RUN_STREAM_MODES);
const TERMINAL_RUN_STATUSES = new Set([
  "success",
  "error",
  "timeout",
  "interrupted",
]);

export type StreamProfile = "default" | "compact";

const warnedUnsupportedStreamModes = new Set<string>();

export function warnUnsupportedStreamModes(
  modes: string[],
  warn: (message: string) => void = console.warn,
) {
  const unseenModes = modes.filter((mode) => {
    if (warnedUnsupportedStreamModes.has(mode)) {
      return false;
    }
    warnedUnsupportedStreamModes.add(mode);
    return true;
  });

  if (unseenModes.length === 0) {
    return;
  }

  warn(
    `[deer-flow] Dropped LangGraph stream mode(s): ${unseenModes.join(", ")}`,
  );
}

export function sanitizeRunStreamOptions<T>(
  options: T,
  profile: StreamProfile = "default",
): T {
  if (
    typeof options !== "object" ||
    options === null
  ) {
    return options;
  }

  const streamMode = "streamMode" in options ? options.streamMode : undefined;
  if (streamMode == null && profile === "default") {
    return options;
  }

  const requestedModes =
    streamMode == null
      ? [...COMPACT_RUN_STREAM_MODES]
      : Array.isArray(streamMode)
        ? streamMode
        : [streamMode];
  const supportedModes = requestedModes.filter((mode) =>
    SUPPORTED_RUN_STREAM_MODES.has(String(mode)),
  );
  const sanitizedModes =
    profile === "compact"
      ? supportedModes.filter((mode) =>
          COMPACT_RUN_STREAM_MODE_SET.has(String(mode)),
        )
      : supportedModes;

  if (sanitizedModes.length === requestedModes.length) {
    if (streamMode != null) {
      return options;
    }
  }

  const droppedModes = requestedModes.filter(
    (mode) => !sanitizedModes.includes(mode),
  );
  warnUnsupportedStreamModes(droppedModes);

  return {
    ...options,
    streamMode:
      profile === "compact"
        ? sanitizedModes
        : streamMode != null && !Array.isArray(streamMode)
        ? sanitizedModes[0]
        : sanitizedModes,
  };
}

export async function* joinRunStreamWithStatusGuard<T>(
  profile: StreamProfile,
  getRunStatus: () => Promise<string>,
  joinStream: () => AsyncIterable<T>,
): AsyncGenerator<T> {
  if (profile === "compact") {
    try {
      const status = await getRunStatus();
      if (TERMINAL_RUN_STATUSES.has(status)) {
        return;
      }
    } catch {
      // A status lookup failure must not prevent an active run from reconnecting.
    }
  }

  yield* joinStream();
}
