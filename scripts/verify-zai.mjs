// Manual connectivity check. Sends only these synthetic fixtures, never local sessions.
import { writeFile } from "node:fs/promises";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const key = process.env.ZAI_API_KEY?.trim();
if (!key) throw new Error("ZAI_API_KEY is missing");

const model = "glm-4.7-flash";
const fixtures = [
  {
    id: "repeat",
    events: [
      "e1: same search, same revision, same result",
      "e2: same search, same revision, same result",
      "e3: same search, same revision, same result",
    ],
    expected: true,
  },
  {
    id: "changed",
    events: ["e1: test fails", "e2: code is edited", "e3: test passes"],
    expected: false,
  },
  { id: "missing", events: [], expected: false },
];
const pair = process.argv.includes("--pair");
const single =
  process.argv.includes("--single") ||
  (!pair && !process.argv.includes("--triple"));
const selected = fixtures.slice(0, single ? 1 : pair ? 2 : 3);
const started = Date.now();
console.log(
  `Key present. Sending ${selected.length} synthetic requests to glm-4.7-flash.`,
);
const results = await Promise.all(
  selected.map(async (fixture) => {
    const startMs = Date.now() - started;
    try {
      const response = await fetch(
        "https://api.z.ai/api/paas/v4/chat/completions",
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({
            model,
            thinking: { type: "enabled" },
            max_tokens: 4096,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'Analyze synthetic coding-session evidence. Return JSON only: {"caseId":string,"candidate":boolean,"evidenceIds":string[],"explanation":string}. Explain in Korean. Flag a possible redundant operation only when evidence supports it; rerunning tests after edits is justified. Missing data is insufficient evidence. Do not invent evidence IDs. A candidate is not proof of waste.',
              },
              {
                role: "user",
                content: JSON.stringify({
                  caseId: fixture.id,
                  events: fixture.events,
                }),
              },
            ],
          }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        return {
          caseId: fixture.id,
          http: response.status,
          errorCode: body.error?.code ?? null,
          startMs,
          endMs: Date.now() - started,
          retryAfter: response.headers.get("retry-after"),
        };
      const choice = body.choices?.[0];
      let parsed;
      try {
        parsed = JSON.parse(choice?.message?.content ?? "");
      } catch {
        /* Report malformed output without raw provider content. */
      }
      const allowedIds = fixture.events.map((event) => event.split(":")[0]);
      const evidenceValid =
        Array.isArray(parsed?.evidenceIds) &&
        parsed.evidenceIds.every((id) => allowedIds.includes(id)) &&
        (!parsed.candidate || parsed.evidenceIds.length > 0);
      const passed =
        body.model === model &&
        choice?.finish_reason === "stop" &&
        parsed?.caseId === fixture.id &&
        parsed?.candidate === fixture.expected &&
        evidenceValid &&
        typeof parsed?.explanation === "string" &&
        /[가-힣]/.test(parsed.explanation);
      return {
        caseId: fixture.id,
        http: response.status,
        model: body.model,
        startMs,
        endMs: Date.now() - started,
        finishReason: choice?.finish_reason,
        usage: body.usage,
        passed,
        result: parsed,
      };
    } catch (error) {
      return {
        caseId: fixture.id,
        startMs,
        endMs: Date.now() - started,
        errorType: error.name,
      };
    }
  }),
);
const report = {
  checkedAt: new Date().toISOString(),
  model,
  syntheticOnly: true,
  concurrency: selected.length,
  concurrentClientRequests:
    selected.length > 1 &&
    Math.max(...results.map((r) => r.startMs)) <
      Math.min(...results.map((r) => r.endMs)),
  results,
};
await writeFile(
  new URL(
    single
      ? "../ops/zai-verification-single.json"
      : pair
        ? "../ops/zai-verification-pair.json"
        : "../ops/zai-verification.json",
    import.meta.url,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (!results.every((r) => r.passed)) process.exitCode = 1;
