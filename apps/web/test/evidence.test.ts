import test from "node:test";
import assert from "node:assert/strict";
import { selectEvidence, excerpt } from "../lib/evidence";
import type { AtlasEvent } from "@agent-observatory/contracts";
test("evidence retains early/late user instructions, skill call and paired failure", () => {
  const events: AtlasEvent[] = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i),
    kind: "assistant",
    timestamp: null,
    text: "ordinary output " + i,
  }));
  events[0] = {
    id: "first",
    kind: "user",
    timestamp: null,
    text: "Respect this constraint",
  };
  events[999] = {
    id: "last",
    kind: "user",
    timestamp: null,
    text: "Verify the fix",
  };
  events[701] = {
    id: "skill",
    kind: "tool_call",
    timestamp: null,
    callId: "c",
    name: "read",
    text: "cat .agents/skills/review/SKILL.md",
  };
  events[702] = {
    id: "failure",
    kind: "tool_result",
    timestamp: null,
    callId: "c",
    text: "Error reading skill",
  };
  const { samples, aiInput } = selectEvidence(events);
  for (const id of ["first", "last", "skill", "failure"])
    assert.ok(samples.some((e) => e.id === id));
  assert.equal(aiInput.events, 1000);
  assert.ok(samples.length <= 64);
  assert.ok(aiInput.characters <= 32000);
});
test("large evidence is explicitly excerpted and includes the ending", () => {
  const text = "BEGIN" + "x".repeat(100000) + "END";
  const { samples, aiInput } = selectEvidence([
    { id: "one", kind: "user", timestamp: null, text },
  ]);
  assert.equal(samples[0].originalCharacters, text.length);
  assert.equal(samples[0].truncated, true);
  assert.match(samples[0].text, /BEGIN/);
  assert.match(samples[0].text, /END$/);
  assert.equal(aiInput.truncatedSamples, 1);
  assert.ok(samples[0].text.length <= 1000);
  for (const limit of [0, 5, 20, 30, 100])
    assert.ok(excerpt(text, limit).length <= limit);
});
test("usage is excluded from AI samples; deterministic selection does not mutate source", () => {
  const events: AtlasEvent[] = [
    { id: "usage", kind: "usage", timestamp: null, inputTokens: 42 },
  ];
  assert.deepEqual(selectEvidence(events).samples, []);
  assert.equal(events[0].inputTokens, 42);
});
