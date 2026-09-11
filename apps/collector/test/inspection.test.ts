import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initialize, State, type Config, type Source } from "../src/core.js";
import { inspectLocal, scopeSummary } from "../src/inspection.js";

const config = (overrides: Partial<Config> = {}): Config => ({
  url: "https://atlas.example",
  sourceHome: "/synthetic/unused",
  include: [],
  exclude: [],
  paused: false,
  ...overrides,
});

const source = (
  project: string,
  startedAt: string | undefined,
  size = 100,
): Source => ({
  source: "codex",
  file: `/synthetic/${project.replaceAll("/", "-")}.jsonl`,
  sessionId: project,
  project,
  generation: "synthetic",
  size,
  startedAt,
  subjectModel: { harness: "codex" },
});

test("scopeSummary applies include, exclude, and period gates", () => {
  const summary = scopeSummary(
    config({
      include: ["/work"],
      exclude: ["/work/private/**"],
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-31T23:59:59.000Z",
    }),
    [
      source("/work/public", "2026-01-15T00:00:00.000Z", 120),
      source("/work/private/secret", "2026-01-15T00:00:00.000Z"),
      source("/other", "2026-01-15T00:00:00.000Z"),
      source("/work/old", "2025-12-31T23:59:59.000Z"),
      source("/work/undated", undefined),
    ],
  );

  assert.equal(summary.sessions, 1);
  assert.equal(summary.bytes, 120);
  assert.deepEqual(summary.projects, [
    { project: "/work/public", sessions: 1, bytes: 120 },
  ]);
});

test("inspectLocal discovers only enabled synthetic source homes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-inspection-"));
  try {
    await initialize(root);
    const codexHome = path.join(root, "codex");
    const claudeHome = path.join(root, "claude");
    await fs.mkdir(path.join(codexHome, "sessions"), { recursive: true });
    await fs.mkdir(claudeHome, { recursive: true });
    await fs.writeFile(
      path.join(codexHome, "sessions", "codex.jsonl"),
      `${JSON.stringify({ type: "session_meta", timestamp: "2026-01-01T00:00:00.000Z", payload: { id: "codex", cwd: "/synthetic/codex" } })}\n`,
    );
    await fs.writeFile(
      path.join(claudeHome, "claude.jsonl"),
      `${JSON.stringify({ type: "user", sessionId: "claude", cwd: "/synthetic/claude", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "fixture" } })}\n`,
    );

    const snapshot = await inspectLocal(
      root,
      config({
        sourceHome: codexHome,
        sources: {
          codex: { enabled: false, home: codexHome },
          "claude-code": { enabled: true, home: claudeHome },
        },
      }),
    );

    assert.deepEqual(snapshot.sourceTypes, ["claude-code"]);
    assert.equal(snapshot.sessions, 1);
    assert.equal(snapshot.projects[0]?.project, "/synthetic/claude");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("inspectLocal counts pending batches only when the ready payload exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-inspection-"));
  try {
    await initialize(root);
    const state = new State(root);
    try {
      state.db
        .prepare(
          "INSERT INTO batches(id,file,generation,end_offset,hash,status) VALUES(?,?,?,?,?,?)",
        )
        .run("ready", "/synthetic/a", "g", 1, "h", "pending");
      state.db
        .prepare(
          "INSERT INTO batches(id,file,generation,end_offset,hash,status) VALUES(?,?,?,?,?,?)",
        )
        .run("missing", "/synthetic/b", "g", 1, "h", "pending");
      state.db
        .prepare(
          "INSERT INTO batches(id,file,generation,end_offset,hash,status) VALUES(?,?,?,?,?,?)",
        )
        .run("sent", "/synthetic/c", "g", 1, "h", "sent");
    } finally {
      state.close();
    }
    const payload = "synthetic pending payload";
    await fs.writeFile(path.join(root, "outbox/ready/ready.json"), payload);
    await fs.writeFile(path.join(root, "outbox/ready/sent.json"), "ignored");

    const snapshot = await inspectLocal(
      root,
      config({
        sources: {
          codex: { enabled: false },
          "claude-code": { enabled: false },
        },
      }),
    );

    assert.equal(snapshot.pendingBatches, 1);
    assert.equal(snapshot.pendingBytes, Buffer.byteLength(payload));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scopeSummary bounds returned paths and projects while preserving totals", () => {
  const include = Array.from(
    { length: 201 },
    (_, index) => `/include/${index}`,
  );
  const exclude = Array.from(
    { length: 201 },
    (_, index) => `/exclude/${index}`,
  );
  const entries = Array.from({ length: 201 }, (_, index) =>
    source(`/project/${String(index).padStart(3, "0")}`, undefined, 2),
  );
  const summary = scopeSummary(config({ include: [], exclude: [] }), entries);
  const boundedPaths = scopeSummary(config({ include, exclude }), []);

  assert.equal(summary.projects.length, 200);
  assert.equal(summary.sessions, 201);
  assert.equal(summary.bytes, 402);
  assert.equal(summary.truncated, true);
  assert.equal(boundedPaths.include.length, 200);
  assert.equal(boundedPaths.exclude.length, 200);
  assert.equal(boundedPaths.truncated, true);
});
