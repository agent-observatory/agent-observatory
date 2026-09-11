import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  State,
  initialize,
  sources,
  collect,
  recover,
  sendPending,
  allowed,
  acquire,
  MAX_OUTBOX_BYTES,
  outboxBytes,
  commitBatch,
  claudeCodeSources,
  discoverSources,
  heartbeat,
  completeSnapshot,
} from "../src/core.js";
import { decompressBatch } from "@agent-observatory/contracts/transport";
import { randomBytes } from "node:crypto";
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-test-"));
  await initialize(root);
  await fs.mkdir(path.join(root, "codex/sessions"), { recursive: true });
  const file = path.join(root, "codex/sessions/session.jsonl");
  const lines = [
    {
      type: "session_meta",
      payload: { id: "synthetic", cwd: "/synthetic/project" },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "synthetic test" }],
      },
    },
  ]
    .map((x) => JSON.stringify(x) + "\n")
    .join("");
  await fs.writeFile(file, lines + '{"partial":');
  return {
    root,
    file,
    source: (await sources(path.join(root, "codex")))[0],
    state: new State(root),
    lines,
  };
}
test("partial lines wait; Outbox recovers cursor; ACK loss retains and replay removes", async () => {
  const f = await fixture();
  try {
    await collect(f.state, f.source, 0);
    assert.equal(f.state.cursor(f.source), Buffer.byteLength(f.lines));
    f.state.db.exec("DELETE FROM cursors; DELETE FROM batches;");
    await recover(f.state);
    assert.equal(f.state.cursor(f.source), Buffer.byteLength(f.lines));
    const c = {
      url: "https://atlas.example",
      sourceHome: "",
      exclude: [],
      include: [],
      paused: false,
    };
    await assert.rejects(
      sendPending(f.state, c, "synthetic", async () => {
        throw new Error("lost ACK");
      }),
    );
    assert.equal(
      (await fs.readdir(path.join(f.root, "outbox/ready"))).length,
      1,
    );
    f.state.db.exec("UPDATE batches SET retry_at=0");
    const sent = await sendPending(
      f.state,
      c,
      "synthetic",
      async (_url, init) => {
        const b = decompressBatch(init?.body as Uint8Array).batch;
        assert.equal(
          (init?.headers as any)["x-atlas-content-encoding"],
          "zstd",
        );
        return Response.json({
          batch_id: b.batch_id,
          received_sha256: (init?.headers as any)["x-content-sha256"],
          end_offset: b.end_offset,
        });
      },
    );
    assert.equal(sent, 1);
    assert.equal(
      (await fs.readdir(path.join(f.root, "outbox/ready"))).length,
      0,
    );
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("a compressible 400 KB UTF-8 event stays whole in one batch", async () => {
  const f = await fixture();
  try {
    const text = "근거보존".repeat(50_000);
    await fs.writeFile(
      f.file,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "synthetic", cwd: "/synthetic/project" },
      }) +
        "\n" +
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        }) +
        "\n",
    );
    const source = (await sources(path.join(f.root, "codex")))[0];
    assert.equal(await collect(f.state, source, 0), 1);
    const [name] = await fs.readdir(path.join(f.root, "outbox/ready"));
    const manifest = JSON.parse(
      await fs.readFile(path.join(f.root, "outbox/ready", name), "utf8"),
    );
    assert.equal(manifest.payload.events.length, 1);
    assert.equal(manifest.payload.events[0].text, text);
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("an incompressible oversized event fails without advancing its cursor", async () => {
  const f = await fixture();
  try {
    const text = randomBytes(1_300_000).toString("base64");
    await fs.writeFile(
      f.file,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "synthetic", cwd: "/synthetic/project" },
      }) +
        "\n" +
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        }) +
        "\n",
    );
    const source = (await sources(path.join(f.root, "codex")))[0];
    await assert.rejects(collect(f.state, source, 0), /단일 이벤트/);
    const eventOffset = Buffer.byteLength(
      JSON.stringify({
        type: "session_meta",
        payload: { id: "synthetic", cwd: "/synthetic/project" },
      }) + "\n",
    );
    assert.equal(f.state.cursor(source), eventOffset);
    assert.equal(
      (await fs.readdir(path.join(f.root, "outbox/ready"))).length,
      1,
    );
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("missing Outbox rewinds; live lock prevents second process; excluded paths win", async () => {
  const f = await fixture();
  try {
    await collect(f.state, f.source, 0);
    for (const n of await fs.readdir(path.join(f.root, "outbox/ready")))
      await fs.unlink(path.join(f.root, "outbox/ready", n));
    await recover(f.state);
    assert.equal(f.state.cursor(f.source), null);
    const unlock = await acquire(f.root);
    assert.ok(unlock);
    assert.equal(await acquire(f.root), null);
    await unlock();
    assert.equal(
      allowed("/work/private/x", {
        url: "",
        sourceHome: "",
        paused: false,
        include: ["/work"],
        exclude: ["/work/private/**"],
      }),
      false,
    );
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("stale lock is reclaimed without leaving a stale marker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-lock-"));
  try {
    await fs.writeFile(path.join(root, "sync.lock"), "999999999", {
      mode: 0o600,
    });
    const [first, second] = await Promise.all([acquire(root), acquire(root)]);
    const unlock = first || second;
    assert.ok(unlock);
    assert.equal(Boolean(first) && Boolean(second), false);
    assert.equal(
      await fs.readFile(path.join(root, "sync.lock"), "utf8"),
      String(process.pid),
    );
    assert.deepEqual(
      (await fs.readdir(root)).filter((name) => name.includes(".stale-")),
      [],
    );
    await unlock();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("409 ingest reconciles an already uploaded generation through checkpoint", async () => {
  const f = await fixture();
  try {
    await collect(f.state, f.source, 0);
    const c = {
      url: "https://atlas.example",
      sourceHome: "",
      exclude: [],
      include: [],
      paused: false,
    };
    let calls = 0;
    const sent = await sendPending(f.state, c, "synthetic", async (url) => {
      calls++;
      if (String(url).includes("/api/ingest"))
        return new Response("same generation already received", {
          status: 409,
        });
      return Response.json({ offset: f.source.size });
    });
    assert.equal(sent, 1);
    assert.equal(calls, 2);
    assert.equal(
      (await fs.readdir(path.join(f.root, "outbox/ready"))).length,
      0,
    );
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("a deferred earlier batch blocks only later batches in the same generation", async () => {
  const f = await fixture();
  try {
    const makeBatch = (generation: string, start: number, end: number) => ({
      schema_version: 1 as const,
      batch_id: crypto.randomUUID(),
      source: "codex" as const,
      session_id: generation,
      project: "/synthetic/project",
      generation,
      start_offset: start,
      end_offset: end,
      events: [],
    });
    const first = makeBatch("a".repeat(64), 0, 10);
    const second = makeBatch("a".repeat(64), 10, 20);
    const other = makeBatch("b".repeat(64), 0, 10);
    await commitBatch(
      f.state,
      { ...f.source, generation: first.generation },
      first,
    );
    await commitBatch(
      f.state,
      { ...f.source, generation: second.generation },
      second,
    );
    await commitBatch(
      f.state,
      { ...f.source, generation: other.generation },
      other,
    );
    f.state.db
      .prepare("UPDATE batches SET retry_at=? WHERE id=?")
      .run(Date.now() + 60_000, first.batch_id);
    const posted: string[] = [];
    const sent = await sendPending(
      f.state,
      {
        url: "https://atlas.example",
        sourceHome: "",
        exclude: [],
        include: [],
        paused: false,
      },
      "synthetic",
      async (_url, init) => {
        const batch = decompressBatch(init?.body as Uint8Array).batch;
        posted.push(batch.batch_id);
        return Response.json({
          batch_id: batch.batch_id,
          received_sha256: (init?.headers as any)["x-content-sha256"],
          end_offset: batch.end_offset,
        });
      },
    );
    assert.equal(sent, 1);
    assert.deepEqual(posted, [other.batch_id]);
    assert.equal(
      f.state.db
        .prepare("SELECT status FROM batches WHERE id=?")
        .get(second.batch_id)?.status,
      "pending",
    );
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("commit refuses to enqueue when ready and staging reach the 1 GiB cap", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, "outbox/ready/filler"), "");
    await fs.truncate(
      path.join(f.root, "outbox/ready/filler"),
      MAX_OUTBOX_BYTES,
    );
    assert.equal(await outboxBytes(f.root), MAX_OUTBOX_BYTES);
    await assert.rejects(
      collect(f.state, f.source, 0),
      /Outbox 저장 한도\(1GiB\) 초과/,
    );
    assert.equal(
      (await fs.readdir(path.join(f.root, "outbox/.staging"))).length,
      0,
    );
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("a malformed source can fail while a later valid source remains collectable", async () => {
  const f = await fixture();
  const valid = path.join(f.root, "codex/sessions/valid.jsonl");
  try {
    await fs.writeFile(
      valid,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "valid", cwd: "/synthetic/project" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "valid" }],
          },
        }),
      ].join("\n") + "\n",
    );
    await fs.appendFile(f.file, '{"bad":\n');
    const malformed = {
      ...f.source,
      size: (await fs.stat(f.file)).size,
    };
    await assert.rejects(
      collect(f.state, malformed, Buffer.byteLength(f.lines)),
      /잘못된 JSONL 레코드/,
    );
    const validSource = (await sources(path.join(f.root, "codex"))).find(
      (source) => source.file === valid,
    );
    assert.ok(validSource);
    assert.equal(await collect(f.state, validSource, 0), 1);
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Claude Code discovery produces source-scoped v2 batches without thinking text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-claude-"));
  const state = new State(root);
  try {
    await initialize(root);
    const claudeRoot = path.join(root, "claude", "projects");
    await fs.mkdir(path.join(claudeRoot, "synthetic"), { recursive: true });
    await fs.writeFile(
      path.join(claudeRoot, "synthetic", "session.jsonl"),
      [
        {
          type: "user",
          sessionId: "claude-synthetic",
          cwd: "/synthetic/claude",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { content: "synthetic request" },
        },
        {
          type: "assistant",
          sessionId: "claude-synthetic",
          cwd: "/synthetic/claude",
          timestamp: "2026-01-01T00:00:01.000Z",
          effort: "high",
          message: {
            model: "synthetic-model",
            content: [
              { type: "thinking", thinking: "must not be collected" },
              { type: "text", text: "first visible response" },
              {
                type: "tool_use",
                id: "tool",
                name: "Skill",
                input: { skill: "review" },
              },
              { type: "text", text: "second visible response" },
            ],
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const direct = await claudeCodeSources(claudeRoot);
    assert.equal(direct.length, 1);
    const source = direct[0];
    assert.equal(source.source, "claude-code");
    assert.deepEqual(source.subjectModel, {
      harness: "claude-code",
      model: "synthetic-model",
      reasoning: "high",
    });
    assert.deepEqual(
      await discoverSources({
        url: "https://atlas.example",
        sourceHome: path.join(root, "no-codex"),
        sources: {
          codex: { enabled: false },
          "claude-code": { home: claudeRoot },
        },
        exclude: [],
        include: [],
        paused: false,
      }),
      direct,
    );
    assert.equal(await collect(state, source, 0), 1);
    const [name] = await fs.readdir(path.join(root, "outbox/ready"));
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, "outbox/ready", name), "utf8"),
    );
    assert.equal(manifest.payload.schema_version, 2);
    assert.equal(manifest.payload.source, "claude-code");
    assert.deepEqual(
      manifest.payload.events.map((event: { kind: string; text?: string }) => ({
        kind: event.kind,
        text: event.text,
      })),
      [
        { kind: "user", text: "synthetic request" },
        { kind: "assistant", text: "first visible response" },
        { kind: "tool_call", text: '{"skill":"review"}' },
        { kind: "assistant", text: "second visible response" },
      ],
    );
    assert.ok(
      !JSON.stringify(manifest.payload).includes("must not be collected"),
    );
  } finally {
    state.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("heartbeat is secret-free and completion follows an acknowledged snapshot", async () => {
  const f = await fixture();
  try {
    await collect(f.state, f.source, 0);
    const config = {
      url: "https://atlas.example",
      sourceHome: "",
      sources: { "claude-code": { enabled: false } },
      exclude: [],
      include: [],
      paused: false,
    };
    await sendPending(f.state, config, "synthetic", async (_url, init) => {
      const batch = decompressBatch(init?.body as Uint8Array).batch;
      return Response.json({
        batch_id: batch.batch_id,
        received_sha256: (init?.headers as any)["x-content-sha256"],
        end_offset: batch.end_offset,
      });
    });
    let heartbeatBody: any;
    await heartbeat(config, "synthetic", "success", async (_url, init) => {
      heartbeatBody = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    });
    assert.deepEqual(heartbeatBody, {
      version: "0.3.0",
      sourceTypes: ["codex"],
      paused: false,
      status: "success",
    });
    let completionBody: any;
    const capturedEndOffset = f.state.cursor(f.source)!;
    assert.equal(
      await completeSnapshot(
        f.state,
        config,
        "synthetic",
        f.source,
        capturedEndOffset,
        async (_url, init) => {
          completionBody = JSON.parse(String(init?.body));
          return Response.json({
            ok: true,
            completed_at: "2026-01-01T00:00:00.000Z",
          });
        },
      ),
      true,
    );
    assert.deepEqual(completionBody, {
      source: "codex",
      session_id: "synthetic",
      generation: f.source.generation,
      snapshot_end_offset: capturedEndOffset,
    });
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("Codex turn model context carries to later events in the same source stream", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      f.file,
      [
        {
          type: "session_meta",
          payload: { id: "synthetic", cwd: "/synthetic/project" },
        },
        {
          type: "event_msg",
          payload: {
            type: "turn_context",
            model: "synthetic-model",
            reasoning_effort: "high",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "visible" }],
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const source = (await sources(path.join(f.root, "codex")))[0];
    assert.equal(await collect(f.state, source, 0), 1);
    const [name] = await fs.readdir(path.join(f.root, "outbox/ready"));
    const manifest = JSON.parse(
      await fs.readFile(path.join(f.root, "outbox/ready", name), "utf8"),
    );
    assert.deepEqual(manifest.payload.events[0].subject_model, {
      harness: "codex",
      model: "synthetic-model",
      reasoning: "high",
    });
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("a recovered server checkpoint can confirm completion without local ACK history", async () => {
  const f = await fixture();
  try {
    f.state.checkpoint(f.source, f.source.size);
    let calls = 0;
    const config = {
      url: "https://atlas.example",
      sourceHome: "",
      exclude: [],
      include: [],
      paused: false,
    };
    assert.equal(
      await completeSnapshot(
        f.state,
        config,
        "synthetic",
        f.source,
        f.source.size,
        async () => {
          calls++;
          return Response.json({
            ok: true,
            completed_at: "2026-01-01T00:00:00Z",
          });
        },
      ),
      true,
    );
    assert.equal(calls, 1);
  } finally {
    f.state.close();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
