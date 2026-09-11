import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateDeterministicCatalog,
  evaluationCatalog,
  selectedSemanticRubricText,
  selectSemanticRubrics,
  type EvaluationRuleDefinition,
} from "../src/evaluation-catalog.js";
import {
  confirmedToolFacts,
  eligibleSemanticFacts,
  repeatedToolEvents,
} from "./fixtures/evaluation-catalog.js";

test("deterministic catalog preserves repeated-call evidence and requires confirmed tool failure", () => {
  const result = evaluateDeterministicCatalog(
    repeatedToolEvents,
    confirmedToolFacts,
  );
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.ruleId,
      candidate.evidenceIds,
    ]),
    [
      ["repeated-tool-call", ["a", "b", "c"]],
      ["tool-error", ["tool-result-failure"]],
    ],
  );
});

test("error wording without structured failure is insufficient, and confirmed success wins", () => {
  const result = evaluateDeterministicCatalog([], {
    toolOutcomes: {
      state: "observed",
      evidenceIds: ["wording"],
      value: [{ resultEventId: "wording", status: "succeeded", exitCode: 0 }],
    },
  });
  assert.equal(
    result.candidates.some((candidate) => candidate.ruleId === "tool-error"),
    false,
  );

  const missing = evaluateDeterministicCatalog([]);
  assert.deepEqual(
    missing.rules.find((rule) => rule.ruleId === "tool-error"),
    {
      ruleId: "tool-error",
      version: 2,
      kind: "deterministic",
      status: "active",
      state: "insufficient",
      reason: "Missing observed facts: toolOutcomes.",
      evidenceIds: [],
    },
  );
});

test("semantic selection keeps disabled, insufficient, and budget-deferred rubrics explicit", () => {
  const activeCatalog: EvaluationRuleDefinition[] = evaluationCatalog.map(
    (rule) =>
      rule.kind === "semantic" ? { ...rule, status: "active" as const } : rule,
  );
  // An explicit empty allow-list preserves disabled rules instead of silently
  // invoking a rubric because it is active by default.
  const disabled = selectSemanticRubrics(eligibleSemanticFacts, {
    enabledRuleIds: [],
  });
  assert.deepEqual(disabled.selected, []);
  assert.equal(
    disabled.all.find((rule) => rule.ruleId === "model-fit")?.state,
    "disabled",
  );

  const bounded = selectSemanticRubrics(eligibleSemanticFacts, {
    enabledRuleIds: [
      "model-fit",
      "skill-impact",
      "verification-repetition",
      "premature-handoff",
    ],
    maxGroups: 3,
    registry: activeCatalog,
  });
  assert.deepEqual(
    bounded.selected.map((rule) => rule.ruleId),
    ["model-fit", "skill-impact", "verification-repetition"],
  );
  assert.equal(
    bounded.all.find((rule) => rule.ruleId === "premature-handoff")?.state,
    "deferred",
  );
  assert.equal(selectedSemanticRubricText(bounded).rubrics.length, 3);

  const missingSkillOutcome = selectSemanticRubrics(
    {
      skillExecutions: eligibleSemanticFacts.skillExecutions,
      instructionContext: eligibleSemanticFacts.instructionContext,
    },
    { enabledRuleIds: ["skill-impact"], registry: activeCatalog },
  );
  assert.equal(
    missingSkillOutcome.all.find((rule) => rule.ruleId === "skill-impact")
      ?.state,
    "insufficient",
  );

  const insufficient = selectSemanticRubrics(
    {
      completion: {
        state: "unknown",
        evidenceIds: [],
        value: { status: "unknown" },
      },
    },
    {
      enabledRuleIds: ["premature-handoff"],
      registry: activeCatalog,
    },
  );
  assert.equal(
    insufficient.all.find((rule) => rule.ruleId === "premature-handoff")?.state,
    "insufficient",
  );

  const missingVerificationContext = selectSemanticRubrics(
    {
      verificationRuns: {
        state: "observed",
        evidenceIds: ["one-run"],
        value: [{ id: "one-run", command: "pnpm test", status: "passed" }],
      },
    },
    {
      enabledRuleIds: ["verification-repetition"],
      registry: activeCatalog,
    },
  );
  assert.equal(
    missingVerificationContext.all.find(
      (rule) => rule.ruleId === "verification-repetition",
    )?.state,
    "not_applicable",
  );
});

test("catalog keeps required metadata and version changes visible", () => {
  for (const rule of evaluationCatalog) {
    assert.ok(rule.id.length > 0);
    assert.ok(rule.version >= 1);
    assert.ok(rule.applicability.length > 0);
    assert.ok(rule.rubric.length > 0);
  }
  assert.equal(
    evaluationCatalog.find((rule) => rule.id === "tool-error")?.version,
    2,
  );
});
