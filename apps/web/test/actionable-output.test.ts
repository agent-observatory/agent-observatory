import test from "node:test";
import assert from "node:assert/strict";
import {
  parseExplanation,
  attemptCompletion,
  candidates,
} from "../lib/ai-routing";
const suggestion = {
  title: "반복 호출 확인",
  problem: "같은 명령이 반복 관측됨",
  action: "변경 사이 호출인지 확인",
  verification: "변경 후 필요한 검증은 유지",
  text: "반복 필요성 확인",
  ruleId: "repeated-tool-call",
  ruleVersion: 1,
  evidenceIds: ["known"],
};
test("actionable output requires problem/action/verification and real evidence", () => {
  const accepted = parseExplanation(
    JSON.stringify({ summary: "검토 후보", suggestions: [suggestion] }),
    new Set(["known"]),
    true,
  );
  assert.equal(accepted.suggestions[0].action, suggestion.action);
  assert.throws(() =>
    parseExplanation(
      JSON.stringify({
        summary: "검토 후보",
        suggestions: [{ text: "do it", evidenceIds: ["known"] }],
      }),
      new Set(["known"]),
      true,
    ),
  );
  assert.throws(() =>
    parseExplanation(
      JSON.stringify({
        summary: "검토 후보",
        suggestions: [{ ...suggestion, evidenceIds: [] }],
      }),
      new Set(["known"]),
      true,
    ),
  );
  assert.throws(() =>
    parseExplanation(
      JSON.stringify({
        summary: "검토 후보",
        suggestions: [{ ...suggestion, evidenceIds: ["invented"] }],
      }),
      new Set(["known"]),
      true,
    ),
  );
});
test("invalid provider output records diagnostic code without content", async () => {
  const candidate = candidates({
    provider: "custom",
    model: "test-model",
    endpoint: "https://example.test/v1",
  })[0];
  const result = await attemptCompletion(
    candidate,
    "synthetic-key",
    false,
    {},
    new Set(["known"]),
    0,
    async () => ({
      status: 200,
      data: {
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"sensitive-output"' },
          },
        ],
      },
      retryAfter: null,
      errorCode: null,
      rateLimitScope: undefined,
    }),
    true,
  );
  assert.equal(result.ok, false);
  assert.equal(result.attempt.validationError, "truncated_output");
  assert.ok(!JSON.stringify(result).includes("sensitive-output"));
});
test("rule citations require a candidate-specific anchor, not merely a global sampled event", () => {
  const payload = JSON.stringify({
    summary: "검토",
    suggestions: [suggestion],
  });
  assert.throws(() =>
    parseExplanation(payload, new Set(["known", "unrelated"]), true, {}),
  );
  assert.throws(() =>
    parseExplanation(payload, new Set(["known", "unrelated"]), true, {
      "repeated-tool-call@1": new Set(["unrelated"]),
    }),
  );
  assert.doesNotThrow(() =>
    parseExplanation(payload, new Set(["known"]), true, {
      "repeated-tool-call@1": new Set(["known"]),
    }),
  );
});
