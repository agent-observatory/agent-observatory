import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiPendingLabel,
  formatAiProvenance,
  normalizedProvider,
} from "../lib/ai-provenance";

test("legacy Z.ai settings normalize to free mode", () => {
  assert.equal(normalizedProvider("zai"), "free");
  assert.equal(
    formatAiProvenance({ provider: "zai", model: "glm-4" }, "ko"),
    "무료 티어 · Z.ai · glm-4",
  );
});

test("custom endpoints receive a useful provider label", () => {
  assert.equal(
    formatAiProvenance(
      {
        tier: "byok",
        provider: "custom",
        endpoint: "https://api.example.ai/v1",
        model: "model-a",
      },
      "en",
    ),
    "BYOK · api.example.ai · model-a",
  );
  assert.equal(
    formatAiProvenance(
      {
        tier: "byok",
        provider: "custom",
        endpoint: "https://integrate.api.nvidia.com/v1",
        model: "nemotron",
      },
      "en",
    ),
    "BYOK · NVIDIA · nemotron",
  );
  assert.equal(
    formatAiProvenance(
      {
        tier: "byok",
        provider: "custom",
        endpoint: "https://openrouter.evil.com/v1",
        model: "model-a",
      },
      "en",
    ),
    "BYOK · openrouter.evil.com · model-a",
  );
});

test("the gateway remains the principal provider when routing has an upstream", () => {
  assert.equal(
    formatAiProvenance(
      {
        tier: "free",
        provider: "openrouter",
        upstreamProvider: "Novita",
        model: "nex",
      },
      "ko",
    ),
    "무료 티어 · OpenRouter · nex",
  );
});

test("pending results do not claim a completed model", () => {
  assert.equal(aiPendingLabel("ko"), "AI 설명 대기 중");
  assert.equal(aiPendingLabel("en"), "Waiting for AI explanation");
});

test("an unknown legacy provider does not receive an inferred tier", () => {
  assert.equal(
    formatAiProvenance({ provider: "groq", model: "llama" }, "en"),
    "groq · llama",
  );
});
