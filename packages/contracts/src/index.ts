import { z } from "zod";
export const SCHEMA_VERSION = 1;
export const MAX_BATCH_BYTES = 1_048_576;
export const Event = z.object({
  id: z.string().min(1).max(128),
  timestamp: z.string().datetime({ offset: true }).nullable(),
  kind: z.enum(["user", "assistant", "tool_call", "tool_result", "usage"]),
  text: z.string().max(180_000).optional(),
  name: z.string().max(200).optional(),
  callId: z.string().max(256).optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cachedTokens: z.number().nonnegative().optional(),
});
export type AtlasEvent = z.infer<typeof Event>;
export const Batch = z
  .object({
    schema_version: z.literal(1),
    batch_id: z.string().uuid(),
    source: z.literal("codex"),
    session_id: z.string().min(1).max(200),
    project: z.string().min(1).max(1000),
    generation: z.string().regex(/^[a-f0-9]{64}$/),
    start_offset: z.number().int().nonnegative(),
    end_offset: z.number().int().nonnegative(),
    events: z.array(Event).max(1000),
  })
  .refine((b) => b.end_offset > b.start_offset, "Offsets must advance");
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
  toolErrors: number;
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
    /\b(error|failed|exception)\b|오류|실패/i.test(event.text || "")
  );
}
export const rules: Rule[] = [
  {
    id: "repeated-tool-call",
    version: 1,
    evaluate(events) {
      const groups = new Map<string, AtlasEvent[]>();
      for (const e of events.filter((e) => e.kind === "tool_call")) {
        const k = JSON.stringify([e.name, e.text]);
        groups.set(k, [...(groups.get(k) || []), e]);
      }
      return [...groups.values()]
        .filter((g) => g.length >= 3)
        .map((g) => ({
          ruleId: this.id,
          version: this.version,
          title: "동일한 도구 호출 반복",
          count: g.length,
          evidenceIds: g.map((e) => e.id),
        }));
    },
  },
  {
    id: "tool-error",
    version: 1,
    evaluate(events) {
      const es = events.filter(isToolErrorEvent);
      return es.length
        ? [
            {
              ruleId: this.id,
              version: this.version,
              title: "도구 오류 응답 관측",
              count: es.length,
              evidenceIds: es.map((e) => e.id),
            },
          ]
        : [];
    },
  },
];
export function analysisVersion(
  registry: Rule[] = rules,
  enabled = registry.map((r) => r.id),
) {
  return (
    "metrics-1:" +
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
    toolErrors: events.filter(isToolErrorEvent).length,
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
      return { ...base, kind: p.role, text };
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
