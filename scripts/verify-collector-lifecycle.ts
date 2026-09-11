import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const url =
  process.env.ATLAS_VERIFY_URL || "https://agent-session-atlas.vercel.app";
const reportPath = "ops/collector-lifecycle-verification.json";
const checks: string[] = [];
const limitations = [
  "All rows are synthetic and are deleted in finally.",
  "The stale-offset case updates a synthetic session directly in SQL to model a later accepted batch. It does not verify the ingest endpoint or Storage write.",
  "Run only after the target has deployed the receipt, source-identity, and heartbeat migration/routes.",
];

function writeReport(report: Record<string, unknown>) {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
}

async function main() {
  for (const path of [".env.remote.local", ".env.local"])
    try {
      process.loadEnvFile(path);
    } catch {}

  assert.ok(process.env.POSTGRES_URL, "POSTGRES_URL is required");
  assert.ok(process.env.AUTH_SECRET, "AUTH_SECRET is required");

  const require = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  );
  const { encode } = await import(require.resolve("next-auth/jwt"));
  const databaseUrl = new URL(process.env.POSTGRES_URL);
  databaseUrl.searchParams.delete("sslmode");
  const sql = require("postgres")(databaseUrl.toString(), {
    prepare: false,
    max: 1,
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync("ops/certs/supabase-prod-ca-2021.crt", "utf8"),
    },
  });

  const owner = `synthetic-lifecycle:${randomUUID()}`;
  const foreignOwner = `synthetic-lifecycle:${randomUUID()}`;
  const deviceId = randomUUID();
  const revokedDeviceId = randomUUID();
  const deviceToken = randomBytes(32).toString("base64url");
  const revokedToken = randomBytes(32).toString("base64url");
  const sourceId = `synthetic-lifecycle:${randomUUID()}`;
  const generation = createHash("sha256").update(sourceId).digest("hex");
  const foreignSourceId = `synthetic-lifecycle:${randomUUID()}`;
  const foreignGeneration = createHash("sha256")
    .update(foreignSourceId)
    .digest("hex");
  const codexSessionId = randomUUID();
  const claudeSessionId = randomUUID();
  const expiredSessionId = randomUUID();
  const foreignSessionId = randomUUID();
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const cookieName =
    process.env.ATLAS_VERIFY_COOKIE_NAME ||
    (url.startsWith("https://")
      ? "__Secure-authjs.session-token"
      : "authjs.session-token");
  const browserToken = await encode({
    token: { sub: owner, name: "Synthetic collector lifecycle" },
    secret: process.env.AUTH_SECRET!,
    salt: cookieName,
    maxAge: 600,
  });

  async function call(
    name: string,
    path: string,
    options: {
      body?: unknown;
      bearer?: string;
      browser?: boolean;
      expected?: number;
    } = {},
  ) {
    const response = await fetch(url + path, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        ...(options.bearer
          ? { authorization: `Bearer ${options.bearer}` }
          : {}),
        ...(options.browser ? { cookie: `${cookieName}=${browserToken}` } : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    assert.equal(
      response.status,
      options.expected ?? 200,
      `${name}: ${response.status}`,
    );
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : null;
  }

  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    url,
    status: "running",
    checks,
    limitations,
  };

  try {
    await sql.begin(async (tx: any) => {
      await tx`INSERT INTO atlas.users(id,name) VALUES(${owner},'Synthetic collector lifecycle'),(${foreignOwner},'Synthetic collector lifecycle foreign')`;
      await tx`INSERT INTO atlas.devices(id,owner,token_hash) VALUES(${deviceId},${owner},${hash(deviceToken)}),(${revokedDeviceId},${owner},${hash(revokedToken)})`;
      await tx`UPDATE atlas.devices SET revoked=true WHERE id=${revokedDeviceId}`;
      await tx`INSERT INTO atlas.sessions(id,owner,source,source_id,generation,project,offset_bytes,expires_at) VALUES(${codexSessionId},${owner},'codex',${sourceId},${generation},'/synthetic/lifecycle',100,now()+interval '10 minutes'),(${claudeSessionId},${owner},'claude-code',${sourceId},${generation},'/synthetic/lifecycle',200,now()+interval '10 minutes'),(${expiredSessionId},${owner},'codex',${`expired:${sourceId}`},${generation},'/synthetic/lifecycle',20,now()-interval '1 minute'),(${foreignSessionId},${foreignOwner},'codex',${foreignSourceId},${foreignGeneration},'/synthetic/lifecycle',50,now()+interval '10 minutes')`;
    });

    const checkpoint = async (
      source: "codex" | "claude-code",
      sessionId = sourceId,
      sessionGeneration = generation,
      expected = 200,
    ) =>
      call(
        `checkpoint ${source}`,
        `/api/checkpoint?source=${encodeURIComponent(source)}&session_id=${encodeURIComponent(sessionId)}&generation=${encodeURIComponent(sessionGeneration)}`,
        { bearer: deviceToken, expected },
      );

    assert.equal((await checkpoint("codex")).offset, 100);
    assert.equal((await checkpoint("claude-code")).offset, 200);
    const sourceRows =
      await sql`SELECT source,offset_bytes FROM atlas.sessions WHERE owner=${owner} AND source_id=${sourceId} AND generation=${generation} ORDER BY source`;
    assert.deepEqual(
      sourceRows.map((row: any) => [row.source, Number(row.offset_bytes)]),
      [
        ["claude-code", 200],
        ["codex", 100],
      ],
    );
    checks.push(
      "same source_id and generation remain separate by source with scoped checkpoints",
    );

    const completion = {
      source: "codex",
      session_id: sourceId,
      generation,
      snapshot_end_offset: 100,
    };
    const completed = await call(
      "complete exact offset",
      "/api/checkpoints/complete",
      {
        bearer: deviceToken,
        body: completion,
      },
    );
    assert.equal(completed.ok, true);
    assert.equal(completed.snapshot_end_offset, 100);
    assert.equal(typeof completed.completed_at, "string");
    const repeated = await call(
      "repeat completion",
      "/api/checkpoints/complete",
      {
        bearer: deviceToken,
        body: completion,
      },
    );
    assert.equal(repeated.completed_at, completed.completed_at);
    checks.push(
      "exact checkpoint completion returns a stable timestamp on repeat",
    );

    await sql`UPDATE atlas.sessions SET offset_bytes=101,revision=revision+1,last_received=now(),ingestion_complete_at=null,completed_snapshot_offset=null WHERE id=${codexSessionId}`;
    await call("stale completion", "/api/checkpoints/complete", {
      bearer: deviceToken,
      body: completion,
      expected: 409,
    });
    checks.push(
      "simulated later batch rejects stale completion offset with 409",
    );

    await call("foreign completion", "/api/checkpoints/complete", {
      bearer: deviceToken,
      body: {
        source: "codex",
        session_id: foreignSourceId,
        generation: foreignGeneration,
        snapshot_end_offset: 50,
      },
      expected: 404,
    });
    assert.equal(
      (await checkpoint("codex", foreignSourceId, foreignGeneration)).offset,
      0,
    );
    checks.push(
      "foreign completion is not found and foreign checkpoint reveals no offset",
    );

    await checkpoint("codex", `expired:${sourceId}`, generation, 410);
    await call("expired completion", "/api/checkpoints/complete", {
      bearer: deviceToken,
      body: {
        source: "codex",
        session_id: `expired:${sourceId}`,
        generation,
        snapshot_end_offset: 20,
      },
      expected: 410,
    });
    await call("invalid completion body", "/api/checkpoints/complete", {
      bearer: deviceToken,
      body: { source: "codex" },
      expected: 422,
    });
    checks.push("expired receipt is 410 and invalid completion body is 422");

    assert.deepEqual(
      await call("valid heartbeat", "/api/devices/heartbeat", {
        bearer: deviceToken,
        body: {
          version: "0.0.0-synthetic",
          sourceTypes: ["codex", "claude-code"],
          paused: false,
          status: "success",
        },
      }),
      { ok: true },
    );
    const [device] =
      await sql`SELECT last_seen_at,collector_version,source_types,paused,sync_status,last_sync_at,last_error_code FROM atlas.devices WHERE id=${deviceId}`;
    assert.ok(device.last_seen_at);
    assert.equal(device.collector_version, "0.0.0-synthetic");
    assert.deepEqual(device.source_types, ["codex", "claude-code"]);
    assert.equal(device.paused, false);
    assert.equal(device.sync_status, "success");
    assert.ok(device.last_sync_at);
    assert.equal(device.last_error_code, null);
    await call("revoked heartbeat", "/api/devices/heartbeat", {
      bearer: revokedToken,
      body: {
        version: "0.0.0",
        sourceTypes: ["codex"],
        paused: false,
        status: "success",
      },
      expected: 401,
    });
    await call("unauthenticated heartbeat", "/api/devices/heartbeat", {
      body: {
        version: "0.0.0",
        sourceTypes: ["codex"],
        paused: false,
        status: "success",
      },
      expected: 401,
    });
    checks.push(
      "valid device heartbeat records status; revoked and absent bearer tokens are 401",
    );

    const devices = await call("browser device list", "/api/devices", {
      browser: true,
    });
    assert.ok(Array.isArray(devices.devices));
    assert.equal(JSON.stringify(devices).includes("token_hash"), false);
    assert.equal(
      devices.devices.some((item: { id: string }) => item.id === deviceId),
      true,
    );
    checks.push("owner device list omits token_hash");

    for (const route of ["/sessions", "/analyses", "/settings"]) {
      const response = await fetch(url + route, {
        headers: { cookie: `${cookieName}=${browserToken}` },
      });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(
        html.includes("Synthetic collector lifecycle"),
        "SSR initial account missing",
      );
      assert.ok(html.includes("로그아웃"), "SSR logout control missing");
      assert.ok(
        !html.includes("GitHub로 시작하기"),
        "SSR flashes anonymous CTA",
      );
    }
    checks.push(
      "authenticated server HTML on all three routes contains account/logout and no anonymous CTA",
    );
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error =
      error instanceof Error ? error.message : "Verification failed";
    throw error;
  } finally {
    try {
      await sql.begin(async (tx: any) => {
        await tx`DELETE FROM atlas.users WHERE id IN (${owner},${foreignOwner})`;
      });
    } catch (cleanupError) {
      report.cleanupError =
        cleanupError instanceof Error
          ? cleanupError.message
          : "Synthetic row cleanup failed";
      if (report.status === "passed") report.status = "failed";
    } finally {
      await sql.end();
      writeReport(report);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
