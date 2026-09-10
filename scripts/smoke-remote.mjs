import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const url =
  process.env.ATLAS_TEST_URL || "https://agent-session-atlas.vercel.app";
const report = { at: new Date().toISOString(), url, checks: [] };
let cookie = "";
async function call(path, body, expected = 200) {
  const r = await fetch(url + path, {
    method: body ? "POST" : "GET",
    headers: {
      origin: url,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (path === "/api/guest")
    cookie = r.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
  const text = await r.text();
  assert.equal(
    r.status,
    expected,
    `${path}: ${r.status} ${text.slice(0, 120)}`,
  );
  return JSON.parse(text);
}
try {
  await call("/api/auth/providers");
  report.checks.push("GitHub provider configured");
  await call("/api/guest", {});
  const me = await call("/api/me");
  assert.equal(me.user.guest, true);
  report.checks.push("guest isolated session");
  const sid = "synthetic-" + randomUUID(),
    generation = createHash("sha256").update(sid).digest("hex");
  const b = {
    schema_version: 1,
    batch_id: randomUUID(),
    source: "codex",
    session_id: sid,
    project: "/synthetic/atlas-verification",
    generation,
    start_offset: 0,
    end_offset: 500,
    events: [
      {
        id: "evt-user",
        timestamp: new Date().toISOString(),
        kind: "user",
        text: "Review synthetic code. Contact hello@example.com",
      },
      {
        id: "evt-1",
        timestamp: null,
        kind: "tool_call",
        name: "search",
        text: "same query",
      },
      {
        id: "evt-2",
        timestamp: null,
        kind: "tool_call",
        name: "search",
        text: "same query",
      },
      {
        id: "evt-3",
        timestamp: null,
        kind: "tool_call",
        name: "search",
        text: "same query",
      },
    ],
  };
  const ack = await call("/api/ingest", b);
  assert.equal(ack.batch_id, b.batch_id);
  assert.deepEqual(await call("/api/ingest", b), ack);
  report.checks.push("upload + duplicate ACK");
  const list = await call("/api/sessions");
  const session = list.sessions.find((x) => x.source_id === sid);
  assert.ok(session);
  report.checks.push("owned session listed");
  const key = randomUUID();
  const job = await call(
    "/api/analyses",
    { scope: "single", sessionIds: [session.id], requestKey: key },
    202,
  );
  report.checks.push("single-session workflow accepted");
  console.log(
    "Remote smoke: upload, duplicate ACK, ownership, workflow accepted. Waiting for result.",
  );
  for (let i = 0; i < 540; i++) {
    const d = await call("/api/sessions/" + session.id);
    const result = d.results[0];
    if (result?.status === "failed")
      throw new Error("Analysis failed: " + result.error);
    if (result?.status === "completed") {
      assert.ok(result.result.ai.summary);
      assert.ok(result.result.analysisVersion.startsWith("analysis-1:"));
      assert.equal(result.result.metrics.toolCalls, 3);
      assert.ok(!JSON.stringify(result.result).includes("hello@example.com"));
      report.checks.push("remote AI completion + metrics + masking");
      console.log("Remote AI analysis completed");
      break;
    }
    if (i === 539) throw new Error("Analysis completion timeout");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const detail = await call("/api/sessions/" + session.id);
  assert.equal(detail.results[0].status, "completed");
  // Reuse validates selection/all orchestration without additional AI calls.
  const selectedJob = await call(
    "/api/analyses",
    { scope: "selected", sessionIds: [session.id], requestKey: randomUUID() },
    202,
  );
  const allJob = await call(
    "/api/analyses",
    { scope: "all", requestKey: randomUUID() },
    202,
  );
  for (let n = 0; n < 20; n++) {
    const state = await call("/api/sessions");
    const selected = state.jobs.find((j) => j.id === selectedJob.jobId);
    const all = state.jobs.find((j) => j.id === allJob.jobId);
    if (selected?.status === "completed" && all?.status === "completed") break;
    if (n === 19) throw new Error("Result reuse completion timeout");
    await new Promise((r) => setTimeout(r, 1000));
  }
  report.checks.push(
    "selected and all-session workflows completed with result reuse",
  );
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.message;
  process.exitCode = 1;
  console.error(e.message);
} finally {
  writeFileSync(
    "ops/remote-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
