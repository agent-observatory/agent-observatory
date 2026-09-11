import test from "node:test";
import assert from "node:assert/strict";
import type { AtlasEvent } from "@agent-observatory/contracts";
import { analyze } from "@agent-observatory/contracts";
import {
  observedFacts,
  evaluateSession,
  evidenceHash,
} from "../lib/evaluation";
const e = (id: string, extra: Partial<AtlasEvent> = {}): AtlasEvent => ({
  id,
  kind: "assistant",
  timestamp: null,
  ...extra,
});
test("missing subject model and outcome remain unknown, not free or zero", () => {
  const events = [
    e("user", { kind: "user", text: "Use Skill X with Astra" }),
    e("output", {
      kind: "tool_result",
      text: "All checks passed, 0 errors; asserts no failure",
    }),
  ];
  const facts = observedFacts(events);
  assert.equal(facts.subjectModel?.state, "unknown");
  assert.equal(facts.skillExecutions?.state, "unknown");
  assert.equal(facts.toolOutcomes?.state, "unknown");
  assert.equal(analyze(events).metrics.toolErrors, null);
  assert.equal(
    evaluateSession(events, [], new Set(events.map((e) => e.id))).semantic
      .selected.length,
    0,
  );
});
test("model provenance gates evaluation and model changes do not collapse to last model", () => {
  const events = [
    e("user", { kind: "user", text: "Fix spelling" }),
    e("model", {
      subject_model: {
        harness: "codex",
        model: "observed-model",
        reasoning: "high",
      },
    }),
  ];
  assert.equal(
    evaluateSession(events, [], new Set(["user", "model"])).semantic.selected[0]
      ?.ruleId,
    "model-fit",
  );
  assert.equal(
    evaluateSession(events, [], new Set(["user"])).semantic.selected.length,
    0,
  );
  assert.equal(
    observedFacts([
      ...events,
      e("other", {
        subject_model: { harness: "codex", model: "another-model" },
      }),
    ]).subjectModel?.state,
    "unknown",
  );
});
test("structured failures override keyword heuristics and hashes cover full normalized evidence", () => {
  const events = [
    e("good", {
      kind: "tool_result",
      text: "error handling tested",
      toolOutcome: { status: "succeeded", exitCode: 0 },
    }),
    e("bad", {
      kind: "tool_result",
      text: "stopped",
      toolOutcome: { status: "failed", exitCode: 1 },
    }),
  ];
  assert.equal(analyze(events).metrics.toolErrors, 1);
  const result = evaluateSession(events, [], new Set(["good", "bad"]));
  assert.deepEqual(result.deterministic.candidates[0].evidenceIds, ["bad"]);
  assert.notEqual(
    evidenceHash(events[0]),
    evidenceHash({ ...events[0], text: "changed" }),
  );
});
test("unsampled batch provenance does not make a semantic model assessment eligible", () => {
  const events = [e("user", { kind: "user", text: "Fix spelling" })];
  const result = evaluateSession(
    events,
    [{ harness: "codex", model: "batch-only-model" }],
    new Set(["user"]),
  );
  assert.equal(result.facts.subjectModel?.state, "observed");
  assert.equal(result.sampledFacts.subjectModel?.state, "unknown");
  assert.equal(result.semantic.selected.length, 0);
});
test("a single-model sample cannot erase other observed models in the full session", () => {
  const events = [
    e("user", { kind: "user", text: "Review" }),
    e("m1", { subject_model: { harness: "codex", model: "one" } }),
    e("m2", { subject_model: { harness: "codex", model: "two" } }),
  ];
  assert.equal(
    evaluateSession(events, [], new Set(["user", "m1"])).semantic.selected
      .length,
    0,
  );
});
