import type { AtlasEvent } from "./index.js";

/**
 * Canonical, source-controlled evaluation definitions. Consumers can build
 * deterministic candidates or select a bounded semantic rubric from this file;
 * neither operation calls a model, database, or network service.
 */
export type EvaluationRuleKind = "deterministic" | "semantic";
export type EvaluationRuleStatus =
  | "draft"
  | "calibrating"
  | "active"
  | "deprecated"
  | "retired";
export type FactState = "observed" | "unknown" | "not_applicable";
export type RuleSelectionState =
  | "selected"
  | "not_applicable"
  | "insufficient"
  | "disabled"
  | "deferred";

export type ObservedFact<T> = {
  state: FactState;
  /** Event, metadata, or explicitly declared fact IDs that support this value. */
  evidenceIds: string[];
  value?: T;
};

export type SubjectModelFact = {
  provider?: string;
  modelId?: string;
  modelAlias?: string;
  modelVersion?: string;
  reasoningEffort?: string;
  harnessVersion?: string;
  observedAt?: string;
};

export type SkillExecutionFact = {
  skillId?: string;
  versionOrHash?: string;
  activationSource?: string;
  status: "loaded" | "completed" | "failed" | "unknown";
  toolCallId?: string;
};

export type InstructionContextFact = {
  source?: "user" | "agents" | "skill" | "system" | "unknown";
  versionOrHash?: string;
  appliedScope?: string;
};

export type TaskContextFact = {
  taskType?: string;
  complexity?:
    | "mechanical"
    | "bounded_change"
    | "high_risk_or_uncertain"
    | "unknown";
  risk?: "low" | "medium" | "high" | "unknown";
  completionCriteria?: string[];
};

export type VerificationRunFact = {
  id: string;
  command?: string;
  target?: string;
  revision?: string;
  status: "passed" | "failed" | "unknown";
  /** Whether a relevant change or failure occurred since the prior matching run. */
  changedSincePrevious?: boolean;
};

export type CompletionFact = {
  status: "completed" | "partially_completed" | "blocked" | "unknown";
  requestedSteps?: string[];
  performedSteps?: string[];
  blockingReason?: string;
};

export type OutcomeFact = {
  result?: "succeeded" | "partially_succeeded" | "failed" | "unknown";
  verificationStatus?: "passed" | "failed" | "unknown";
  reviewStatus?: "approved" | "changes_requested" | "unknown";
  deploymentStatus?: "deployed" | "failed" | "not_requested" | "unknown";
};

/**
 * This deliberately accepts only observed, explicitly-declared facts. Adapters
 * should preserve unknown values instead of guessing from event text.
 */
export type EvaluationFacts = {
  subjectModel?: ObservedFact<SubjectModelFact>;
  skillExecutions?: ObservedFact<SkillExecutionFact[]>;
  instructionContext?: ObservedFact<InstructionContextFact[]>;
  taskContext?: ObservedFact<TaskContextFact>;
  verificationRuns?: ObservedFact<VerificationRunFact[]>;
  outcome?: ObservedFact<OutcomeFact>;
  completion?: ObservedFact<CompletionFact>;
  toolOutcomes?: ObservedFact<ToolOutcomeFact[]>;
};

export type ToolOutcomeFact = {
  resultEventId: string;
  callId?: string;
  toolName?: string;
  /** Set only from structured tool metadata or a confirmed process exit. */
  status: "succeeded" | "failed" | "unknown";
  /** A real process exit code. Omit it when the source did not record one. */
  exitCode?: number;
  failureKind?: string;
};

export type EvaluationCandidate = {
  ruleId: string;
  version: number;
  title: string;
  evidenceIds: string[];
  count: number;
  /** A bounded next step, never a verdict that the observed work was wrong. */
  action?: string;
};

export type EvaluationRuleDefinition = {
  id: string;
  version: number;
  kind: EvaluationRuleKind;
  status: EvaluationRuleStatus;
  title: string;
  group: "execution" | "model" | "instruction" | "verification" | "completion";
  readonly requiredFacts: ReadonlyArray<keyof EvaluationFacts>;
  applicability: string;
  readonly rubric: readonly string[];
  defaultEnabled: boolean;
};

export const semanticSystemCommonRubric = [
  "원본 이벤트와 구조화된 관측 사실만 사용한다. 누락값은 추측하지 않는다.",
  "candidate는 위반·낭비·잘못이라는 판정이 아니다. 반례와 추가 확인 방법을 함께 적는다.",
  "선택되지 않은 rubric의 결론을 대신 만들지 않는다. 근거 ID와 적용한 규칙 ID@version을 보존한다.",
] as const;

