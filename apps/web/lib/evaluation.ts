import { createHash } from "node:crypto";
import type { AtlasEvent, SubjectModel } from "@agent-observatory/contracts";
import {
  evaluationCatalog,
  evaluateDeterministicCatalog,
  selectSemanticRubrics,
  selectedSemanticRubricText,
  type EvaluationFacts,
} from "@agent-observatory/contracts/evaluation";
export const evidenceVersion = "actionable-evidence-v2";
export function evaluationVersion() {
  return (
    evidenceVersion +
    ":" +
    evaluationCatalog
      .filter((r) => r.status === "active" && r.defaultEnabled)
      .map((r) => `${r.id}@${r.version}`)
      .sort()
      .join(",")
  );
}
export function evidenceHash(event: unknown) {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}
export function observedFacts(
  events: AtlasEvent[],
  models: SubjectModel[] = [],
): EvaluationFacts {
  const subjects = new Map<string, SubjectModel>();
  const modelEvents = events.filter(
    (e) => "subject_model" in e && e.subject_model,
  );
  for (const model of [
    ...models,
    ...modelEvents.map(
      (e) => (e as AtlasEvent & { subject_model: SubjectModel }).subject_model,
    ),
  ]) {
    if (model.model)
      subjects.set(
        JSON.stringify([model.provider, model.model, model.reasoning]),
        model,
      );
  }
  const subject = subjects.size === 1 ? [...subjects.values()][0] : undefined;
  const users = events.filter((e) => e.kind === "user");
  const skills = events.flatMap((e) =>
    (e.observations || [])
      .filter(
        (o) => o.kind === "skill" && ["invoked", "read"].includes(o.evidence),
      )
      .map((o) => ({ event: e, reference: o })),
  );
  const instructions = events.flatMap((e) =>
    (e.observations || [])
      .filter(
        (o) =>
          o.kind === "instruction" ||
          (o.kind === "skill" && o.evidence === "read"),
      )
      .map((o) => ({ event: e, reference: o })),
  );
  const outcomes = events
    .filter((e) => e.kind === "tool_result" && e.toolOutcome)
    .map((e) => ({
      resultEventId: e.id,
      callId: e.callId,
      toolName: e.name,
      ...e.toolOutcome!,
    }));
  return {
    subjectModel: {
      state: subject ? "observed" : "unknown",
      evidenceIds: modelEvents.map((e) => e.id),
      value: subject
        ? {
            provider: subject.provider,
            modelId: subject.model,
            reasoningEffort: subject.reasoning,
          }
        : undefined,
    },
    // Raw user task context is available, but complexity and risk remain judgments.
    taskContext: {
      state: users.length ? "observed" : "unknown",
      evidenceIds: users.map((e) => e.id),
      value: users.length
        ? { complexity: "unknown", risk: "unknown" }
        : undefined,
    },
    skillExecutions: {
      state: skills.length ? "observed" : "unknown",
      evidenceIds: skills.map((x) => x.event.id),
      value: skills.map((x) => ({
        skillId: x.reference.id,
        versionOrHash: x.reference.sha256,
        activationSource: x.reference.evidence,
        status: x.reference.evidence === "read" ? "loaded" : "unknown",
        toolCallId: x.event.callId,
      })),
    },
    instructionContext: {
      state: instructions.length ? "observed" : "unknown",
      evidenceIds: instructions.map((x) => x.event.id),
      value: instructions.map((x) => ({
        source: x.reference.kind === "skill" ? "skill" : "unknown",
        versionOrHash: x.reference.sha256,
      })),
    },
    toolOutcomes: {
      state: outcomes.some((o) => o.status !== "unknown")
        ? "observed"
        : "unknown",
      evidenceIds: outcomes.map((x) => x.resultEventId),
      value: outcomes,
    },
    verificationRuns: { state: "unknown", evidenceIds: [] },
    completion: { state: "unknown", evidenceIds: [] },
  };
}
export function evaluateSession(
  events: AtlasEvent[],
  models: SubjectModel[],
  sampledIds: Set<string>,
) {
  const facts = observedFacts(events, models);
  const deterministic = evaluateDeterministicCatalog(events, facts);
  // A selected rubric must have its observed events in the actual model input.
  const sampledFacts = observedFacts(
    events.filter((e) => sampledIds.has(e.id)),
    [],
  );
  if (facts.subjectModel?.state !== "observed") {
    sampledFacts.subjectModel = {
      ...sampledFacts.subjectModel!,
      state: "unknown",
      value: undefined,
    };
  }
  const semantic = selectSemanticRubrics(sampledFacts, {
    enabledRuleIds: evaluationCatalog
      .filter((r) => r.defaultEnabled)
      .map((r) => r.id),
    maxGroups: 3,
  });
  return {
    facts,
    sampledFacts,
    deterministic,
    semantic,
    rubrics: selectedSemanticRubricText(semantic),
  };
}
