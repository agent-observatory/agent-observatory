import { z } from "zod";
import {
  evaluationCatalog,
  evaluateDeterministicCatalog,
  isConfirmedToolFailure,
} from "@agent-observatory/contracts/evaluation";
// Version 1 remains readable because personal-pilot Outbox and stored batches
// are durable evidence. New collectors write version 2.
export const SCHEMA_VERSION = 2;
export const MAX_COMPRESSED_BATCH_BYTES = 1_048_576;
export const MAX_DECODED_BATCH_BYTES = 8 * 1_048_576;
export const MAX_JSONL_LINE_BYTES = 64 * 1_048_576;
// Kept as an alias for callers that previously treated this as the request cap.
export const MAX_BATCH_BYTES = MAX_COMPRESSED_BATCH_BYTES;
export const ImageMetadata = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z
    .string()
    .regex(/^image\/[a-z0-9.+-]+$/i)
    .max(100),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  status: z.literal("local_only"),
});
export const SourceType = z.enum(["codex", "claude-code"]);
export type SourceType = z.infer<typeof SourceType>;
export const SubjectModel = z.object({
  // The harness is always known from the adapter. All model fields are only
  // populated when the source record itself exposes them.
  harness: SourceType,
  provider: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(300).optional(),
  reasoning: z.string().min(1).max(200).optional(),
});
export type SubjectModel = z.infer<typeof SubjectModel>;
export const ObservableReference = z
  .object({
    kind: z.enum(["skill", "instruction"]),
    evidence: z.enum(["invoked", "read", "configured"]),
    id: z.string().min(1).max(300).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine((reference) => reference.id || reference.sha256, {
    message: "An observable reference needs an ID or hash",
  });
export type ObservableReference = z.infer<typeof ObservableReference>;
export const Event = z.object({
  id: z.string().min(1).max(128),
  timestamp: z.string().datetime({ offset: true }).nullable(),
  kind: z.enum(["user", "assistant", "tool_call", "tool_result", "usage"]),
  text: z.string().max(MAX_DECODED_BATCH_BYTES).optional(),
  name: z.string().max(200).optional(),
  callId: z.string().max(256).optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cachedTokens: z.number().nonnegative().optional(),
  images: z.array(ImageMetadata).max(1000).optional(),
  observations: z.array(ObservableReference).max(100).optional(),
  subject_model: SubjectModel.optional(),
  toolOutcome: z
    .object({
      status: z.enum(["succeeded", "failed", "unknown"]),
      exitCode: z.number().int().optional(),
    })
    .optional(),
});
export type AtlasEvent = z.infer<typeof Event>;
export const Batch = z
  .object({
    schema_version: z.union([z.literal(1), z.literal(SCHEMA_VERSION)]),
    batch_id: z.string().uuid(),
    source: SourceType,
    subject_model: SubjectModel.optional(),
    session_id: z.string().min(1).max(200),
    project: z.string().min(1).max(1000),
    generation: z.string().regex(/^[a-f0-9]{64}$/),
    start_offset: z.number().int().nonnegative(),
    end_offset: z.number().int().nonnegative(),
    events: z.array(Event).max(1000),
  })
  .refine((b) => b.end_offset > b.start_offset, "Offsets must advance")
  .superRefine((b, context) => {
    if (b.schema_version === 1 && b.source !== "codex")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Version 1 batches only support Codex",
      });
    if (b.schema_version === SCHEMA_VERSION && !b.subject_model)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Version 2 batches require subject_model provenance",
      });
    if (b.subject_model && b.subject_model.harness !== b.source)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batch subject_model harness must match source",
      });
    b.events.forEach((event, index) => {
      if (
        event.subject_model?.harness !== undefined &&
        event.subject_model.harness !== b.source
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "subject_model", "harness"],
          message: "Event subject_model harness must match source",
        });
    });
  });
export type AtlasBatch = z.infer<typeof Batch>;
export const Ack = z.object({
  batch_id: z.string().uuid(),
  received_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  end_offset: z.number().int().nonnegative(),
});
export type Metrics = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolErrors: number | null;
  toolOutcomesObserved: number;
  events: number;
};
export type Candidate = {
  ruleId: string;
  version: number;
  title: string;
  evidenceIds: string[];
  count: number;
};
export type RuleError = {
  ruleId: string;
  version: number;
  error: "evaluation_failed";
};
export interface Rule {
  id: string;
  version: number;
  evaluate(events: AtlasEvent[]): Candidate[];
}
export function isToolErrorEvent(event: AtlasEvent) {
  return (
    event.kind === "tool_result" &&
    Boolean(
      event.toolOutcome &&
        isConfirmedToolFailure({
          resultEventId: event.id,
          ...event.toolOutcome,
        }),
    )
  );
}
export const rules: Rule[] = evaluationCatalog
  .filter((rule) => rule.kind === "deterministic")
  .map((rule) => ({
    id: rule.id,
    version: rule.version,
    evaluate(events) {
      const outcomes = events
        .filter((e) => e.kind === "tool_result" && e.toolOutcome)
        .map((e) => ({
          resultEventId: e.id,
          callId: e.callId,
          ...e.toolOutcome!,
        }));
      return evaluateDeterministicCatalog(
        events,
        {
          toolOutcomes: {
            state: outcomes.some((o) => o.status !== "unknown")
              ? "observed"
              : "unknown",
            evidenceIds: outcomes.map((o) => o.resultEventId),
            value: outcomes,
          },
        },
        { enabledRuleIds: [rule.id] },
      ).candidates;
    },
  }));
