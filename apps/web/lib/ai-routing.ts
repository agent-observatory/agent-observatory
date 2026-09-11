import { z } from "zod";
import { completion, retryDelay } from "./provider";

export const routingVersion = "free-pool-2";
export type AISettings = { provider: string; endpoint: string; model: string };
export type Candidate = {
  provider: string;
  endpoint: string;
  model: string;
  keyEnv?: string;
  options?: Record<string, unknown>;
};
// Only explicitly free models belong here. BYOK never enters this pool.
const freePool: Candidate[] = [
  {
    provider: "nvidia",
    endpoint: "https://integrate.api.nvidia.com/v1",
    model: "moonshotai/kimi-k3",
    keyEnv: "NVIDIA_API_KEY",
    options: { reasoning_effort: "high" },
  },
  {
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    model: "nex-agi/nex-n2.5-pro:free",
    keyEnv: "OPENROUTER_API_KEY",
  },
  {
    provider: "nvidia",
    endpoint: "https://integrate.api.nvidia.com/v1",
    model: "deepseek-ai/deepseek-v4-pro-0813",
    keyEnv: "NVIDIA_API_KEY",
    options: { chat_template_kwargs: { thinking: true } },
  },
  {
    provider: "nvidia",
    endpoint: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    keyEnv: "NVIDIA_API_KEY",
    options: { chat_template_kwargs: { enable_thinking: true } },
  },
  {
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    model: "nex-agi/nex-n2.5-mini:free",
    keyEnv: "OPENROUTER_API_KEY",
  },
  {
    provider: "zai",
    endpoint: "https://api.z.ai/api/paas/v4",
    model: "glm-4.7-flash",
    keyEnv: "ZAI_API_KEY",
  },
];
export const isFree = (settings: AISettings) =>
  ["free", "zai"].includes(settings.provider);
export function normalizeSettings<T extends AISettings>(settings: T): T {
  return isFree(settings)
    ? { ...settings, provider: "free", endpoint: "", model: "auto" }
    : settings;
}
export function freeCandidates(
  env: Record<string, string | undefined> = process.env,
) {
  return freePool.filter((c) => env[c.keyEnv!]?.trim());
}
export function candidates(
  settings: AISettings,
  env: Record<string, string | undefined> = process.env,
): Candidate[] {
  return isFree(settings)
    ? freeCandidates(env)
    : [
        {
          provider: settings.provider,
          endpoint: settings.endpoint,
          model: settings.model,
        },
      ];
}
export function selectCandidate(
  pool: Candidate[],
  cooldowns: Record<string, number>,
  now = Date.now(),
) {
  const availableAt = (c: Candidate) =>
    Math.max(cooldowns[c.provider] || 0, cooldowns[modelCooldownKey(c)] || 0);
  const candidate = pool.find((c) => availableAt(c) <= now);
  return {
    candidate,
    waitSeconds:
      candidate || !pool.length
        ? 0
        : Math.max(
            1,
            Math.ceil((Math.min(...pool.map(availableAt)) - now) / 1000),
          ),
  };
}
export const modelCooldownKey = (candidate: Candidate) =>
  candidate.provider + ":" + candidate.model;
