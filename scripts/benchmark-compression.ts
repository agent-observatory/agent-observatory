// pnpm exec tsx scripts/benchmark-compression.ts [--synthetic]
// Requires a C compiler plus local liblz4/libzstd development files. No upload or AI calls.
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  initialize,
  State,
  collect,
  sources,
} from "../apps/collector/src/core";
import {
  Batch,
  maskBatch,
  analyze,
  type AtlasEvent,
} from "../packages/contracts/src/index";

async function main() {
  const started = Date.now();
  const synthetic = process.argv.includes("--synthetic");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-compression-"));
  await fs.chmod(temp, 0o700);
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    const prefix =
      process.env.CODEC_PREFIX ||
      (process.platform === "darwin" ? "/opt/homebrew" : "/usr");
    const binary = path.join(temp, "codecs");
    const args = [
      "-O2",
      fileURLToPath(new URL("./benchmarks/codecs.c", import.meta.url)),
      "-o",
      binary,
      "-lz",
      "-lzstd",
      "-llz4",
    ];
    for (const lib of ["lz4", "zstd"])
      args.push(
        "-I" + path.join(prefix, "opt", lib, "include"),
        "-L" + path.join(prefix, "opt", lib, "lib"),
      );
    execFileSync("cc", args, { stdio: ["ignore", "ignore", "pipe"] });
    worker = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "",
      error = "";
    worker.stdout!.on("data", (b) => (output += b));
    worker.stderr!.on("data", (b) => (error += b));
    const done = once(worker, "close");
    const send = async (stage: number, body: Buffer) => {
      const header = Buffer.alloc(8);
      header.writeUInt32LE(stage);
      header.writeUInt32LE(body.length, 4);
      if (!worker!.stdin!.write(Buffer.concat([header, body])))
        await once(worker!.stdin!, "drain");
    };
    let sourceHome = path.join(os.homedir(), ".codex");
    if (synthetic) {
      sourceHome = path.join(temp, "fixture");
      await fs.mkdir(path.join(sourceHome, "sessions"), { recursive: true });
      const records: any[] = [
        {
          type: "session_meta",
          payload: { id: "synthetic", cwd: "/synthetic/project" },
        },
      ];
      for (let i = 0; i < 650; i++)
        records.push({
          type: "response_item",
          timestamp: "2026-01-01T00:00:00Z",
          payload: {
            type: "message",
            role: i % 2 ? "assistant" : "user",
            content: [
              {
                type: "input_text",
                text:
                  `Synthetic event ${i}: test@example.com\n` +
                  "Check the constraint and verify the changed code.\n".repeat(
                    16,
                  ),
              },
            ],
          },
        });
      await fs.writeFile(
        path.join(sourceHome, "sessions", "fixture.jsonl"),
        records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
    }
    const list = await sources(sourceHome);
    const aggregate = {
      source_files: list.length,
      source_bytes: list.reduce((n, s) => n + s.size, 0),
      fully_read_sources: 0,
      blocked_sources: 0,
      incomplete_tail_sources: 0,
      blocked_reasons: {} as Record<string, number>,
      committed_source_prefix_bytes: 0,
      collector_bytes: 0,
      server_masked_bytes: 0,
      batches: 0,
      events: 0,
      event_kinds: {} as Record<string, number>,
      masked_image_data_url_bytes: 0,
      analyzable_sessions: 0,
      over_analysis_limit_sessions: 0,
      deterministic_result_json_bytes: 0,
      max_session_stored_bytes: 0,
    };
    let scanned = 0;
    for (const source of list) {
      const work = await fs.mkdtemp(path.join(temp, "collector-"));
      await initialize(work);
      const state = new State(work);
      let failed = false;
      try {
        // Isolated fresh cursor: unlimited batch count for inventory, real source/record guards.
        await collect(state, source, 0, Number.MAX_SAFE_INTEGER);
      } catch (e) {
        failed = true;
        aggregate.blocked_sources++;
        const message = e instanceof Error ? e.message : "";
        const reason = message.includes("단일 이벤트")
          ? "event_too_large"
          : message.includes("JSONL 줄")
            ? "line_too_large"
            : message.includes("잘못된 JSONL")
              ? "invalid_json"
              : message.includes("Outbox")
                ? "outbox_limit"
                : "contract_or_other";
        aggregate.blocked_reasons[reason] =
          (aggregate.blocked_reasons[reason] || 0) + 1;
      }
      const cursor = state.cursor(source) || 0;
      aggregate.committed_source_prefix_bytes += cursor;
      if (!failed) {
        if (cursor === source.size) aggregate.fully_read_sources++;
        else aggregate.incomplete_tail_sources++;
      }
      const events = new Map<string, AtlasEvent>();
      let storedBytes = 0;
      const rows = state.db
        .prepare("SELECT id FROM batches ORDER BY end_offset")
        .all();
      state.close();
      for (const row of rows) {
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(work, "outbox/ready", row.id + ".json"),
            "utf8",
          ),
        );
        const batch = Batch.parse(manifest.payload);
        const stored = maskBatch(batch);
        const wire = Buffer.from(JSON.stringify(batch)),
          body = Buffer.from(JSON.stringify(stored));
        aggregate.collector_bytes += wire.length;
        aggregate.server_masked_bytes += body.length;
        aggregate.batches++;
        aggregate.events += batch.events.length;
        storedBytes += body.length;
        for (const event of stored.events) {
          events.set(event.id, event);
          aggregate.event_kinds[event.kind] =
            (aggregate.event_kinds[event.kind] || 0) + 1;
          for (const m of (event.text || "").matchAll(
            /data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=]+/g,
          ))
            aggregate.masked_image_data_url_bytes += Buffer.byteLength(m[0]);
        }
        await send(0, wire);
        await send(1, body);
      }
      aggregate.max_session_stored_bytes = Math.max(
        aggregate.max_session_stored_bytes,
        storedBytes,
      );
      if (rows.length) {
        if (storedBytes > 40 * 1024 * 1024)
          aggregate.over_analysis_limit_sessions++;
        else {
          aggregate.analyzable_sessions++;
          const list = [...events.values()],
            result = analyze(list),
            observations = list.filter((e) => e.kind !== "usage");
          const timeline = observations.slice(0, 500).map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            kind: e.kind,
            name: e.name,
            text: e.text?.slice(0, 2000),
          }));
          // Exactly the deterministic analyze+timeline fields; excludes AI, jobs, indexes, physical DB overhead.
          aggregate.deterministic_result_json_bytes += Buffer.byteLength(
            JSON.stringify({
              ...result,
              timeline,
              timelineTotal: observations.length,
            }),
          );
        }
      }
      await fs.rm(work, { recursive: true, force: true });
      if (++scanned % 100 === 0)
        process.stderr.write(
          `Scanned ${scanned}/${list.length} source files\n`,
        );
    }
    worker.stdin!.end();
    const [exitCode] = await done;
    if (exitCode !== 0)
      throw new Error(
        "Native compression worker failed: " + error.slice(0, 200),
      );
    const codecs = JSON.parse(output);
    if (
      synthetic &&
      (aggregate.blocked_sources ||
        aggregate.fully_read_sources !== 1 ||
        aggregate.events !== 650 ||
        !codecs.roundtrip)
    )
      throw new Error("Synthetic pipeline verification failed");
    const report = {
      at: new Date().toISOString(),
      mode: synthetic ? "synthetic" : "local-read-only",
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
      },
      scope:
        "All recognizable Codex sessions and archived_sessions; isolated fresh cursor, no project filters, one source snapshot. Production collector batch/event limits apply; CLI run-count and server daily quotas are not simulated. No upload, AI call, or installed collector state changes.",
      methodology:
        "Same batches for every codec; native single-thread one-shot gzip/zstd/LZ4 frame APIs. One warm-up + three rounds per batch; time is median of round totals, excludes file IO, pipe transfer and allocations of shared buffers. Every decode byte-compared. Storage is a projection after production maskBatch, not deployed compression. Source prefix means local Outbox commit, not server ACK.",
      aggregate,
      codecs,
      elapsed_seconds: (Date.now() - started) / 1000,
    };
    const dest = path.resolve(
      "ops",
      synthetic ? "compression-synthetic.json" : "compression-local.json",
    );
    await fs.writeFile(dest, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    worker?.kill();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error("Compression benchmark failed; no session content logged.");
  process.exitCode = 1;
});
