import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

async function main() {
  process.loadEnvFile(".env.remote.local");
  process.loadEnvFile(".env.local");
  const require = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  );
  const { encode } = await import(require.resolve("next-auth/jwt"));
  const dbUrl = new URL(process.env.POSTGRES_URL!);
  dbUrl.searchParams.delete("sslmode");
  const sql = require("postgres")(dbUrl.toString(), {
    prepare: false,
    max: 1,
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync("ops/certs/supabase-prod-ca-2021.crt", "utf8"),
    },
  });
  const url =
    process.env.ATLAS_TEST_URL || "https://agent-session-atlas.vercel.app";
  const user = "synthetic-pagination:" + randomUUID(),
    other = "synthetic-pagination:" + randomUUID();
  const checks: string[] = [];
  const settings = {
    language: "ko",
    theme: "dark",
    timezone: "system",
    masking: true,
    provider: "free",
    endpoint: "",
    model: "auto",
  };
  const cookieName = "__Secure-authjs.session-token";
  const token = await encode({
    token: { sub: user, name: "Synthetic pagination" },
    secret: process.env.AUTH_SECRET!,
    salt: cookieName,
    maxAge: 600,
  });
  async function call(path: string, body?: unknown, expected = 200) {
    const response = await fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: `${cookieName}=${token}`,
        origin: url,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, expected, path);
    return expected === 200 ? response.json() : null;
  }
  try {
    await sql`INSERT INTO atlas.users(id,name,settings) VALUES(${user},'Synthetic pagination',${sql.json(settings)}),(${other},'Synthetic isolation',${sql.json(settings)})`;
    const ids = Array.from({ length: 27 }, () => randomUUID())
      .sort()
      .reverse();
    await sql.begin(async (tx: any) => {
      for (const [i, id] of ids.entries())
        await tx`INSERT INTO atlas.sessions(id,owner,source_id,generation,project,revision,first_received,expires_at) VALUES(${id},${user},${i === 0 ? "literal%_한글" : `synthetic-${i}`},${"a".repeat(64)},'/synthetic/pagination',1,'2026-09-11T00:00:00Z',now()+interval '10 minutes')`;
      await tx`INSERT INTO atlas.sessions(id,owner,source_id,generation,project,expires_at) VALUES(${randomUUID()},${other},'isolated',${"b".repeat(64)},'/synthetic/isolation',now()+interval '10 minutes')`;
    });
    const one = await call("/api/sessions?pageSize=10"),
      two = await call("/api/sessions?page=2&pageSize=10");
    assert.equal(one.pagination.total, 27);
    assert.deepEqual(
      one.sessions.map((s: any) => s.id),
      ids.slice(0, 10),
    );
    assert.deepEqual(
      two.sessions.map((s: any) => s.id),
      ids.slice(10, 20),
    );
    assert.equal(two.overview.sessions, 27);
    assert.equal(two.projects[0].sessions, 27);
    assert.equal((await call("/api/sessions?pageSize=50")).sessions.length, 27);
    assert.equal((await call("/api/sessions?pageSize=20")).sessions.length, 20);
    const last = await call("/api/sessions?page=999999&pageSize=10");
    assert.equal(last.pagination.page, 3);
    assert.equal(last.sessions.length, 7);
    const literal = await call(
      "/api/sessions?q=" + encodeURIComponent("%_한글"),
    );
    assert.equal(literal.pagination.total, 1);
    assert.equal(literal.overview.sessions, 27);
    const empty = await call("/api/sessions?q=definitely-absent");
    assert.equal(empty.pagination.total, 0);
    assert.equal(empty.pagination.totalPages, 1);
    checks.push(
      "27 owned sessions: stable pages, sizes, literal search, empty/overshoot, full overview, isolation",
    );
    const batch = randomUUID();
    await sql`INSERT INTO atlas.batches(id,owner,session_id,received_hash,stored_hash,path,bytes,end_offset,masking) VALUES(${batch},${user},${ids[0]},'synthetic','synthetic','synthetic/no-file-needed',123456,123456,true)`;
    const detail = await call("/api/sessions/" + ids[0]);
    assert.equal(detail.aggregate.storedBytes, 123456);
    assert.equal(detail.aggregate.userMessages, null);
    assert.equal(detail.aggregate.available.analysisMetrics, false);
    checks.push(
      "detail storage metrics use DB manifest without downloading files; unknown analysis metrics are null",
    );
    for (const timezone of ["Asia/Seoul", "America/Los_Angeles", "system"]) {
      await call("/api/settings", { ...settings, timezone });
      assert.equal((await call("/api/me")).user.settings.timezone, timezone);
    }
    await call(
      "/api/settings",
      { ...settings, timezone: "invalid/timezone" },
      400,
    );
    assert.equal((await call("/api/me")).user.settings.timezone, "system");
    checks.push(
      "authenticated timezone save/read for three zones; invalid zone rejected without overwriting settings",
    );
    const report = {
      checkedAt: new Date().toISOString(),
      url,
      status: "passed",
      checks,
      authentication:
        "short-lived synthetic Auth.js session; OAuth flow not repeated",
    };
    writeFileSync(
      "ops/session-browser-api-verification.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  } finally {
    await sql.begin(async (tx: any) => {
      await tx`DELETE FROM atlas.batches WHERE owner IN (${user},${other})`;
      await tx`DELETE FROM atlas.sessions WHERE owner IN (${user},${other})`;
      await tx`DELETE FROM atlas.users WHERE id IN (${user},${other})`;
    });
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