export const evaluationCatalog = [
  {
    id: "repeated-tool-call",
    version: 1,
    kind: "deterministic",
    status: "active",
    title: "동일한 도구 호출 반복",
    group: "execution",
    requiredFacts: [],
    applicability:
      "같은 도구 이름과 입력이 세 번 이상 관측됐을 때만 후보를 만든다.",
    rubric: [
      "반복 횟수와 각 호출의 이벤트 ID를 보존한다.",
      "재시도·필수 검증·변경 뒤 재실행일 수 있으므로, 반복만으로 불필요했다고 단정하지 않는다.",
    ],
    defaultEnabled: true,
  },
  {
    id: "tool-error",
    version: 2,
    kind: "deterministic",
    status: "active",
    title: "확인된 도구 실패 응답 관측",
    group: "execution",
    requiredFacts: ["toolOutcomes"],
    applicability:
      "구조화된 실패 상태 또는 실제 0이 아닌 종료 코드가 관측된 결과만 후보로 만든다.",
    rubric: [
      "결과 텍스트의 error·failed·오류·실패 단어는 실패의 근거가 아니다.",
      "성공 상태가 확인된 결과는 오류 단어가 포함돼도 실패 후보에 넣지 않는다.",
    ],
    defaultEnabled: true,
  },
  {
    id: "model-fit",
    version: 1,
    kind: "semantic",
    status: "active",
    title: "실행 모델과 작업 조건의 적합성",
    group: "model",
    requiredFacts: ["subjectModel", "taskContext"],
    applicability:
      "실제 실행 모델과 작업 조건이 모두 관측된 경우에만 선택한다.",
    rubric: [
      "실행 모델 ID·제공자·버전 또는 별칭·추론 강도와 작업 복잡도·위험·완료 기준을 분리해 기록한다.",
      "비교군·가격·결과 근거가 없으면 더 낮은 설정이 충분했다고 말하지 않고, 필요한 A/B 비교만 제안한다.",
    ],
    defaultEnabled: true,
  },
  {
    id: "skill-impact",
    version: 1,
    kind: "semantic",
    status: "active",
    title: "스킬과 지시 묶음의 관측 영향",
    group: "instruction",
    requiredFacts: ["skillExecutions", "instructionContext", "outcome"],
    applicability:
      "실제 스킬 실행·적용된 지시 맥락·작업 결과가 모두 관측된 경우에만 선택한다.",
    rubric: [
      "이름 언급은 실행으로 세지 않는다. 스킬 ID·버전 또는 hash·활성화 방식·도구 결과를 근거로 남긴다.",
      "동일 완료 기준의 비교군이 없으면 도움이 됨·부담됨을 결론 내리지 않고, 유지 또는 축소 A/B의 조건을 제안한다.",
    ],
    defaultEnabled: true,
  },
  {
    id: "verification-repetition",
    version: 1,
    kind: "semantic",
    status: "active",
    title: "검증 반복의 필요성",
    group: "verification",
    requiredFacts: ["verificationRuns"],
    applicability:
      "같은 대상의 반복 검증과 각 반복 사이의 변경 또는 실패 맥락이 관측된 경우에만 선택한다.",
    rubric: [
      "변경·실패 뒤 재실행, 필수 CI, 운영 확인은 중복으로 분류하지 않는다.",
      "명령·대상·revision·상태와 변경 여부를 연결하지 못하면 반복의 필요성을 평가하지 않는다.",
    ],
    defaultEnabled: true,
  },
  {
    id: "premature-handoff",
    version: 1,
    kind: "semantic",
    status: "active",
    title: "완료 전 인계 가능성",
    group: "completion",
    requiredFacts: ["completion"],
    applicability:
      "요청된 완료 조건과 수행·미수행 단계 또는 차단 사유가 관측된 경우에만 선택한다.",
    rubric: [
      "완료 상태가 unknown이면 조기 인계 후보를 만들지 않고 insufficient로 남긴다.",
      "사용자가 중간 리뷰를 요청했거나 외부 차단이 확인되면 조기 종료라고 단정하지 않는다.",
    ],
    defaultEnabled: true,
  },
] as const satisfies readonly EvaluationRuleDefinition[];

export type EvaluationCatalogRule = (typeof evaluationCatalog)[number];

export function catalogRule(id: string): EvaluationCatalogRule | undefined {
  return evaluationCatalog.find((rule) => rule.id === id);
}

export function isConfirmedToolFailure(outcome: ToolOutcomeFact): boolean {
  if (outcome.status === "succeeded") return false;
  return (
    outcome.status === "failed" ||
    (outcome.exitCode !== undefined && outcome.exitCode !== 0)
  );
}

