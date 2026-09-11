import { writeFileSync } from "node:fs";
import { freeCandidates, attemptCompletion } from "../apps/web/lib/ai-routing";
async function main() {
  process.loadEnvFile(".env.local");
  const results = [];
  for (const candidate of freeCandidates()) {
    const started = Date.now();
    const result = await attemptCompletion(
      candidate,
      process.env[candidate.keyEnv!]!,
      true,
      {
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content:
              '합성 연결 검증입니다. event-1: 사용자가 테스트 추가를 요청했고 도구가 테스트 통과를 반환했습니다. 이 사실만 한국어로 설명하세요. JSON만 반환: {"summary":"설명","suggestions":[]}',
          },
        ],
      },
      new Set(["event-1"]),
      0,
    );
    const row = {
      provider: candidate.provider,
      requestedModel: candidate.model,
      ok: result.ok,
      status: result.attempt.status,
      outcome: result.attempt.outcome,
      seconds: (Date.now() - started) / 1000,
      ...(result.ok
        ? {
            tier: result.tier,
            model: result.model,
            endpoint: result.endpoint,
            summary: result.ai.summary,
          }
        : {}),
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  writeFileSync(
    "ops/free-provider-verification.json",
    JSON.stringify(
      { at: new Date().toISOString(), synthetic: true, results },
      null,
      2,
    ) + "\n",
  );
}
main().catch((e) => {
  console.error(e.name);
  process.exitCode = 1;
});
