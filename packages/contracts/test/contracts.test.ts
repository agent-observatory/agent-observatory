import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  maskText,
  codexEvent,
  codexSubjectModel,
  Batch,
  type Rule,
} from "../src/index.js";
import { compressBatch, decompressBatch } from "../src/transport.js";
import { randomUUID } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { codexEventWithImages, sanitizeEventImages } from "../src/images.js";
import {
  claudeCodeEvent,
  claudeCodeEvents,
  claudeCodeEventsWithImages,
} from "../src/claude.js";

const transportBatch = (text: string) => ({
  schema_version: 1 as const,
  batch_id: randomUUID(),
  source: "codex" as const,
  session_id: "synthetic",
  project: "/synthetic",
  generation: "a".repeat(64),
  start_offset: 0,
  end_offset: 1,
  events: [{ id: "event", timestamp: null, kind: "user" as const, text }],
});

test("zstd level 3 transport round trips canonical batches and rejects corruption", () => {
  const input = transportBatch("안녕하세요".repeat(1000));
  const encoded = compressBatch(input);
  const decoded = decompressBatch(encoded);
  assert.deepEqual(decoded.batch, input);
  const corrupt = Buffer.from(encoded);
  corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
  assert.throws(() => decompressBatch(corrupt));
});

test("bounded decompression rejects a payload larger than 8 MiB", () => {
  const bomb = zstdCompressSync(Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.throws(() => decompressBatch(bomb), /larger than/);
});

test("image data URLs become local-only PNG and JPEG metadata", async () => {
  const png = Buffer.alloc(24);
  png.set([0x89, 0x50, 0x4e, 0x47]);
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(240, 20);
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0xff,
    0xd9,
  ]);
  const event = await codexEventWithImages(
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: `data:image/png;base64,${png.toString("base64")}`,
          },
          {
            type: "input_text",
            text: `see data:image/jpeg;base64,${jpeg.toString("base64")}`,
          },
        ],
      },
    },
    "stable-id",
  );
  assert.equal(event?.id, "stable-id");
  assert.equal(event?.images?.length, 2);
  assert.deepEqual(
    event?.images?.map(({ mimeType, width, height, status }) => ({
      mimeType,
      width,
      height,
      status,
    })),
    [
      { mimeType: "image/png", width: 320, height: 240, status: "local_only" },
      { mimeType: "image/jpeg", width: 640, height: 480, status: "local_only" },
    ],
  );
  assert.ok(!JSON.stringify(event).includes("base64"));
});

test("nested escaped tool images and repeated occurrences retain references", async () => {
  const data = `data:image/png;base64,${Buffer.from("same-image").toString("base64")}`;
  const event = await codexEventWithImages(
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call",
        output: JSON.stringify({ nested: { first: data, second: data } }),
      },
    },
    "tool-event",
  );
  assert.equal(event?.images?.length, 2);
  assert.equal(event?.images?.[0].sha256, event?.images?.[1].sha256);
  assert.equal((event?.text?.match(/omitted: local-only/g) ?? []).length, 2);
  assert.ok(!event?.text?.includes("base64"));
});

test("escaped slashes and padded images do not consume adjacent text", async () => {
  const payload = Buffer.from("padded-imag").toString("base64");
  const event = await sanitizeEventImages({
    id: "escaped",
    timestamp: null,
    kind: "tool_result",
    text: `data:image\\/png;base64,${payload}After`,
  });
  assert.equal(event.images?.length, 1);
  assert.ok(event.text?.endsWith("After"));
  assert.ok(!event.text?.includes("base64"));
});

test("malformed image-like data is removed without blocking collection", async () => {
  const event = await sanitizeEventImages({
    id: "malformed",
    timestamp: null,
    kind: "tool_result",
    text: "data:image/svg+xml;base64,abcde",
  });
  assert.equal(event.images, undefined);
  assert.equal(event.text, "[image:invalid omitted: local-only]");
});

