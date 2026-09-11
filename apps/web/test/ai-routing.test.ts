import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidates,
  freeCandidates,
  selectCandidate,
  attemptCompletion,
  completionBody,
  parseExplanation,
  normalizeSettings,
} from "../lib/ai-routing";
import type { completion } from "../lib/provider";
const env = {
  NVIDIA_API_KEY: "synthetic-nvidia",
  OPENROUTER_API_KEY: "synthetic-or",
  ZAI_API_KEY: "synthetic-zai",
};
const settings = { provider: "free", endpoint: "", model: "auto" };
const response =
  (
    status: number,
    data: unknown = null,
    retryAfter: string | null = null,
  ): typeof completion =>
  async () => ({
    status,
    data,
    retryAfter,
    errorCode: null,
    rateLimitScope: undefined,
  });
const valid = {
  model: "actual-model",
  provider: "upstream",
  choices: [
    {
      message: {
        content:
          '{"summary":"검증 완료","suggestions":[{"text":"테스트 추가","evidenceIds":["event-1"]}]}',
      },
    },
  ],
};

test("configured free pool is fixed, missing keys skipped, legacy zai upgraded", () => {
  assert.deepEqual(freeCandidates({}), []);
  assert.deepEqual(
    freeCandidates({ OPENROUTER_API_KEY: "value" }).map((c) => c.provider),
    ["openrouter", "openrouter"],
  );
  assert.equal(
    normalizeSettings({
      provider: "zai",
      model: "glm-4.7-flash",
      endpoint: "https://api.z.ai/api/paas/v4",
    }).provider,
    "free",
  );
  assert.equal(freeCandidates(env).length, 6);
});
test("429 falls back across providers and persists actual successful provenance", async () => {
  const pool = candidates(settings, env),
    cooldowns: Record<string, number> = {};
  const first = selectCandidate(pool, cooldowns).candidate!;
  const rejected = await attemptCompletion(
    first,
    env.NVIDIA_API_KEY,
    true,
    {},
    new Set(["event-1"]),
    0,
    response(429, null, "900"),
  );
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw new Error("expected rejection");
  assert.ok(rejected.waitSeconds >= 900);
  cooldowns[first.provider] = Date.now() + rejected.waitSeconds * 1000;
  const next = selectCandidate(pool, cooldowns).candidate!;
  assert.equal(next.provider, "openrouter");
  const accepted = await attemptCompletion(
    next,
    env.OPENROUTER_API_KEY,
    true,
    {},
    new Set(["event-1"]),
    1,
    response(200, valid),
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) throw new Error("expected success");
  assert.equal(accepted.tier, "free");
  assert.equal(accepted.provider, "openrouter");
  assert.equal(accepted.model, "actual-model");
  assert.equal(accepted.requestedModel, next.model);
  assert.equal(accepted.upstreamProvider, "upstream");
  assert.ok(!JSON.stringify(accepted).includes("synthetic-or"));
});
test("all cooling down returns earliest wait without selecting a model", () => {
  const pool = candidates(settings, env),
    now = Date.now();
  const selected = selectCandidate(
    pool,
    { nvidia: now + 120000, openrouter: now + 300000, zai: now + 900000 },
    now,
  );
  assert.equal(selected.candidate, undefined);
  assert.equal(selected.waitSeconds, 120);
});
test("BYOK never uses shared keys or another provider on errors", async () => {
  const config = {
    provider: "custom",
    endpoint: "https://example.com/v1",
    model: "owned-model",
  };
  const pool = candidates(config, env);
  assert.deepEqual(pool, [config]);
  assert.equal(pool[0].keyEnv, undefined);
  const result = await attemptCompletion(
    pool[0],
    "owned-key",
    false,
    {},
    new Set(),
    0,
    response(401),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected rejection");
  assert.equal(result.retryable, false);
});
test("free OpenRouter price guard only applies to free OR requests", () => {
  const pool = candidates(settings, env);
  assert.deepEqual(completionBody(pool[1], true, {}).provider, {
    max_price: { prompt: 0, completion: 0 },
  });
  assert.equal(completionBody(pool[1], false, {}).provider, undefined);
  assert.equal(completionBody(pool[0], true, {}).provider, undefined);
});
test("malformed output and fabricated or unsampled evidence are rejected", async () => {
  assert.throws(() =>
    parseExplanation(
      '{"summary":"x","suggestions":[{"text":"x","evidenceIds":["not-sampled"]}]}',
      new Set(["sampled"]),
    ),
  );
  const r = await attemptCompletion(
    candidates(settings, env)[0],
    "key",
    true,
    {},
    new Set(),
    0,
    response(200, { choices: [{ message: { content: "bad json" } }] }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.attempt.outcome, "invalid_output");
});
test("timeouts are retryable; programming errors are not silently swallowed", async () => {
  const c = candidates(settings, env)[0];
  const result = await attemptCompletion(
    c,
    "key",
    true,
    {},
    new Set(),
    0,
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected rejection");
  assert.equal(result.retryable, true);
  await assert.rejects(
    attemptCompletion(c, "key", true, {}, new Set(), 0, async () => {
      throw new Error("bug");
    }),
  );
});

test("model failures allow another model of the same provider; shared quotas block all its models", async () => {
  const { modelCooldownKey, failureCooldownKey } = await import(
    "../lib/ai-routing"
  );
  const pool = candidates(settings, env).filter((c) => c.provider === "nvidia");
  assert.ok(pool.length > 1);
  const failure = {
    provider: pool[0].provider,
    model: pool[0].model,
    at: new Date().toISOString(),
    outcome: "http_error" as const,
    status: 503,
  };
  assert.equal(failureCooldownKey(pool[0], failure), modelCooldownKey(pool[0]));
  const now = Date.now();
  assert.equal(
    selectCandidate(pool, { [modelCooldownKey(pool[0])]: now + 300000 }, now)
      .candidate?.model,
    pool[1].model,
  );
  for (const status of [401, 402, 403, 429]) {
    const key = failureCooldownKey(pool[0], { ...failure, status });
    assert.equal(key, "nvidia");
    assert.equal(
      selectCandidate(pool, { [key]: now + 300000 }, now).candidate,
      undefined,
    );
  }
  const combined = {
    nvidia: now + 120000,
    [modelCooldownKey(pool[0])]: now + 300000,
  };
  assert.equal(selectCandidate(pool, combined, now).waitSeconds, 120);
  assert.equal(
    failureCooldownKey(pool[0], {
      ...failure,
      status: 429,
      rateLimitScope: "model",
    }),
    modelCooldownKey(pool[0]),
  );
});