function selectionForFacts(
  rule: EvaluationRuleDefinition,
  facts: EvaluationFacts,
): { state: RuleSelectionState; reason: string; evidenceIds: string[] } {
  const required = rule.requiredFacts.map((key) => [key, facts[key]] as const);
  const inapplicable = required.find(
    ([, fact]) => fact?.state === "not_applicable",
  );
  if (inapplicable) {
    return {
      state: "not_applicable",
      reason: `${inapplicable[0]} is not applicable to this session.`,
      evidenceIds: inapplicable[1]?.evidenceIds ?? [],
    };
  }
  const missing = required.filter(
    ([, fact]) => !fact || fact.state !== "observed",
  );
  if (missing.length) {
    return {
      state: "insufficient",
      reason: `Missing observed facts: ${missing.map(([key]) => key).join(", ")}.`,
      evidenceIds: missing.flatMap(([, fact]) => fact?.evidenceIds ?? []),
    };
  }

  if (rule.id === "model-fit") {
    const subjectModel = facts.subjectModel?.value;
    if (!subjectModel?.modelId && !subjectModel?.modelAlias) {
      return {
        state: "insufficient",
        reason: "Observed subjectModel has no modelId or modelAlias.",
        evidenceIds: facts.subjectModel?.evidenceIds ?? [],
      };
    }
  }
  if (rule.id === "skill-impact") {
    const skills = facts.skillExecutions?.value ?? [];
    if (
      !skills.some(
        (skill) => skill.skillId || skill.versionOrHash || skill.toolCallId,
      )
    ) {
      return {
        state: "not_applicable",
        reason: "No observed skill execution reference is available.",
        evidenceIds: facts.skillExecutions?.evidenceIds ?? [],
      };
    }
    if (!(facts.instructionContext?.value?.length ?? 0)) {
      return {
        state: "insufficient",
        reason:
          "Observed instructionContext has no applied instruction entries.",
        evidenceIds: facts.instructionContext?.evidenceIds ?? [],
      };
    }
  }
  if (rule.id === "verification-repetition") {
    const runs = facts.verificationRuns?.value ?? [];
    const repeatedTargets = new Map<string, VerificationRunFact[]>();
    for (const run of runs) {
      const key = JSON.stringify([run.command, run.target]);
      repeatedTargets.set(key, [...(repeatedTargets.get(key) ?? []), run]);
    }
    const repeats = [...repeatedTargets.values()].find(
      (group) => group.length >= 2,
    );
    if (!repeats) {
      return {
        state: "not_applicable",
        reason: "No repeated verification command and target are observed.",
        evidenceIds: facts.verificationRuns?.evidenceIds ?? [],
      };
    }
    if (!repeats.some((run) => run.changedSincePrevious !== undefined)) {
      return {
        state: "insufficient",
        reason:
          "Repeated verification has no explicit change or failure context.",
        evidenceIds: facts.verificationRuns?.evidenceIds ?? [],
      };
    }
  }
  if (rule.id === "premature-handoff") {
    const completion = facts.completion?.value;
    if (completion?.status === "unknown") {
      return {
        state: "insufficient",
        reason: "Completion status is unknown.",
        evidenceIds: facts.completion?.evidenceIds ?? [],
      };
    }
    if (
      !completion?.requestedSteps?.length &&
      !completion?.performedSteps?.length &&
      !completion?.blockingReason
    ) {
      return {
        state: "insufficient",
        reason:
          "Completion has no requested, performed, or blocking-step context.",
        evidenceIds: facts.completion?.evidenceIds ?? [],
      };
    }
  }
  return {
    state: "selected",
    reason: "Required observed facts are available.",
    evidenceIds: required.flatMap(([, fact]) => fact?.evidenceIds ?? []),
  };
}

export type RuleSelection = {
  ruleId: string;
  version: number;
  kind: EvaluationRuleKind;
  status: EvaluationRuleStatus;
  state: RuleSelectionState;
  reason: string;
  evidenceIds: string[];
};

export type SemanticRubricSelection = {
  systemCommonRubric: readonly string[];
  selected: RuleSelection[];
  all: RuleSelection[];
};

/** Returns only the common instruction and rubrics that were actually selected. */
export function selectedSemanticRubricText(
  selection: SemanticRubricSelection,
): {
  systemCommonRubric: readonly string[];
  rubrics: Array<
    Pick<EvaluationCatalogRule, "id" | "version" | "title" | "rubric">
  >;
} {
  return {
    systemCommonRubric: selection.systemCommonRubric,
    rubrics: selection.selected.flatMap((selected) => {
      const rule = catalogRule(selected.ruleId);
      return rule?.kind === "semantic" ? [rule] : [];
    }),
  };
}

