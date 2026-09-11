import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import {
  compressBatch,
  canonicalBatch,
  decompressBatch,
} from "../packages/contracts/src/transport";
const url =
  process.env.ATLAS_TEST_URL || "https://agent-session-atlas.vercel.app";
const checks: string[] = [];
let cookie = "",
  sid = "";
async function call(
  route: string,
  body?: BodyInit,
  extra: Record<string, string> = {},
  expected = 200,
  method?: string,
) {
  const r = await fetch(url + route, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { origin: process.env.ATLAS_TEST_ORIGIN || url, cookie, ...extra },
    body,
  });
  assert.equal(r.status, expected, route + " HTTP " + r.status);
  return r;
}
async function main() {
  try {
    const g = await call("/api/guest", "{}", {
      "content-type": "application/json",
    });
    cookie = g.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const id = "synthetic-compression-" + randomUUID();
    const batch = {
      schema_version: 2,
      subject_model: { harness: "codex", model: "synthetic-model" },
      batch_id: randomUUID(),
      source: "codex",
      session_id: id,
      project: "/synthetic/compression",
      generation: createHash("sha256").update(id).digest("hex"),
      start_offset: 0,
      end_offset: 1234,
      events: [
        {
          id: "large-event",
          timestamp: null,
          kind: "user",
          text: "Review the constraint. Email qa@example.com. token=synthetic-token.\n".repeat(
            20000,
          ),
        },
      ],
    };
    batch.events.push({
      id: "image-event",
      timestamp: null,
      kind: "tool_result",
      text:
        "data:image/png;base64," +
        Buffer.from("synthetic-image-body").toString("base64"),
    });
    const raw = canonicalBatch(batch);
    assert.ok(raw.bytes.length > 1048576);
    const packed = compressBatch(batch);
    const headers = {
      "content-type": "application/octet-stream",
      "x-atlas-content-encoding": "zstd",
      "x-content-sha256": createHash("sha256").update(raw.json).digest("hex"),
    };
    const ack = await (await call("/api/ingest", packed, headers)).json();
    assert.equal(ack.received_sha256, headers["x-content-sha256"]);
    assert.deepEqual(
      await (await call("/api/ingest", packed, headers)).json(),
      ack,
    );
    checks.push(
      "large logical event / zstd / canonical hash ACK / duplicate idempotency",
    );
    const list = await (
      await call(`/api/sessions?page=1&pageSize=10&q=${encodeURIComponent(id)}`)
    ).json();
    assert.deepEqual(list.pagination, {
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    assert.ok(list.overview.sessions >= 1);
    assert.ok(Array.isArray(list.projects));
    sid = list.sessions.find((s: any) => s.source_id === id)?.id;
    assert.ok(sid);
    const overshoot = await (
      await call(
        `/api/sessions?page=999999&pageSize=10&q=${encodeURIComponent(id)}`,
      )
    ).json();
    assert.equal(overshoot.sessions.length, 1);
    assert.equal(overshoot.pagination.page, 1);
    const detail = await (await call("/api/sessions/" + sid)).json();
    assert.equal(detail.aggregate.batches, 1);
    assert.equal(detail.aggregate.collectedEvents, null);
    assert.equal(detail.aggregate.userMessages, null);
    assert.equal(detail.aggregate.toolResults, null);
    assert.equal(detail.aggregate.imageOccurrences, null);
    assert.equal(detail.aggregate.available.analysisMetrics, false);
    assert.ok(detail.aggregate.storedBytes > 0);
    checks.push(
      "owned pagination / literal search / overview / detail aggregate",
    );
    assert.equal(detail.session.ingestion_complete_at, null);
    const complete = {
      source: batch.source,
      session_id: batch.session_id,
      generation: batch.generation,
      snapshot_end_offset: batch.end_offset,
    };
    const receipt = await (
      await call("/api/checkpoints/complete", JSON.stringify(complete), {
        "content-type": "application/json",
      })
    ).json();
    assert.ok(receipt.completed_at);
    const nextBatch = {
      ...batch,
      batch_id: randomUUID(),
      start_offset: batch.end_offset,
      end_offset: batch.end_offset + 100,
      events: [
        {
          id: "later",
          timestamp: null,
          kind: "user",
          text: "synthetic later event",
        },
      ],
    };
    await call("/api/ingest", compressBatch(nextBatch), {
      "content-type": "application/octet-stream",
      "x-atlas-content-encoding": "zstd",
    });
    const after = await (await call("/api/sessions/" + sid)).json();
    assert.equal(after.session.ingestion_complete_at, null);
    assert.equal(after.session.first_received, detail.session.first_received);
    assert.ok(
      new Date(after.session.last_received).getTime() >=
        new Date(detail.session.last_received).getTime(),
    );
    await call(
      "/api/checkpoints/complete",
      JSON.stringify(complete),
      { "content-type": "application/json" },
      409,
    );
    const latestReceipt = await (
      await call(
        "/api/checkpoints/complete",
        JSON.stringify({
          ...complete,
          snapshot_end_offset: nextBatch.end_offset,
        }),
        { "content-type": "application/json" },
      )
    ).json();
    await call("/api/ingest", packed, headers);
    const duplicate = await (await call("/api/sessions/" + sid)).json();
    assert.equal(
      duplicate.session.ingestion_complete_at,
      latestReceipt.completed_at,
    );
    checks.push(
      "v2 actual ingest clears snapshot completion; stale completion rejected; duplicate ACK preserves completion and first receipt",
    );

    for (const name of [".env.remote.local", ".env.local"])
      try {
        process.loadEnvFile(name);
      } catch {}
    const require = createRequire(
      new URL("../apps/web/package.json", import.meta.url),
    );
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
    try {
      const [stored] =
        await sql`SELECT path,stored_hash,masking,bytes FROM atlas.batches WHERE id=${batch.batch_id}`;
      assert.ok(stored.masking);
      const client = require("@supabase/supabase-js").createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await client.storage
        .from("sessions")
        .download(stored.path);
      assert.ok(data && !error);
      const packedStored = Buffer.from(await data.arrayBuffer());
      const decoded = decompressBatch(packedStored);
      assert.equal(packedStored.length, Number(stored.bytes));
      assert.equal(
        createHash("sha256").update(decoded.json).digest("hex"),
        stored.stored_hash,
      );
      assert.ok(!decoded.json.includes("qa@example.com"));
      assert.ok(!decoded.json.includes("data:image/png;base64,"));
      assert.equal(decoded.batch.events[1].images?.[0].status, "local_only");
      checks.push(
        "server image stripping / text masking / stored zstd hash verified",
      );
    } finally {
      await sql.end();
    }
    await call("/api/ingest", Buffer.from("broken"), headers, 400);
    checks.push("corrupt zstd rejected");
    await call(
      "/api/ingest",
      zstdCompressSync(Buffer.alloc(8 * 1024 * 1024 + 1)),
      headers,
      413,
    );
    checks.push("decompression limit enforced");
    await call(
      "/api/ingest",
      Buffer.alloc(1048577),
      { "content-type": "application/json" },
      413,
    );
    checks.push("uncompressed wire limit enforced");
    await call(
      "/api/ingest",
      packed,
      { ...headers, "x-atlas-content-encoding": "unsupported" },
      415,
    );
    checks.push("unknown encoding rejected");
    await call(
      "/api/ingest",
      packed,
      { ...headers, "x-content-sha256": "0".repeat(64) },
      400,
    );
    checks.push("hash mismatch rejected");
    writeFileSync(
      "ops/compressed-ingest-verification.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          url,
          checks,
          status: "passed",
          decodedBytes: raw.bytes.length,
          wireBytes: packed.length,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        status: "passed",
        checks: checks.length,
        decodedBytes: raw.bytes.length,
        wireBytes: packed.length,
      }),
    );
  } finally {
    if (sid) await call("/api/sessions/" + sid, undefined, {}, 200, "DELETE");
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
