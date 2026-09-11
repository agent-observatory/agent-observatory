import type { AtlasEvent } from "../../src/index.js";
import type { EvaluationFacts } from "../../src/evaluation-catalog.js";

export const repeatedToolEvents: AtlasEvent[] = ["a", "b", "c"].map((id) => ({
  id,
  timestamp: null,
  kind: "tool_call",
  name: "rg",
  text: '{"query":"TODO"}',
}));

export const confirmedToolFacts: EvaluationFacts = {
  toolOutcomes: {
    state: "observed",
    evidenceIds: ["tool-result-success", "tool-result-failure"],
    value: [
      {
        resultEventId: "tool-result-success",
        status: "succeeded",
        exitCode: 0,
      },
      {
        resultEventId: "tool-result-failure",
        status: "unknown",
        exitCode: 2,
      },
    ],
  },
};

export const eligibleSemanticFacts: EvaluationFacts = {
  subjectModel: {
    state: "observed",
    evidenceIds: ["subject-model"],
    value: { provider: "example", modelId: "model-1" },
  },
  taskContext: {
    state: "observed",
    evidenceIds: ["task-context"],
    value: { complexity: "bounded_change", risk: "low" },
  },
  skillExecutions: {
    state: "observed",
    evidenceIds: ["skill-run"],
    value: [{ skillId: "example-skill", status: "completed" }],
  },
  instructionContext: {
    state: "observed",
    evidenceIds: ["instruction-context"],
    value: [{ source: "skill", appliedScope: "current task" }],
  },
  verificationRuns: {
    state: "observed",
    evidenceIds: ["verify-1", "verify-2"],
    value: [
      { id: "verify-1", status: "passed", changedSincePrevious: false },
      { id: "verify-2", status: "passed", changedSincePrevious: false },
    ],
  },
  outcome: {
    state: "observed",
    evidenceIds: ["outcome"],
    value: { result: "succeeded", verificationStatus: "passed" },
  },
  completion: {
    state: "observed",
    evidenceIds: ["completion"],
    value: {
      status: "completed",
      requestedSteps: ["test"],
      performedSteps: ["test"],
    },
  },
};
