import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
for (const p of [".env.remote.local", ".env.local"])
  try {
    process.loadEnvFile(p);
  } catch {}
const url =
  process.env.ATLAS_VERIFY_URL || "https://agent-session-atlas.vercel.app";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { encode } = await import(require.resolve("next-auth/jwt"));
const u = new URL(process.env.POSTGRES_URL);
u.searchParams.delete("sslmode");
const sql = require("postgres")(u.toString(), {
  prepare: false,
  max: 1,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync("ops/certs/supabase-prod-ca-2021.crt", "utf8"),
  },
});
const a = `synthetic-inspection:${randomUUID()}`,
  b = `synthetic-inspection:${randomUUID()}`,
  id = randomUUID(),
  other = randomUUID();
const token = randomBytes(32).toString("hex"),
  otherToken = randomBytes(32).toString("hex");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const checks = [];
const cookieName =
  process.env.ATLAS_VERIFY_COOKIE_NAME ||
  (url.startsWith("https:")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token");
async function cookie(user) {
  return `${cookieName}=${await encode({ token: { sub: user, name: "Synthetic inspection" }, secret: process.env.AUTH_SECRET, salt: cookieName, maxAge: 600 })}`;
}
const cookies = { a: await cookie(a), b: await cookie(b) };
async function call(
  path,
  { who = "a", bearer, body, method, expected = 200 } = {},
) {
  const r = await fetch(url + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      origin: process.env.APP_URL,
      ...(bearer
        ? { authorization: `Bearer ${bearer}` }
        : { cookie: cookies[who] }),
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(
    r.status,
    expected,
    `${path}: expected ${expected}, got ${r.status}`,
  );
  if (r.headers.get("content-type")?.includes("application/json"))
    return r.json();
}
const endpoint = `/api/devices/${id}/inspect`;
const snapshot = {
  observedAt: new Date().toISOString(),
  paused: true,
  sourceTypes: ["codex"],
  include: ["/synthetic/work"],
  exclude: [],
  projects: [{ project: "/synthetic/work", sessions: 2, bytes: 400 }],
  sessions: 2,
  bytes: 400,
  truncated: false,
  pendingBatches: 0,
  pendingBytes: 0,
};
try {
  await sql`INSERT INTO atlas.users(id,name) VALUES(${a},'Synthetic A'),(${b},'Synthetic B')`;
  await sql`INSERT INTO atlas.devices(id,owner,token_hash) VALUES(${id},${a},${hash(token)}),(${other},${b},${hash(otherToken)})`;
  await call(endpoint, { method: "POST", expected: 409 });
  checks.push("offline requires Collector start");
  await call("/api/devices/control", { bearer: token });
  await call(endpoint, { who: "b", method: "POST", expected: 404 });
  checks.push("foreign owner cannot inspect");
  const start = await call(endpoint, { method: "POST" });
  assert.equal(
    (await call(endpoint, { method: "POST" })).requestId,
    start.requestId,
  );
  checks.push("pending request coalesces");
  assert.equal(
    (await call("/api/devices/control", { bearer: token })).requestId,
    start.requestId,
  );
  assert.equal(
    (await call("/api/devices/control", { bearer: otherToken })).requestId,
    null,
  );
  checks.push("only target Collector receives request");
  await call("/api/devices/control", {
    bearer: otherToken,
    body: { requestId: start.requestId, status: "complete", snapshot },
    expected: 410,
  });
  await call("/api/devices/control", {
    bearer: token,
    body: {
      requestId: start.requestId,
      status: "complete",
      snapshot: { ...snapshot, apiKey: "synthetic-secret" },
    },
    expected: 422,
  });
  checks.push("cross-device reply and unexpected secret fields rejected");
  await call("/api/devices/control", {
    bearer: token,
    body: { requestId: start.requestId, status: "complete", snapshot },
  });
  assert.deepEqual(
    (await call(endpoint + `?requestId=${start.requestId}`)).snapshot,
    snapshot,
  );
  await call(endpoint + `?requestId=${start.requestId}`, {
    who: "b",
    expected: 404,
  });
  checks.push("owner receives current response only");
  await call("/api/devices/control", {
    bearer: token,
    body: { requestId: start.requestId, status: "complete", snapshot },
    expected: 410,
  });
  checks.push("reply replay rejected");
  await sql`UPDATE atlas.device_inspections SET expires_at=now()-interval '1 second' WHERE device_id=${id}`;
  assert.equal(
    (await call(endpoint + `?requestId=${start.requestId}`)).status,
    "expired",
  );
  await call("/api/devices/control", { bearer: token });
  assert.equal(
    (
      await sql`SELECT device_id FROM atlas.device_inspections WHERE device_id=${id}`
    ).length,
    0,
  );
  checks.push("expired response hidden and purged");
  const pending = await call(endpoint, { method: "POST" });
  await sql`UPDATE atlas.device_inspections SET expires_at=now()-interval '1 second' WHERE device_id=${id}`;
  await call("/api/devices/control", {
    bearer: token,
    body: { requestId: pending.requestId, status: "complete", snapshot },
    expected: 410,
  });
  checks.push("late reply rejected");
  await sql`UPDATE atlas.devices SET revoked=true WHERE id=${id}`;
  await call("/api/devices/control", { bearer: token, expected: 401 });
  await call(endpoint, { method: "POST", expected: 404 });
  checks.push("revoked device cannot inspect");
  const r =
    await sql`SELECT relrowsecurity FROM pg_class WHERE oid='atlas.device_inspections'::regclass`;
  assert.equal(r[0].relrowsecurity, true);
  checks.push("private request table uses RLS");
  writeFileSync(
    "ops/device-inspection-verification.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        url,
        status: "passed",
        syntheticOnly: true,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Passed ${checks.length} device inspection checks`);
} finally {
  await sql`DELETE FROM atlas.devices WHERE id IN (${id},${other})`;
  await sql`DELETE FROM atlas.users WHERE id IN (${a},${b})`;
  await sql`DELETE FROM atlas.rate_limits WHERE key LIKE ${"inspection:" + a + ":%"}`;
  await sql.end();
}
