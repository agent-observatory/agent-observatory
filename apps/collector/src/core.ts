import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import {
  Batch,
  Ack,
  MAX_JSONL_LINE_BYTES,
  type AtlasBatch,
  type AtlasEvent,
} from "@agent-observatory/contracts";
import { compressBatch } from "@agent-observatory/contracts/transport";
import { codexEventWithImages } from "@agent-observatory/contracts/images";
export const sha = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
export type Config = {
  url: string;
  sourceHome: string;
  exclude: string[];
  include: string[];
  paused: boolean;
  since?: string;
  until?: string;
  deviceId?: string;
};
export type Source = {
  file: string;
  sessionId: string;
  project: string;
  generation: string;
  size: number;
  startedAt?: string;
};
export const MAX_OUTBOX_BYTES = 1_073_741_824;
export async function sources(root: string): Promise<Source[]> {
  const result: Source[] = [];
  async function visit(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const ent of entries) {
      const file = path.join(dir, ent.name);
      if (ent.isDirectory()) await visit(file);
      else if (ent.isFile() && file.endsWith(".jsonl")) {
        const h = await fs.open(file, "r");
        try {
          const b = Buffer.alloc(64 * 1024);
          const { bytesRead } = await h.read(b, 0, b.length, 0);
          const end = b.subarray(0, bytesRead).indexOf(10);
          if (end < 0) continue;
          const line = b.subarray(0, end);
          const r = JSON.parse(line.toString("utf8"));
          if (r.type !== "session_meta" || !r.payload?.id || !r.payload?.cwd)
            continue;
          const stat = await h.stat();
          result.push({
            file,
            sessionId: r.payload.id,
            project: r.payload.cwd,
            generation: sha(line),
            size: stat.size,
            startedAt: r.timestamp || r.payload.timestamp,
          });
        } catch (e: any) {
          if (e instanceof SyntaxError) continue;
          throw e;
        } finally {
          await h.close();
        }
      }
    }
  }
  await visit(path.join(root, "sessions"));
  await visit(path.join(root, "archived_sessions"));
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
export function allowed(project: string, c: Config) {
  const matches = (rule: string) => {
    const prefix = path.resolve(rule.replace(/\/\*\*$/, ""));
    const p = path.resolve(project);
    return p === prefix || p.startsWith(prefix + path.sep);
  };
  return (
    !c.exclude.some(matches) && (!c.include.length || c.include.some(matches))
  );
}
export class State {
  db: DatabaseSync;
  constructor(readonly root: string) {
    this.db = new DatabaseSync(path.join(root, "state.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS cursors(file TEXT PRIMARY KEY,generation TEXT NOT NULL,offset INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,file TEXT NOT NULL,generation TEXT NOT NULL,end_offset INTEGER NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0);
 `);
  }
  cursor(s: Source) {
    const c = this.db.prepare("SELECT * FROM cursors WHERE file=?").get(s.file);
    return c && c.generation === s.generation && Number(c.offset) <= s.size
      ? Number(c.offset)
      : null;
  }
  checkpoint(s: Source, offset: number) {
    this.db
      .prepare(
        "INSERT INTO cursors VALUES(?,?,?) ON CONFLICT(file) DO UPDATE SET generation=excluded.generation,offset=excluded.offset",
      )
      .run(s.file, s.generation, offset);
  }
  close() {
    this.db.close();
  }
}
export async function initialize(root: string) {
  await fs.mkdir(path.join(root, "outbox/ready"), {
    recursive: true,
    mode: 0o700,
  });
  await fs.mkdir(path.join(root, "outbox/.staging"), {
    recursive: true,
    mode: 0o700,
  });
  await fs.chmod(root, 0o700);
}
async function syncDir(dir: string) {
  const h = await fs.open(dir, "r");
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
export async function outboxBytes(root: string) {
  let total = 0;
  for (const dir of ["outbox/ready", "outbox/.staging"]) {
    for (const entry of await fs.readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      total += (await fs.stat(path.join(root, dir, entry.name))).size;
    }
  }
  return total;
}
async function ensureOutboxCapacity(root: string, additionalBytes: number) {
  const used = await outboxBytes(root);
  if (used + additionalBytes > MAX_OUTBOX_BYTES)
    throw new Error("Outbox 저장 한도(1GiB) 초과 · 원본 보존");
}
export async function commitBatch(
  state: State,
  source: Source,
  batch: AtlasBatch,
) {
  const payload = JSON.stringify(Batch.parse(batch));
  const hash = sha(payload);
  // Validate both decoded and wire limits before advancing the durable cursor.
  compressBatch(batch);
  let destination: { url: string; deviceId?: string } | null = null;
  try {
    destination = JSON.parse(
      await fs.readFile(path.join(state.root, "config.json"), "utf8"),
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const manifest = {
    file: source.file,
    url: destination?.url || "",
    deviceId: destination?.deviceId || "",
    hash,
    payload: JSON.parse(payload),
  };
  const manifestPayload = JSON.stringify(manifest);
  await ensureOutboxCapacity(state.root, Buffer.byteLength(manifestPayload));
  const staging = path.join(
    state.root,
    "outbox/.staging",
    batch.batch_id + ".json",
  );
  const ready = path.join(state.root, "outbox/ready", batch.batch_id + ".json");
  const h = await fs.open(staging, "wx", 0o600);
  try {
    await h.writeFile(manifestPayload);
    await h.sync();
  } finally {
    await h.close();
  }
  await fs.rename(staging, ready);
  await syncDir(path.dirname(ready));
  register(state, source, batch, hash);
  return batch.batch_id;
}
function register(state: State, s: Source, b: AtlasBatch, hash: string) {
  state.db.exec("BEGIN IMMEDIATE");
  try {
    state.db
      .prepare(
        "INSERT OR IGNORE INTO batches(id,file,generation,end_offset,hash) VALUES(?,?,?,?,?)",
      )
      .run(b.batch_id, s.file, b.generation, b.end_offset, hash);
    const c = state.cursor(s);
    if (c === null || b.end_offset > c) state.checkpoint(s, b.end_offset);
    state.db.exec("COMMIT");
  } catch (e) {
    state.db.exec("ROLLBACK");
    throw e;
  }
}
export async function recover(state: State) {
  for (const name of await fs.readdir(path.join(state.root, "outbox/ready"))) {
    if (!name.endsWith(".json")) continue;
    const m = JSON.parse(
      await fs.readFile(path.join(state.root, "outbox/ready", name), "utf8"),
    );
    const b = Batch.parse(m.payload);
    if (sha(JSON.stringify(b)) !== m.hash)
      throw new Error("Outbox 무결성 오류");
    if (!state.db.prepare("SELECT id FROM batches WHERE id=?").get(b.batch_id))
      register(
        state,
        {
          file: m.file,
          sessionId: b.session_id,
          project: b.project,
          generation: b.generation,
          size: b.end_offset,
        },
        b,
        m.hash,
      );
  }
  // A missing unacknowledged file must rewind rather than silently lose data.
  for (const row of state.db
    .prepare("SELECT * FROM batches WHERE status!='acknowledged'")
    .all()) {
    try {
      await fs.access(path.join(state.root, "outbox/ready", row.id + ".json"));
    } catch {
      state.db.prepare("DELETE FROM cursors WHERE file=?").run(row.file);
      state.db.prepare("DELETE FROM batches WHERE id=?").run(row.id);
    }
  }
}
export async function collect(
  state: State,
  s: Source,
  offset: number,
  maxBatches = 20,
) {
  let current = offset,
    start = offset,
    events: AtlasEvent[] = [],
    count = 0;
  const h = await fs.open(s.file, "r");
  let carry = Buffer.alloc(0);
  let position = offset;
  const flush = async () => {
    if (current === start) return;
    const batch: AtlasBatch = {
      schema_version: 1,
      batch_id: randomUUID(),
      source: "codex",
      session_id: s.sessionId,
      project: s.project,
      generation: s.generation,
      start_offset: start,
      end_offset: current,
      events,
    };
    await commitBatch(state, s, batch);
    start = current;
    events = [];
    count++;
  };
  try {
    while (position < s.size && count < maxBatches) {
      const buf = Buffer.alloc(Math.min(256 * 1024, s.size - position));
      const { bytesRead } = await h.read(buf, 0, buf.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      carry = Buffer.concat([carry, buf.subarray(0, bytesRead)]);
      let end;
      while ((end = carry.indexOf(10)) >= 0 && count < maxBatches) {
        const line = carry.subarray(0, end);
        if (line.length > MAX_JSONL_LINE_BYTES)
          throw new Error(
            "단일 JSONL 줄이 64MiB를 초과했습니다. 원본 보존·수집 중단",
          );
        const next = current + end + 1;
        let event: AtlasEvent | null = null;
        try {
          if (line.length)
            event = await codexEventWithImages(
              JSON.parse(line.toString("utf8")),
              sha(s.generation + ":" + current),
            );
        } catch {
          throw new Error(
            "잘못된 JSONL 레코드: 원본과 읽기 위치를 보존했습니다",
          );
        }
        if (event) {
          const candidate = {
            schema_version: 1 as const,
            batch_id: randomUUID(),
            source: "codex" as const,
            session_id: s.sessionId,
            project: s.project,
            generation: s.generation,
            start_offset: start,
            end_offset: next,
            events: [...events, event],
          };
          let candidateFits = true;
          try {
            compressBatch(candidate);
          } catch {
            candidateFits = false;
          }
          if (events.length >= 300 || !candidateFits) {
            await flush();
            if (count >= maxBatches) break;
            try {
              compressBatch({
                ...candidate,
                start_offset: current,
                events: [event],
              });
            } catch {
              throw new Error(
                "단일 이벤트가 압축 전송 또는 해제 한도를 초과했습니다. 원본 보존·수집 중단",
              );
            }
          }
          events.push(event);
        }
        current = next;
        carry = carry.subarray(end + 1);
      }
      if (carry.length > MAX_JSONL_LINE_BYTES)
        throw new Error(
          "단일 JSONL 줄이 64MiB를 초과했습니다. 원본 보존·수집 중단",
        );
    }
    if (count < maxBatches) await flush();
    return count;
  } finally {
    await h.close();
  }
}
export async function acquire(root: string) {
  const lock = path.join(root, "sync.lock");
  const guard = new DatabaseSync(path.join(root, "sync-guard.sqlite"));
  try {
    guard.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch (e: any) {
    guard.close();
    if (e.code === "SQLITE_BUSY" || String(e.message).includes("locked"))
      return null;
    throw e;
  }
  let owns = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const h = await fs.open(lock, "wx", 0o600);
        await h.writeFile(String(process.pid));
        await h.close();
        owns = true;
        return async () => {
          await fs.unlink(lock).catch(() => {});
          guard.exec("COMMIT");
          guard.close();
        };
      } catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        const pid = Number(await fs.readFile(lock, "utf8"));
        try {
          process.kill(pid, 0);
          return null;
        } catch (err: any) {
          if (err.code !== "ESRCH") return null;
          await fs.unlink(lock).catch(() => {});
        }
      }
    }
    return null;
  } finally {
    // A failed acquisition must release the serialization guard too.
    if (!owns) {
      try {
        guard.exec("ROLLBACK");
      } catch {}
      guard.close();
    }
  }
}
export async function sendPending(
  state: State,
  c: Config,
  token: string,
  request: typeof fetch = fetch,
) {
  let sent = 0;
  for (const row of state.db
    .prepare(
      `SELECT candidate.* FROM batches candidate
       WHERE candidate.status='pending' AND candidate.retry_at<=?1
         AND NOT EXISTS (
           SELECT 1 FROM batches earlier
           WHERE earlier.file=candidate.file
             AND earlier.generation=candidate.generation
             AND earlier.rowid<candidate.rowid
             AND earlier.status!='acknowledged'
             AND NOT (earlier.status='pending' AND earlier.retry_at<=?1)
         )
       ORDER BY candidate.rowid LIMIT 20`,
    )
    .all(Date.now())) {
    const file = path.join(state.root, "outbox/ready", row.id + ".json");
    const m = JSON.parse(await fs.readFile(file, "utf8"));
    const b = Batch.parse(m.payload);
    if (!allowed(b.project, c)) continue;
    if ((m.url && m.url !== c.url) || (m.deviceId && m.deviceId !== c.deviceId))
      throw new Error("Outbox 목적지가 현재 연결과 다릅니다");
    try {
      const body = compressBatch(b);
      const res = await request(c.url + "/api/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          "x-atlas-content-encoding": "zstd",
          "x-content-sha256": String(row.hash),
        },
        body: Uint8Array.from(body),
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!res.ok) {
        if (res.status === 409) {
          const checkpoint = new URL(c.url + "/api/checkpoint");
          checkpoint.searchParams.set("session_id", b.session_id);
          checkpoint.searchParams.set("generation", b.generation);
          const checkpointResponse = await request(checkpoint, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30000),
            redirect: "error",
          });
          if (!checkpointResponse.ok)
            throw new Error(
              `접수 위치 재조정 실패 HTTP ${checkpointResponse.status}`,
            );
          const checkpointBody = (await checkpointResponse.json()) as any;
          const serverOffset = Number(checkpointBody.offset) || 0;
          if (serverOffset >= b.end_offset) {
            state.db
              .prepare("UPDATE batches SET status='acknowledged' WHERE id=?")
              .run(row.id);
            await fs.unlink(file);
            sent++;
            continue;
          }
        }
        if ([400, 401, 403, 409, 410, 413, 422].includes(res.status)) {
          state.db
            .prepare("UPDATE batches SET status='blocked' WHERE id=?")
            .run(row.id);
          throw new Error(`전송 차단 HTTP ${res.status}`);
        }
        const delay = Math.max(
          300000 * Math.pow(2, Math.min(Number(row.attempts), 4)),
          Number(res.headers.get("retry-after") || 0) * 1000,
        );
        state.db
          .prepare(
            "UPDATE batches SET attempts=attempts+1,retry_at=? WHERE id=?",
          )
          .run(Date.now() + Math.min(delay, 86400000), row.id);
        break;
      }
      const ack = Ack.parse(await res.json());
      if (
        ack.batch_id !== row.id ||
        ack.received_sha256 !== row.hash ||
        ack.end_offset !== b.end_offset
      )
        throw new Error("접수증 불일치");
      state.db
        .prepare("UPDATE batches SET status='acknowledged' WHERE id=?")
        .run(row.id);
      await fs.unlink(file);
      sent++;
    } catch (e) {
      state.db
        .prepare(
          "UPDATE batches SET attempts=attempts+1,retry_at=? WHERE id=? AND status='pending'",
        )
        .run(Date.now() + 300000, row.id);
      throw e;
    }
  }
  return sent;
}