export function selectSemanticRubrics(
  facts: EvaluationFacts,
  options: {
    enabledRuleIds?: string[];
    maxGroups?: number;
    registry?: readonly EvaluationRuleDefinition[];
  } = {},
): SemanticRubricSelection {
  const registry = options.registry ?? evaluationCatalog;
  const enabled = new Set(
    options.enabledRuleIds ??
      registry.filter((rule) => rule.defaultEnabled).map((rule) => rule.id),
  );
  const maxGroups = options.maxGroups ?? 3;
  const selectedGroups = new Set<string>();
  const all = registry
    .filter((rule) => rule.kind === "semantic")
    .map((rule) => {
      if (!enabled.has(rule.id)) {
        return {
          ruleId: rule.id,
          version: rule.version,
          kind: rule.kind,
          status: rule.status,
          state: "disabled" as const,
          reason: "Rule is not enabled for this evaluation.",
          evidenceIds: [],
        };
      }
      if (rule.status !== "active") {
        return {
          ruleId: rule.id,
          version: rule.version,
          kind: rule.kind,
          status: rule.status,
          state: "disabled" as const,
          reason: `Rule status is ${rule.status}.`,
          evidenceIds: [],
        };
      }
      const decision = selectionForFacts(rule, facts);
      if (decision.state === "selected") {
        if (
          selectedGroups.size >= maxGroups &&
          !selectedGroups.has(rule.group)
        ) {
          return {
            ruleId: rule.id,
            version: rule.version,
            kind: rule.kind,
            status: rule.status,
            state: "deferred" as const,
            reason: `Eligible, but the ${maxGroups}-group rubric budget is exhausted.`,
            evidenceIds: decision.evidenceIds,
          };
        }
        selectedGroups.add(rule.group);
      }
      return {
        ruleId: rule.id,
        version: rule.version,
        kind: rule.kind,
        status: rule.status,
        ...decision,
      };
    });
  return {
    systemCommonRubric: semanticSystemCommonRubric,
    selected: all.filter((selection) => selection.state === "selected"),
    all,
  };
}

export function evaluateDeterministicCatalog(
  events: AtlasEvent[],
  facts: EvaluationFacts = {},
  options: { enabledRuleIds?: string[] } = {},
): { candidates: EvaluationCandidate[]; rules: RuleSelection[] } {
  const enabled = new Set(
    options.enabledRuleIds ??
      evaluationCatalog
        .filter((rule) => rule.defaultEnabled)
        .map((rule) => rule.id),
  );
  const candidates: EvaluationCandidate[] = [];
  const rules: RuleSelection[] = [];
  for (const rule of evaluationCatalog.filter(
    (item) => item.kind === "deterministic",
  )) {
    if (!enabled.has(rule.id)) {
      rules.push({
        ruleId: rule.id,
        version: rule.version,
        kind: rule.kind,
        status: rule.status,
        state: "disabled",
        reason: "Rule is not enabled for this evaluation.",
        evidenceIds: [],
      });
      continue;
    }
    const decision = selectionForFacts(rule, facts);
    if (
      decision.state === "insufficient" ||
      decision.state === "not_applicable"
    ) {
      rules.push({
        ruleId: rule.id,
        version: rule.version,
        kind: rule.kind,
        status: rule.status,
        ...decision,
      });
      continue;
    }
    if (rule.id === "repeated-tool-call") {
      const groups = new Map<string, AtlasEvent[]>();
      for (const event of events) {
        if (event.kind !== "tool_call") continue;
        const key = JSON.stringify([event.name, event.text]);
        groups.set(key, [...(groups.get(key) ?? []), event]);
      }
      for (const group of groups.values()) {
        if (group.length < 3) continue;
        candidates.push({
          ruleId: rule.id,
          version: rule.version,
          title: rule.title,
          count: group.length,
          evidenceIds: group.map((event) => event.id),
          action:
            "Compare intervening changes, failures, and required verification before reducing repeats.",
        });
      }
    }
    if (rule.id === "tool-error") {
      const outcomes = facts.toolOutcomes?.value ?? [];
      const failures = outcomes.filter(isConfirmedToolFailure);
      if (failures.length) {
        candidates.push({
          ruleId: rule.id,
          version: rule.version,
          title: rule.title,
          count: failures.length,
          evidenceIds: failures.map((outcome) => outcome.resultEventId),
          action:
            "Review the confirmed failure and any subsequent recovery; do not infer failure from wording alone.",
        });
      }
    }
    rules.push({
      ruleId: rule.id,
      version: rule.version,
      kind: rule.kind,
      status: rule.status,
      state: "selected",
      reason: "Rule evaluated with its required observed facts.",
      evidenceIds: decision.evidenceIds,
    });
  }
  return { candidates, rules };
}