export function failureCooldownKey(candidate: Candidate, attempt: Attempt) {
  // Unknown 429 scope is conservatively treated as an account-wide limit.
  // Do not rotate models to evade the account's quota or authentication failure.
  return [401, 402, 403, 429].includes(attempt.status || 0) &&
    attempt.rateLimitScope !== "model"
    ? candidate.provider
    : modelCooldownKey(candidate);
}
export type Attempt = {
  provider: string;
  model: string;
  at: string;
  outcome: "success" | "http_error" | "connection_error" | "invalid_output";
  status?: number;
  rateLimitScope?: "provider" | "model";
  validationError?:
    | "invalid_json"
    | "invalid_schema"
    | "invalid_evidence"
    | "truncated_output"
    | "empty_output";
};
export const Explanation = z.object({
  summary: z.string().min(1).max(3000),
  suggestions: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        title: z.string().min(1).max(200).optional(),
        problem: z.string().min(1).max(1500).optional(),
        action: z.string().min(1).max(1500).optional(),
        verification: z.string().min(1).max(1000).optional(),
        ruleId: z.string().min(1).max(100).optional(),
        ruleVersion: z.number().int().positive().optional(),
        evidenceIds: z.array(z.string()).min(1).max(50),
      }),
    )
    .max(10),
});
export function parseExplanation(
  content: unknown,
  evidenceIds: Set<string>,
  actionable = false,
  allowedEvidenceByRule?: Record<string, Set<string>>,
) {
  const parsed = Explanation.parse(
    JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, "")),
  );
  if (
    parsed.suggestions.some((s) =>
      s.evidenceIds.some((id) => !evidenceIds.has(id)),
    )
  )
    throw new Error("AI 근거 검증 실패");
  if (
    actionable &&
    parsed.suggestions.some(
      (s) =>
        !s.title ||
        !s.problem ||
        !s.action ||
        !s.verification ||
        !s.ruleId ||
        !s.ruleVersion,
    )
  )
    throw new Error("invalid_schema");
  if (
    allowedEvidenceByRule &&
    parsed.suggestions.some((s) => {
      const allowed = allowedEvidenceByRule[`${s.ruleId}@${s.ruleVersion}`];
      return !allowed || !s.evidenceIds.some((id) => allowed.has(id));
    })
  )
    throw new Error("AI 근거 검증 실패");
  return parsed;
}
export function completionBody(
  candidate: Candidate,
  free: boolean,
  body: Record<string, unknown>,
) {
  return {
    ...body,
    model: candidate.model,
    ...candidate.options,
    ...(free && candidate.provider === "openrouter"
      ? { provider: { max_price: { prompt: 0, completion: 0 } } }
      : {}),
  };
}
export function provenance(candidate: Candidate, free: boolean, data: any) {
  const safeName = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
  return {
    tier: free ? "free" : "byok",
    provider: candidate.provider,
    endpoint: new URL(candidate.endpoint).hostname,
    requestedModel: candidate.model,
    model: safeName(data?.model) || candidate.model,
    upstreamProvider: safeName(data?.provider),
  };
}
export async function attemptCompletion(
  candidate: Candidate,
  key: string,
  free: boolean,
  body: Record<string, unknown>,
  evidenceIds: Set<string>,
  attemptNumber: number,
  transport: typeof completion = completion,
  actionable = false,
  allowedEvidenceByRule?: Record<string, Set<string>>,
) {
  const attempt: Attempt = {
    provider: candidate.provider,
    model: candidate.model,
    at: new Date().toISOString(),
    outcome: "connection_error",
  };
  let response: Awaited<ReturnType<typeof completion>>;
  try {
    response = await transport(
      candidate.endpoint,
      key,
      completionBody(candidate, free, body),
    );
  } catch (e) {
    if (e instanceof Error && e.message === "Provider response too large") {
      attempt.outcome = "invalid_output";
      return {
        ok: false as const,
        attempt,
        retryable: false,
        waitSeconds: retryDelay(attemptNumber),
      };
    }
    if (
      !(e instanceof Error) ||
      !["TypeError", "TimeoutError", "AbortError"].includes(e.name)
    )
      throw e;
    return {
      ok: false as const,
      attempt,
      retryable: true,
      waitSeconds: retryDelay(attemptNumber),
    };
  }
  attempt.status = response.status;
  attempt.rateLimitScope = response.rateLimitScope;
  if (![200, 201].includes(response.status)) {
    attempt.outcome = "http_error";
    return {
      ok: false as const,
      attempt,
      retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
      waitSeconds: [401, 403, 404].includes(response.status)
        ? 86400
        : retryDelay(attemptNumber, response.retryAfter),
    };
  }
  try {
    const ai = parseExplanation(
      response.data?.choices?.[0]?.message?.content,
      evidenceIds,
      actionable,
      allowedEvidenceByRule,
    );
    attempt.outcome = "success";
    return {
      ok: true as const,
      attempt,
      ai,
      ...provenance(candidate, free, response.data),
      usage: response.data?.usage || null,
    };
  } catch (error) {
    attempt.outcome = "invalid_output";
    attempt.validationError =
      response.data?.choices?.[0]?.finish_reason === "length"
        ? "truncated_output"
        : !response.data?.choices?.[0]?.message?.content
          ? "empty_output"
          : error instanceof SyntaxError
            ? "invalid_json"
            : error instanceof Error && error.message === "AI 근거 검증 실패"
              ? "invalid_evidence"
              : "invalid_schema";
    return {
      ok: false as const,
      attempt,
      retryable: false,
      waitSeconds: retryDelay(attemptNumber),
    };
  }
}
