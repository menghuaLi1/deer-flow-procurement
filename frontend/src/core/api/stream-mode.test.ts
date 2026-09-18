import assert from "node:assert/strict";
import test from "node:test";

const { sanitizeRunStreamOptions } = await import(
  new URL("./stream-mode.ts", import.meta.url).href
);
const { joinRunStreamWithStatusGuard } = await import(
  new URL("./stream-mode.ts", import.meta.url).href
);

void test("drops unsupported stream modes from array payloads", () => {
  const sanitized = sanitizeRunStreamOptions({
    streamMode: [
      "values",
      "messages-tuple",
      "custom",
      "updates",
      "events",
      "tools",
    ],
  });

  assert.deepEqual(sanitized.streamMode, [
    "values",
    "messages-tuple",
    "custom",
    "updates",
    "events",
  ]);
});

void test("drops unsupported stream modes from scalar payloads", () => {
  const sanitized = sanitizeRunStreamOptions({
    streamMode: "tools",
  });

  assert.equal(sanitized.streamMode, undefined);
});

void test("keeps payloads without streamMode untouched", () => {
  const options = {
    streamSubgraphs: true,
  };

  assert.equal(sanitizeRunStreamOptions(options), options);
});

void test("compact profile keeps only update streams", () => {
  const sanitized = sanitizeRunStreamOptions(
    {
      streamMode: [
        "values",
        "messages-tuple",
        "custom",
        "updates",
        "events",
        "debug",
        "tasks",
        "checkpoints",
      ],
    },
    "compact",
  );

  assert.deepEqual(sanitized.streamMode, ["updates"]);
});

void test("compact profile supplies modes for a resumed stream", () => {
  const sanitized = sanitizeRunStreamOptions({}, "compact");

  assert.deepEqual(sanitized.streamMode, ["updates"]);
});

void test("compact profile never falls back to an implicit stream mode", () => {
  const sanitized = sanitizeRunStreamOptions(
    { streamMode: "values" },
    "compact",
  );

  assert.deepEqual(sanitized.streamMode, []);
});

void test("compact profile skips replay for terminal runs", async () => {
  for (const status of ["success", "error", "timeout", "interrupted"]) {
    let joined = false;
    async function* stream() {
      joined = true;
      yield "event";
    }

    const events: string[] = [];
    for await (const event of joinRunStreamWithStatusGuard(
      "compact",
      async () => status,
      stream,
    )) {
      events.push(event);
    }

    assert.deepEqual(events, []);
    assert.equal(joined, false);
  }
});

void test("compact profile reconnects active runs", async () => {
  async function* stream() {
    yield "event";
  }

  const events: string[] = [];
  for await (const event of joinRunStreamWithStatusGuard(
    "compact",
    async () => "running",
    stream,
  )) {
    events.push(event);
  }

  assert.deepEqual(events, ["event"]);
});

void test("compact profile falls back to reconnect when status lookup fails", async () => {
  async function* stream() {
    yield "event";
  }

  const events: string[] = [];
  for await (const event of joinRunStreamWithStatusGuard(
    "compact",
    async () => {
      throw new Error("status unavailable");
    },
    stream,
  )) {
    events.push(event);
  }

  assert.deepEqual(events, ["event"]);
});

void test("default profile preserves existing replay behavior", async () => {
  let statusChecked = false;
  async function* stream() {
    yield "event";
  }

  const events: string[] = [];
  for await (const event of joinRunStreamWithStatusGuard(
    "default",
    async () => {
      statusChecked = true;
      return "success";
    },
    stream,
  )) {
    events.push(event);
  }

  assert.deepEqual(events, ["event"]);
  assert.equal(statusChecked, false);
});
