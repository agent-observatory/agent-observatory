import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const url =
  process.env.ATLAS_TEST_URL || "https://agent-session-atlas.vercel.app";
const report = {
  at: new Date().toISOString(),
  url,
  checks: [],
  status: "failed",
};

class HttpError extends Error {
  constructor(path, expected, actual) {
    super(`${path}: expected ${expected}, received ${actual}`);
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

class Client {
  cookie = "";

  async request(path, { body, origin = url, method } = {}) {
    const response = await fetch(url + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        origin,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length)
      this.cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    return response;
  }

  async expect(path, { expected, ...options }) {
    const response = await this.request(path, options);
    if (response.status !== expected)
      throw new HttpError(path, expected, response.status);
    return response;
  }

  async json(path, options) {
    const response = await this.request(path, options);
    if (!response.ok) throw new HttpError(path, 200, response.status);
    return response.json();
  }
}

function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => report.checks.push({ name, status: "passed" }))
    .catch((error) => {
      report.checks.push({
        name,
        status: "failed",
        error: error instanceof Error ? error.message : "verification failed",
      });
    });
}

const a = new Client();
const b = new Client();
let sessionId = "";

const sessionIdFrom = (payload, sourceId) =>
  payload.sessions.find((session) => session.source_id === sourceId)?.id || "";

const sourceId = `boundary-${randomUUID()}`;
const batch = {
  schema_version: 1,
  batch_id: randomUUID(),
  source: "codex",
  session_id: sourceId,
  project: "/synthetic/atlas-boundary-verification",
  generation: createHash("sha256").update(sourceId).digest("hex"),
  start_offset: 0,
  end_offset: 128,
  events: [
    {
      id: "boundary-event",
      timestamp: new Date().toISOString(),
      kind: "user",
      text: "synthetic boundary verification",
    },
  ],
};

try {
  await record(
    "anonymous visitors can inspect configured free candidates",
    async () => {
      const response = await fetch(url + "/api/me");
      const payload = await response.json();
      if (
        !response.ok ||
        payload.user !== null ||
        !payload.freeCandidates?.length
      )
        throw new Error("public free candidate list missing");
      for (const candidate of payload.freeCandidates) {
        if (
          !candidate.provider ||
          !candidate.model ||
          "keyEnv" in candidate ||
          "apiKey" in candidate
        )
          throw new Error("invalid public candidate metadata");
      }
    },
  );
  await record("two guest accounts are isolated", async () => {
    await a.expect("/api/guest", { expected: 200, body: {} });
    await b.expect("/api/guest", { expected: 200, body: {} });
    await a.expect("/api/ingest", { expected: 200, body: batch });
    const own = await a.json("/api/sessions");
    sessionId = sessionIdFrom(own, sourceId);
    if (!sessionId) throw new Error("test session was not listed");
    const other = await b.json("/api/sessions");
    if (other.sessions.some((session) => session.id === sessionId))
      throw new Error("session visible to second guest");
  });

  await record("selected job cannot reference another guest session", () =>
    b.expect("/api/analyses", {
      expected: 404,
      body: {
        scope: "selected",
        sessionIds: [sessionId],
        requestKey: randomUUID(),
      },
    }),
  );

  await record("malformed batch returns 422", () =>
    a.expect("/api/ingest", { expected: 422, body: { session_id: sourceId } }),
  );

  await record("same batch id with changed payload returns 409", () =>
    a.expect("/api/ingest", {
      expected: 409,
      body: {
        ...batch,
        events: [{ ...batch.events[0], text: "changed synthetic payload" }],
      },
    }),
  );

  await record("invalid schema version returns 422", () =>
    a.expect("/api/ingest", {
      expected: 422,
      body: { ...batch, batch_id: randomUUID(), schema_version: 2 },
    }),
  );

  await record("cross origin POST returns 403", () =>
    new Client().expect("/api/guest", {
      expected: 403,
      origin: "https://boundary-invalid-origin.example",
      body: {},
    }),
  );

  await record("unsigned ingest request returns 401", () =>
    new Client().expect("/api/ingest", { expected: 401, body: batch }),
  );

  await record("unauthorized scheduler requests return 401", async () => {
    await new Client().expect("/api/jobs/analysis", {
      expected: 401,
      body: {},
    });
    await new Client().expect("/api/jobs/maintenance", {
      expected: 401,
      body: {},
    });
  });

  await record("a guest cannot delete another guest's session", async () => {
    await b.expect(`/api/sessions/${sessionId}`, {
      expected: 200,
      method: "DELETE",
    });
    const own = await a.json("/api/sessions");
    if (!own.sessions.some((session) => session.id === sessionId))
      throw new Error("another guest's delete hid the owned session");
  });

  await record(
    "deletion hides data and blocks the retained source identity",
    async () => {
      await a.expect(`/api/sessions/${sessionId}`, {
        expected: 200,
        method: "DELETE",
      });
      await a.expect(`/api/sessions/${sessionId}`, {
        expected: 200,
        method: "DELETE",
      });
      await a.expect(`/api/sessions/${sessionId}`, { expected: 404 });
      const listed = await a.json("/api/sessions");
      if (listed.sessions.some((session) => session.id === sessionId))
        throw new Error("deleted session remained in the list");
      await a.expect(
        "/api/checkpoint?source=codex&session_id=" +
          encodeURIComponent(sourceId) +
          "&generation=" +
          encodeURIComponent(batch.generation),
        { expected: 410 },
      );
      await a.expect("/api/ingest", {
        expected: 410,
        body: {
          ...batch,
          batch_id: randomUUID(),
          start_offset: 128,
          end_offset: 129,
        },
      });
    },
  );

  report.status = report.checks.every((check) => check.status === "passed")
    ? "passed"
    : "failed";
  if (report.status === "failed") process.exitCode = 1;
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : "verification failed";
  process.exitCode = 1;
} finally {
  if (!sessionId) {
    try {
      const own = await a.json("/api/sessions");
      sessionId = sessionIdFrom(own, sourceId);
    } catch {}
  }
  if (sessionId) {
    try {
      await a.expect(`/api/sessions/${sessionId}`, {
        expected: 200,
        method: "DELETE",
      });
      report.cleanup = "test session deleted";
    } catch (error) {
      report.cleanup = "test session cleanup failed";
      report.cleanupError =
        error instanceof Error ? error.message : "cleanup failed";
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  writeFileSync(
    "ops/boundary-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
