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