test("server sanitizer preserves existing metadata and removes embedded bytes", async () => {
  const data = `data:image/gif;base64,${Buffer.from("gif").toString("base64")}`;
  const sanitized = await sanitizeEventImages({
    id: "manual",
    timestamp: null,
    kind: "user",
    text: data,
    images: [
      {
        sha256: "a".repeat(64),
        mimeType: "image/png",
        bytes: 10,
        status: "local_only",
      },
    ],
  });
  assert.equal(sanitized.id, "manual");
  assert.equal(sanitized.images?.length, 2);
  assert.ok(!sanitized.text?.includes("base64"));
});
test("missing usage is unknown; cumulative usage is not summed", () => {
  assert.equal(analyze([]).metrics.inputTokens, null);
  assert.equal(
    analyze([
      { id: "1", timestamp: null, kind: "usage", inputTokens: 10 },
      { id: "2", timestamp: null, kind: "usage", inputTokens: 20 },
    ]).metrics.inputTokens,
    20,
  );
});
test("only authoritative message records counted; tool duplicates retain evidence", () => {
  assert.equal(
    codexEvent(
      { type: "event_msg", payload: { type: "user_message", message: "hi" } },
      "1",
    ),
    null,
  );
  const events = [1, 2, 3].map((i) => ({
    id: String(i),
    timestamp: null,
    kind: "tool_call" as const,
    name: "search",
    text: "same",
  }));
  assert.deepEqual(analyze(events).candidates[0].evidenceIds, ["1", "2", "3"]);
  assert.equal(analyze(events, []).candidates.length, 0);
});
test("redaction preserves surrounding text and removes common secrets", () => {
  const s = maskText(
    'email hello@example.com API_KEY="secret-value" password=abc sk-abcdefghijklmnopqrst',
  );
  assert.ok(!s.includes("hello@example.com"));
  assert.ok(!s.includes("secret-value"));
  assert.ok(!s.includes("password=abc"));
  assert.ok(!s.includes("sk-"));
});
test("future schema rejected", () => {
  assert.equal(Batch.safeParse({ schema_version: 3 }).success, false);
});

test("version 1 Codex batches remain readable while version 2 needs source provenance", () => {
  const legacy = transportBatch("legacy evidence");
  assert.equal(Batch.safeParse(legacy).success, true);
  assert.equal(
    Batch.safeParse({ ...legacy, source: "claude-code" }).success,
    false,
  );
  assert.equal(
    Batch.safeParse({ ...legacy, schema_version: 2 }).success,
    false,
  );
  assert.equal(
    Batch.safeParse({
      ...legacy,
      schema_version: 2,
      source: "claude-code",
      subject_model: { harness: "claude-code", model: "synthetic" },
    }).success,
    true,
  );
  assert.equal(
    Batch.safeParse({
      ...legacy,
      schema_version: 2,
      source: "codex",
      subject_model: { harness: "claude-code" },
    }).success,
    false,
  );
  assert.equal(
    Batch.safeParse({
      ...legacy,
      schema_version: 2,
      subject_model: { harness: "codex" },
      events: [
        {
          id: "event",
          timestamp: null,
          kind: "assistant",
          subject_model: { harness: "claude-code" },
        },
      ],
    }).success,
    false,
  );
});

test("Claude Code parser keeps observed tool evidence but excludes thinking blocks", () => {
  assert.deepEqual(
    claudeCodeEvent(
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          content: [
            { type: "thinking", thinking: "must stay local" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Skill",
              input: { skill: "review" },
            },
          ],
        },
      },
      "event-1",
    ),
    {
      id: "event-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "tool_call",
      name: "Skill",
      callId: "tool-1",
      text: '{"skill":"review"}',
      observations: [{ kind: "skill", evidence: "invoked", id: "review" }],
    },
  );
  assert.equal(
    claudeCodeEvent(
      {
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "local" }] },
      },
      "thinking",
    ),
    null,
  );
});

test("Claude Code preserves every text, tool call, and tool result block", () => {
  const events = claudeCodeEvents(
    {
      type: "assistant",
      message: {
        model: "synthetic-model",
        content: [
          { type: "text", text: "first" },
          {
            type: "tool_use",
            id: "one",
            name: "Read",
            input: { path: "synthetic" },
          },
          { type: "text", text: "second" },
        ],
      },
    },
    "assistant",
  );
  assert.deepEqual(
    events.map(({ id, kind, text, callId }) => ({ id, kind, text, callId })),
    [
      {
        id: "assistant:0",
        kind: "assistant",
        text: "first",
        callId: undefined,
      },
      {
        id: "assistant:1",
        kind: "tool_call",
        text: '{"path":"synthetic"}',
        callId: "one",
      },
      {
        id: "assistant:2",
        kind: "assistant",
        text: "second",
        callId: undefined,
      },
    ],
  );
  assert.deepEqual(
    claudeCodeEvents(
      {
        type: "user",
        message: {
          content: [
            { type: "text", text: "follow up" },
            {
              type: "tool_result",
              tool_use_id: "one",
              is_error: true,
              content: "failed",
            },
          ],
        },
      },
      "user",
    ).map(({ id, kind, toolOutcome }) => ({ id, kind, toolOutcome })),
    [
      { id: "user:0", kind: "user", toolOutcome: undefined },
      { id: "user:1", kind: "tool_result", toolOutcome: { status: "failed" } },
    ],
  );
});