export function analysisVersion(
  registry: Rule[] = rules,
  enabled = registry.map((r) => r.id),
) {
  return (
    "analysis-1:" +
    registry
      .filter((r) => enabled.includes(r.id))
      .map((r) => `${r.id}@${r.version}`)
      .sort()
      .join(",")
  );
}
export function analyze(
  events: AtlasEvent[],
  enabled?: string[],
  registry: Rule[] = rules,
) {
  const enabledIds = enabled ?? registry.map((r) => r.id);
  const usages = events.filter((e) => e.kind === "usage");
  const latest = usages.at(-1);
  const metrics: Metrics = {
    inputTokens: latest?.inputTokens ?? null,
    outputTokens: latest?.outputTokens ?? null,
    cachedTokens: latest?.cachedTokens ?? null,
    userMessages: events.filter((e) => e.kind === "user").length,
    assistantMessages: events.filter((e) => e.kind === "assistant").length,
    toolCalls: events.filter((e) => e.kind === "tool_call").length,
    toolErrors: events.some(
      (e) =>
        e.kind === "tool_result" &&
        e.toolOutcome &&
        e.toolOutcome.status !== "unknown",
    )
      ? events.filter(isToolErrorEvent).length
      : null,
    toolOutcomesObserved: events.filter(
      (e) =>
        e.kind === "tool_result" &&
        e.toolOutcome &&
        e.toolOutcome.status !== "unknown",
    ).length,
    events: events.length,
  };
  const appliedRules: Array<Pick<Rule, "id" | "version">> = [];
  const ruleErrors: RuleError[] = [];
  const candidates: Candidate[] = [];
  for (const rule of registry) {
    if (!enabledIds.includes(rule.id)) continue;
    appliedRules.push({ id: rule.id, version: rule.version });
    try {
      candidates.push(...rule.evaluate(events));
    } catch {
      ruleErrors.push({
        ruleId: rule.id,
        version: rule.version,
        error: "evaluation_failed",
      });
    }
  }
  return {
    analysisVersion: analysisVersion(registry, enabledIds),
    metrics,
    candidates,
    appliedRules,
    ruleErrors,
  };
}
export function maskText(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[PRIVATE_KEY]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16})\b/g,
      "[SECRET]",
    )
    .replace(
      /((?:api[_-]?key|secret|password|token|authorization)\s*["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',;\n}]+/gi,
      "$1[SECRET]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
export function maskBatch(batch: AtlasBatch): AtlasBatch {
  return {
    ...batch,
    project: maskText(batch.project),
    events: batch.events.map((e) => ({
      ...e,
      ...(e.text === undefined ? {} : { text: maskText(e.text) }),
    })),
  };
}
export function codexSubjectModel(record: unknown): SubjectModel | undefined {
  if (!record || typeof record !== "object") return undefined;
  const r = record as Record<string, any>;
  const p = r.payload;
  if (!p || typeof p !== "object") return undefined;
  const provider =
    typeof p.model_provider === "string" ? p.model_provider : undefined;
  const model = typeof p.model === "string" ? p.model : undefined;
  const reasoning =
    typeof p.reasoning_effort === "string"
      ? p.reasoning_effort
      : typeof p.reasoning === "string"
        ? p.reasoning
        : undefined;
  return provider || model || reasoning
    ? {
        harness: "codex",
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
      }
    : undefined;
}
// Accept only known Codex records. Unknown structures are skipped, not guessed.
export function codexEvent(record: unknown, id: string): AtlasEvent | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, any>;
  const p = r.payload;
  if (!p || typeof p !== "object") return null;
  const timestamp =
    typeof r.timestamp === "string" && !Number.isNaN(Date.parse(r.timestamp))
      ? new Date(r.timestamp).toISOString()
      : null;
  const observedModel = () => codexSubjectModel(record);
  const base = { id, timestamp };
  if (r.type === "response_item") {
    if (p.type === "message" && ["user", "assistant"].includes(p.role)) {
      const text = Array.isArray(p.content)
        ? p.content
            .filter(
              (x: any) =>
                ["input_text", "output_text", "text"].includes(x.type) &&
                typeof x.text === "string",
            )
            .map((x: any) => x.text)
            .join("\n")
        : "";
      return {
        ...base,
        kind: p.role,
        text,
        ...(p.role === "assistant" && observedModel()
          ? { subject_model: observedModel() }
          : {}),
      };
    }
    if (["function_call", "custom_tool_call"].includes(p.type))
      return {
        ...base,
        kind: "tool_call",
        name: String(p.name || "unknown"),
        callId: p.call_id,
        text:
          typeof p.arguments === "string"
            ? p.arguments
            : typeof p.input === "string"
              ? p.input
              : JSON.stringify(p.arguments ?? {}),
        ...(observedModel() ? { subject_model: observedModel() } : {}),
      };
    if (["function_call_output", "custom_tool_call_output"].includes(p.type))
      return {
        ...base,
        kind: "tool_result",
        callId: p.call_id,
        text:
          typeof p.output === "string"
            ? p.output
            : JSON.stringify(p.output ?? {}),
        toolOutcome:
          typeof p.exit_code === "number" && Number.isInteger(p.exit_code)
            ? {
                status: p.exit_code === 0 ? "succeeded" : "failed",
                exitCode: p.exit_code,
              }
            : { status: "unknown" },
        ...(observedModel() ? { subject_model: observedModel() } : {}),
      };
  }
  if (
    r.type === "event_msg" &&
    p.type === "token_count" &&
    p.info?.total_token_usage
  ) {
    const u = p.info.total_token_usage;
    return {
      ...base,
      kind: "usage",
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cachedTokens: u.cached_input_tokens,
    };
  }
  return null;
}
