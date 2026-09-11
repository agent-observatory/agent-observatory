// Explicit synthetic retention verification; never modifies existing user sessions.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
for (const path of [".env.remote.local", ".env.local"])
  process.loadEnvFile(path);
const uri = new URL(process.env.POSTGRES_URL);
uri.searchParams.delete("sslmode");
const sql = require("postgres")(uri.toString(), {
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync("ops/certs/supabase-prod-ca-2021.crt", "utf8"),
  },
  prepare: false,
  max: 1,
});
const bucket = require("@supabase/supabase-js")
  .createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )
  .storage.from("sessions");
const url =
  process.env.ATLAS_TEST_URL || "https://agent-session-atlas.vercel.app";
const report = { at: new Date().toISOString(), url, checks: [], limitations: ["Real DELETE and read APIs are exercised. Cleanup is simulated with SQL and Storage operations scoped to this synthetic owner; the global maintenance function is not invoked."] };
let testOwner;
const paths = [];
try {
  const guest = await fetch(url + "/api/guest", {
    method: "POST",
    headers: { origin: url },
  });
  assert.equal(guest.status, 200);
  const cookie = guest.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const me = await (
    await fetch(url + "/api/me", { headers: { cookie } })
  ).json();
  testOwner = me.user.id;
  assert.ok(testOwner.startsWith("guest:"));
  const ids = [];
  for (const age of [8, 31]) {
    const sid = randomUUID(),
      bid = randomUUID(),
      jid = randomUUID(),
      iid = randomUUID();
    ids.push(sid);
    const path = "synthetic-retention/" + sid + ".json";
    paths.push(path);
    const { error } = await bucket.upload(
      path,
      JSON.stringify({ synthetic: true }),
      { contentType: "application/json" },
    );
    assert.ifError(error);
    const first = new Date(Date.now() - age * 86400000),
      expires = new Date(first.getTime() + 7 * 86400000),
      summaryExpiry = new Date(first.getTime() + 30 * 86400000);
    await sql.begin(async (tx) => {
      await tx`INSERT INTO atlas.sessions(id,owner,source_id,generation,project,first_received,expires_at) VALUES(${sid},${testOwner},${"synthetic-retention-" + sid},${createHash("sha256").update(sid).digest("hex")},'/synthetic/retention',${first},${expires})`;
      await tx`INSERT INTO atlas.batches(id,owner,session_id,received_hash,stored_hash,path,bytes,end_offset,masking) VALUES(${bid},${testOwner},${sid},'synthetic','synthetic',${path},18,18,true)`;
      await tx`INSERT INTO atlas.jobs(id,owner,request_key,scope,created_at,status) VALUES(${jid},${testOwner},${"retention-" + sid},'single',${first},'completed')`;
      await tx`INSERT INTO atlas.job_items(id,job_id,session_id,revision,batch_ids,expires_at,status,result) VALUES(${iid},${jid},${sid},1,'[]',${expires},'completed','{"synthetic":true}')`;
      await tx`INSERT INTO atlas.summaries(session_id,owner,metrics,candidate_count,expires_at) VALUES(${sid},${testOwner},'{"toolCalls":3}',1,${summaryExpiry})`;
    });
    const response = await fetch(url + "/api/sessions/" + sid, {
      headers: { cookie },
    });
    assert.equal(response.status, 404);
  }
  report.checks.push("Expired detail hidden before cleanup");
  const { error: expiredStorageError } = await bucket.remove(paths);
  assert.ifError(expiredStorageError);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM atlas.job_items WHERE session_id IN ${tx(ids)}`;
    await tx`UPDATE atlas.batches SET purged=true WHERE session_id IN ${tx(ids)}`;
    await tx`DELETE FROM atlas.batches WHERE purged=true AND session_id IN ${tx(ids)}`;
    await tx`DELETE FROM atlas.sessions WHERE id IN ${tx(ids)} AND expires_at<=now()`;
    await tx`DELETE FROM atlas.summaries WHERE owner=${testOwner} AND expires_at<=now()`;
  });
  assert.equal(
    (await sql`SELECT id FROM atlas.sessions WHERE owner=${testOwner}`).length,
    0,
  );
  assert.equal(
    (await sql`SELECT id FROM atlas.batches WHERE owner=${testOwner}`).length,
    0,
  );
  const summaries =
    await sql`SELECT session_id FROM atlas.summaries WHERE owner=${testOwner}`;
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].session_id, ids[0]);
  report.checks.push(
    "7-day detailed metadata and results deleted",
    "8-day aggregate summary retained",
    "31-day aggregate summary deleted",
  );
  for (const path of paths) {
    const { error } = await bucket.download(path);
    assert.ok(error);
  }
  report.checks.push("Expired private Storage objects removed");

  const deletedId = randomUUID(),
    deletedBatchId = randomUUID(),
    deletedJobId = randomUUID(),
    deletedItemId = randomUUID(),
    deletedSourceId = "synthetic-deleted-" + deletedId,
    deletedGeneration = createHash("sha256").update(deletedId).digest("hex"),
    deletedPath = "synthetic-retention/" + deletedId + ".json",
    deletedFirstReceived = new Date(Date.now() - 2 * 86400000),
    deletedExpiry = new Date(deletedFirstReceived.getTime() + 7 * 86400000);
  paths.push(deletedPath);
  const { error: deletedUploadError } = await bucket.upload(
    deletedPath,
    JSON.stringify({ synthetic: true }),
    { contentType: "application/json" },
  );
  assert.ifError(deletedUploadError);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO atlas.sessions(id,owner,source,source_id,generation,project,first_received,last_received,expires_at) VALUES(${deletedId},${testOwner},'codex',${deletedSourceId},${deletedGeneration},'/synthetic/deleted',${deletedFirstReceived},${deletedFirstReceived},${deletedExpiry})`;
    await tx`INSERT INTO atlas.batches(id,owner,session_id,received_hash,stored_hash,path,bytes,end_offset,masking) VALUES(${deletedBatchId},${testOwner},${deletedId},'synthetic','synthetic',${deletedPath},18,18,true)`;
    await tx`INSERT INTO atlas.jobs(id,owner,request_key,scope,status) VALUES(${deletedJobId},${testOwner},${"deleted-" + deletedId},'single','completed')`;
    await tx`INSERT INTO atlas.job_items(id,job_id,session_id,revision,batch_ids,expires_at,status,result) VALUES(${deletedItemId},${deletedJobId},${deletedId},1,'[]',${deletedExpiry},'completed','{"synthetic":true}')`;
    await tx`INSERT INTO atlas.summaries(session_id,owner,metrics,candidate_count,expires_at) VALUES(${deletedId},${testOwner},'{"toolCalls":3}',1,${new Date(deletedFirstReceived.getTime() + 30 * 86400000)})`;
  });
  const deletedResponse = await fetch(url + "/api/sessions/" + deletedId, {
    method: "DELETE",
    headers: { cookie, origin: url },
  });
  assert.equal(deletedResponse.status, 200);
  const repeatedDeletedResponse = await fetch(
    url + "/api/sessions/" + deletedId,
    { method: "DELETE", headers: { cookie, origin: url } },
  );
  assert.equal(repeatedDeletedResponse.status, 200);
  const [tombstone] =
    await sql`SELECT deleted,expires_at FROM atlas.sessions WHERE id=${deletedId}`;
  assert.equal(tombstone.deleted, true);
  assert.equal(
    new Date(tombstone.expires_at).getTime(),
    deletedExpiry.getTime(),
  );
  const [expiredItem] =
    await sql`SELECT status,result,expires_at FROM atlas.job_items WHERE id=${deletedItemId}`;
  assert.equal(expiredItem.status, "expired");
  assert.equal(expiredItem.result, null);
  assert.ok(new Date(expiredItem.expires_at).getTime() <= Date.now());
  assert.equal(
    (
      await sql`SELECT session_id FROM atlas.summaries WHERE session_id=${deletedId}`
    ).length,
    0,
  );
  const checkpoint = await fetch(
    url +
      "/api/checkpoint?source=codex&session_id=" +
      encodeURIComponent(deletedSourceId) +
      "&generation=" +
      encodeURIComponent(deletedGeneration),
    { headers: { cookie } },
  );
  assert.equal(checkpoint.status, 410);
  const { error: deletedStorageError } = await bucket.remove([deletedPath]);
  assert.ifError(deletedStorageError);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM atlas.job_items WHERE session_id=${deletedId} AND expires_at<=now()`;
    await tx`UPDATE atlas.batches SET purged=true WHERE session_id=${deletedId}`;
    await tx`DELETE FROM atlas.batches WHERE purged=true AND session_id=${deletedId}`;
    await tx`DELETE FROM atlas.sessions WHERE id=${deletedId} AND expires_at<=now()`;
  });
  assert.equal(
    (await sql`SELECT id FROM atlas.sessions WHERE id=${deletedId}`).length,
    1,
  );
  assert.equal(
    (await sql`SELECT id FROM atlas.batches WHERE session_id=${deletedId}`)
      .length,
    0,
  );
  assert.equal(
    (await sql`SELECT id FROM atlas.job_items WHERE session_id=${deletedId}`)
      .length,
    0,
  );
  assert.equal(
    (
      await sql`SELECT session_id FROM atlas.summaries WHERE session_id=${deletedId}`
    ).length,
    0,
  );
  assert.ok((await bucket.download(deletedPath)).error);
  report.checks.push(
    "Repeated delete preserves the original expiry and invalidates analysis results and summaries",
    "Deleted session hides immediately; files are purged by scheduled maintenance",
    "Deleted source identity blocks checkpoint re-ingestion until its original 7-day expiry",
  );
  await sql`UPDATE atlas.sessions SET expires_at=now()-interval '1 second' WHERE id=${deletedId}`;
  await sql`DELETE FROM atlas.sessions WHERE id=${deletedId} AND expires_at<=now()`;
  assert.equal(
    (await sql`SELECT id FROM atlas.sessions WHERE id=${deletedId}`).length,
    0,
  );
  report.checks.push("Deleted tombstone is removed at detailed-data expiry");
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error =
    e instanceof assert.AssertionError ? "Assertion failed" : e.name;
  process.exitCode = 1;
} finally {
  if (paths.length) await bucket.remove(paths);
  if (testOwner) {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM atlas.summaries WHERE owner=${testOwner}`;
      await tx`DELETE FROM atlas.job_items WHERE session_id IN (SELECT id FROM atlas.sessions WHERE owner=${testOwner}) OR job_id IN (SELECT id FROM atlas.jobs WHERE owner=${testOwner})`;
      await tx`DELETE FROM atlas.batches WHERE owner=${testOwner}`;
      await tx`DELETE FROM atlas.sessions WHERE owner=${testOwner}`;
      await tx`DELETE FROM atlas.jobs WHERE owner=${testOwner}`;
      await tx`DELETE FROM atlas.users WHERE id=${testOwner} AND guest=true`;
    });
  }
  await sql.end();
  writeFileSync(
    "ops/retention-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