test("Claude Code base64 image blocks become local-only metadata without fetching", async () => {
  const png = Buffer.alloc(24);
  png.set([0x89, 0x50, 0x4e, 0x47]);
  png.writeUInt32BE(80, 16);
  png.writeUInt32BE(60, 20);
  const data = png.toString("base64");
  const user = await claudeCodeEventsWithImages(
    {
      type: "user",
      message: {
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data },
          },
          { type: "text", text: "after image" },
        ],
      },
    },
    "user-image",
  );
  assert.equal(user.length, 2);
  assert.equal(user[0].kind, "user");
  assert.equal(user[0].images?.[0].mimeType, "image/png");
  assert.deepEqual(
    { width: user[0].images?.[0].width, height: user[0].images?.[0].height },
    { width: 80, height: 60 },
  );
  assert.match(user[0].text || "", /omitted: local-only/);
  assert.equal(user[1].text, "after image");
  assert.ok(!JSON.stringify(user).includes(data));

  const [result] = await claudeCodeEventsWithImages(
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-image",
            content: [
              { type: "text", text: "tool output" },
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data },
              },
            ],
          },
        ],
      },
    },
    "tool-image",
  );
  assert.equal(result.kind, "tool_result");
  assert.equal(result.images?.length, 1);
  assert.match(result.text || "", /tool output/);
  assert.match(result.text || "", /omitted: local-only/);
  assert.ok(!JSON.stringify(result).includes(data));
});

test("Codex model context and typed exit codes are observed without guessing", () => {
  assert.deepEqual(
    codexSubjectModel({
      payload: {
        type: "turn_context",
        model: "synthetic",
        reasoning_effort: "high",
      },
    }),
    { harness: "codex", model: "synthetic", reasoning: "high" },
  );
  assert.deepEqual(
    codexEvent(
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "tool",
          output: "ok",
          exit_code: 0,
        },
      },
      "tool",
    )?.toolOutcome,
    { status: "succeeded", exitCode: 0 },
  );
});

test("tool error metrics use the shared predicate even when the rule registry changes", () => {
  const events = [
    {
      id: "error",
      toolOutcome: { status: "failed", exitCode: 1 },
      timestamp: null,
      kind: "tool_result" as const,
      text: "request failed",
    },
  ];
  const registry: Rule[] = [
    {
      id: "replacement",
      version: 7,
      evaluate: () => [],
    },
  ];
  const result = analyze(events, ["replacement"], registry);
  assert.equal(result.metrics.toolErrors, 1);
  assert.deepEqual(result.appliedRules, [{ id: "replacement", version: 7 }]);
});

test("disabled and throwing rules are isolated while later rules still run", () => {
  const registry: Rule[] = [
    {
      id: "disabled",
      version: 1,
      evaluate: () => [
        {
          ruleId: "disabled",
          version: 1,
          title: "bad",
          count: 1,
          evidenceIds: [],
        },
      ],
    },
    {
      id: "throwing",
      version: 3,
      evaluate: () => {
        throw new Error("rule internals must not escape");
      },
    },
    {
      id: "healthy",
      version: 2,
      evaluate: () => [
        {
          ruleId: "healthy",
          version: 2,
          title: "ok",
          count: 1,
          evidenceIds: ["event"],
        },
      ],
    },
  ];
  const result = analyze([], ["throwing", "healthy"], registry);
  assert.deepEqual(result.candidates, [
    {
      ruleId: "healthy",
      version: 2,
      title: "ok",
      count: 1,
      evidenceIds: ["event"],
    },
  ]);
  assert.deepEqual(result.appliedRules, [
    { id: "throwing", version: 3 },
    { id: "healthy", version: 2 },
  ]);
  assert.deepEqual(result.ruleErrors, [
    { ruleId: "throwing", version: 3, error: "evaluation_failed" },
  ]);
});
