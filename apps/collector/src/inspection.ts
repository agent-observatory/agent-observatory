import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { DeviceSnapshot } from "@agent-observatory/contracts/device-inspection";
import {
  allowed,
  discoverSources,
  State,
  type Config,
  type Source,
} from "./core.js";

export function scopeSummary(c: Config, sources: Source[]) {
  const selected = sources.filter(
    (s) =>
      allowed(s.project, c) &&
      (!c.since || (!!s.startedAt && s.startedAt >= c.since)) &&
      (!c.until || (!!s.startedAt && s.startedAt <= c.until)),
  );
  const projects = new Map<
    string,
    { project: string; sessions: number; bytes: number }
  >();
  for (const s of selected) {
    const item = projects.get(s.project) || {
      project: s.project,
      sessions: 0,
      bytes: 0,
    };
    item.sessions++;
    item.bytes += s.size;
    projects.set(s.project, item);
  }
  return {
    paused: c.paused,
    sourceTypes: (["codex", "claude-code"] as const).filter(
      (source) => c.sources?.[source]?.enabled !== false,
    ),
    include: c.include.slice(0, 200),
    exclude: c.exclude.slice(0, 200),
    ...(c.since ? { since: c.since } : {}),
    ...(c.until ? { until: c.until } : {}),
    projects: [...projects.values()]
      .sort((a, b) => a.project.localeCompare(b.project))
      .slice(0, 200),
    sessions: selected.length,
    bytes: selected.reduce((n, s) => n + s.size, 0),
    truncated:
      projects.size > 200 || c.include.length > 200 || c.exclude.length > 200,
  };
}
export async function inspectLocal(root: string, c: Config) {
  const observedAt = new Date().toISOString();
  const summary = scopeSummary(c, await discoverSources(c));
  const state = new State(root);
  let pendingBatches = 0,
    pendingBytes = 0;
  try {
    const rows = state.db
      .prepare("SELECT id FROM batches WHERE status='pending'")
      .all();
    for (const row of rows) {
      try {
        pendingBytes += (
          await fs.stat(
            path.join(root, "outbox/ready", String(row.id) + ".json"),
          )
        ).size;
        pendingBatches++;
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  } finally {
    state.close();
  }
  return DeviceSnapshot.parse({
    ...summary,
    observedAt,
    pendingBatches,
    pendingBytes,
  });
}
export async function controlLoop(
  root: string,
  readConfig: () => Promise<Config>,
  readToken: (c: Config) => string | null,
  signal: AbortSignal,
) {
  let delay = 0;
  while (!signal.aborted) {
    try {
      if (delay) await setTimeout(delay, undefined, { signal });
      const c = await readConfig(),
        auth = readToken(c);
      delay = 10000;
      if (!auth) continue;
      const request = async (body?: unknown) => {
        const response = await fetch(c.url + "/api/devices/control", {
          method: body ? "POST" : "GET",
          headers: {
            authorization: `Bearer ${auth}`,
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error(`Control HTTP ${response.status}`);
        return response.json();
      };
      const job = (await request()) as { requestId: string | null };
      if (!job.requestId) continue;
      let reply;
      try {
        // Read the configuration again after receiving the request, never reuse a startup snapshot.
        reply = {
          requestId: job.requestId,
          status: "complete",
          snapshot: await inspectLocal(root, await readConfig()),
        };
      } catch {
        reply = {
          requestId: job.requestId,
          status: "failed",
          error: "inspection_failed",
        };
      }
      await request(reply);
    } catch {
      if (signal.aborted) break;
      // Retry connectivity with a bounded backoff; never log credentials or local paths.
      delay = Math.min(Math.max(delay * 2, 10000), 60000);
    }
  }
}
