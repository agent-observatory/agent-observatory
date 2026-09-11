// Aggregate-only verification. Local source/owner/batch identifiers remain in the private plan.
import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { maskBatch, Batch, analyze } from "../packages/contracts/src/index";
import {
  canonicalBatch,
  compressBatch,
  decompressBatch,
} from "../packages/contracts/src/transport";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function main() {
  const [mode, root] = process.argv.slice(2);
  if (
    !["preflight", "storage", "results"].includes(mode) ||
    !root?.startsWith(
      path.join(os.homedir(), ".agent-session-atlas") + path.sep,
    )
  )
    throw new Error("Private pilot path required");
  const plan = JSON.parse(
    await fs.readFile(path.join(root, "plan.json"), "utf8"),
  );
  for (const name of [".env.remote.local", ".env.local"])
    try {
      process.loadEnvFile(name);
    } catch {}
  const require = createRequire(
    new URL("../apps/web/package.json", import.meta.url),
  );
  const u = new URL(process.env.POSTGRES_URL!);
  u.searchParams.delete("sslmode");
  const sql = require("postgres")(u.toString(), {
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync("ops/certs/supabase-prod-ca-2021.crt", "utf8"),
    },
    prepare: false,
    max: 1,
  });
  try {
    const cfg = JSON.parse(
      await fs.readFile(
        path.join(os.homedir(), ".agent-session-atlas/config.json"),
        "utf8",
      ),
    );
    const [account] =
      await sql`SELECT d.owner,u.guest,u.settings FROM atlas.devices d JOIN atlas.users u ON u.id=d.owner WHERE d.id=${cfg.deviceId} AND d.revoked=false`;
    assert.ok(account && !account.guest && account.settings.masking !== false);
    if (mode === "preflight") {
      const secrets = Object.entries(process.env)
        .filter(
          ([k, v]) =>
            /(?:API_KEY|SECRET|ENCRYPTION_KEY)$/.test(k) && v && v.length >= 16,
        )
        .map(([, v]) => v!);
      let maskedChanges = 0,
        storedBytes = 0,
        maxWire = 0,
        imageOccurrences = 0;
      const imageHashes = new Set<string>();
      for (const item of plan.selected) {
        item.expected = [];
        let events: any[] = [];
        for (const f of await fs.readdir(
          path.join(item.work, "outbox/ready"),
        )) {
          const m = JSON.parse(
            await fs.readFile(path.join(item.work, "outbox/ready", f), "utf8"),
          );
          const b = Batch.parse(m.payload);
          const original = canonicalBatch(b).json;
          assert.ok(
            !/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+\/_=-]{32,}/i.test(
              original,
            ),
            "Image payload remains in prepared data",
          );
          for (const event of b.events)
            for (const image of event.images || []) {
              imageOccurrences++;
              imageHashes.add(image.sha256);
              assert.equal(image.status, "local_only");
            }
          const masked = canonicalBatch(maskBatch(b)).json;
          assert.ok(
            !secrets.some((v) => masked.includes(v)),
            "Known environment secret remains after masking",
          );
          const packed = compressBatch(maskBatch(b));
          storedBytes += packed.length;
          maxWire = Math.max(maxWire, compressBatch(b).length);
          if (original !== masked) maskedChanges++;
          item.expected.push({
            id: b.batch_id,
            receivedHash: hash(original),
            storedHash: hash(masked),
            storedBytes: packed.length,
            endOffset: b.end_offset,
          });
          events.push(...b.events);
        }
        item.metrics = analyze(events).metrics;
      }
      plan.preflight = {
        at: new Date().toISOString(),
        maskedChanges,
        expectedStoredBytes: storedBytes,
        maxWire,
        knownSecretCheck: "passed",
        imagePayloadCheck: "absent",
        imageOccurrences,
        uniqueImages: imageHashes.size,
      };
      await fs.writeFile(
        path.join(root, "plan.json"),
        JSON.stringify(plan, null, 2),
        { mode: 0o600 },
      );
      console.log(JSON.stringify(plan.preflight));
      return;
    }
    const client = require("@supabase/supabase-js").createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    let storedBytes = 0,
      decodedBytes = 0,
      batches = 0,
      masking = true,
      completed = 0,
      failed = 0,
      pending = 0;
    const results: any[] = [];
    const sessionIds: string[] = [];
    for (const item of plan.selected) {
      const [s] =
        await sql`SELECT id,offset_bytes,expires_at,first_received FROM atlas.sessions WHERE owner=${account.owner} AND source_id=${item.source.sessionId} AND generation=${item.source.generation} AND deleted=false`;
      assert.ok(s);
      assert.equal(Number(s.offset_bytes), item.source.size);
      sessionIds.push(s.id);
      assert.ok(
        new Date(s.expires_at).getTime() -
          new Date(s.first_received).getTime() <=
          7 * 86400000 + 1000,
      );
      if (mode === "storage")
        for (const expected of item.expected) {
          const [b] =
            await sql`SELECT * FROM atlas.batches WHERE id=${expected.id} AND owner=${account.owner}`;
          assert.ok(b && b.masking);
          assert.equal(b.received_hash, expected.receivedHash);
          assert.equal(b.stored_hash, expected.storedHash);
          assert.equal(Number(b.bytes), expected.storedBytes);
          const { data, error } = await client.storage
            .from("sessions")
            .download(b.path);
          assert.ok(data && !error);
          const bytes = Buffer.from(await data.arrayBuffer());
          assert.equal(bytes.length, expected.storedBytes);
          const decoded = decompressBatch(bytes);
          assert.equal(hash(decoded.json), expected.storedHash);
          assert.ok(
            !/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+\/_=-]{32,}/i.test(
              decoded.json,
            ),
            "Image payload remains in stored data",
          );
          storedBytes += bytes.length;
          decodedBytes += decoded.bytes.length;
          batches++;
        }
      if (mode === "results") {
        const [r] =
          await sql`SELECT status,result,error FROM atlas.job_items WHERE session_id=${s.id} AND revision=(SELECT revision FROM atlas.sessions WHERE id=${s.id}) ORDER BY (status='completed') DESC LIMIT 1`;
        if (r?.status === "completed") {
          completed++;
          assert.deepEqual(r.result.metrics, item.metrics);
          const timelineIds = new Set(r.result.timeline.map((e: any) => e.id));
          assert.ok(r.result.ai?.summary);
          assert.ok(
            r.result.ai.suggestions.every((x: any) =>
              x.evidenceIds.every((id: string) => timelineIds.has(id)),
            ),
          );
          results.push({
            events: r.result.metrics.events,
            provider: r.result.provider,
            model: r.result.model,
            tier: r.result.tier,
            selectedEvidence: r.result.aiInput.samples,
            images: r.result.imageInput,
            suggestions: r.result.ai.suggestions.length,
            attempts: r.result.aiAttempts?.length,
          });
        } else if (r?.status === "failed") failed++;
        else pending++;
      }
    }
    await fs.writeFile(
      path.join(root, "remote-session-ids.json"),
      JSON.stringify(sessionIds),
      { mode: 0o600 },
    );
    const report = {
      at: new Date().toISOString(),
      mode,
      sessions: plan.selected.length,
      batches,
      storedBytes,
      decodedBytes,
      masking,
      imagePayloads: "absent",
      imageOccurrences: plan.preflight.imageOccurrences,
      uniqueImages: plan.preflight.uniqueImages,
      completed,
      failed,
      pending,
      results,
    };
    console.log(JSON.stringify(report));
    if (mode === "storage" || completed === plan.selected.length)
      await fs.writeFile(
        "ops/personal-pilot-" + mode + ".json",
        JSON.stringify(report, null, 2) + "\n",
      );
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(
    "Pilot verification failed:",
    e instanceof Error ? e.message : "error",
  );
  process.exitCode = 1;
});
