import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  maskText,
  codexEvent,
  Batch,
  type Rule,
} from "../src/index.js";
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
  assert.equal(Batch.safeParse({ schema_version: 2 }).success, false);
});

test("tool error metrics use the shared predicate even when the rule registry changes", () => {
  const events = [
    {
      id: "error",
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
