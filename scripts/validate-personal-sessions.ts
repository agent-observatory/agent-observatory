// Explicit bounded real-data pilot. Payloads and identifiers stay outside the repository.
// pnpm exec tsx scripts/validate-personal-sessions.ts prepare|upload <private-run-directory>
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  initialize,
  State,
  sources,
  collect,
  allowed,
  sendPending,
  type Config,
} from "../apps/collector/src/core";
import { Batch } from "../packages/contracts/src/index";
import { compressBatch } from "../packages/contracts/src/transport";
const HOME = path.join(os.homedir(), ".agent-session-atlas");
const cap = 25_000_000;
async function main() {
  const [mode, argument] = process.argv.slice(2);
  if (!argument || !["prepare", "upload"].includes(mode))
    throw new Error("Usage: prepare|upload <private-run-directory>");
  const root = path.resolve(argument);
  if (!root.startsWith(HOME + path.sep))
    throw new Error("Use a private directory below the Collector home");
  const config: Config = JSON.parse(
    await fs.readFile(path.join(HOME, "config.json"), "utf8"),
  );
  if (mode === "prepare") {
    await fs.mkdir(root, { mode: 0o700 });
    await initialize(root);
    await fs.writeFile(path.join(root, "config.json"), JSON.stringify(config), {
      mode: 0o600,
    });
    const until = new Date();
    const since = new Date(until.getTime() - 7 * 86400000).toISOString();
    const list = (await sources(config.sourceHome))
      .filter(
        (s) =>
          allowed(s.project, config) &&
          s.startedAt &&
          s.startedAt >= since &&
          s.startedAt <= until.toISOString(),
      )
      .sort((a, b) => b.startedAt!.localeCompare(a.startedAt!));
    const selected: any[] = [];
    let wireBytes = 0,
      decodedBytes = 0,
      rejectedLarge = 0,
      rejectedIncomplete = 0,
      rejectedBudget = 0,
      excludedSubagents = 0,
      excludedActive = 0;
    // Stage each source separately; a failed source never contributes a partial upload.
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const handle = await fs.open(s.file, "r");
      const head = Buffer.alloc(65536);
      await handle.read(head, 0, head.length, 0);
      const stat = await handle.stat();
      await handle.close();
      const meta = JSON.parse(head.subarray(0, head.indexOf(10)).toString());
      if (meta.payload?.source?.subagent) {
        excludedSubagents++;
        continue;
      }
      if (stat.mtimeMs > until.getTime() - 300000) {
        excludedActive++;
        continue;
      }
      const work = path.join(root, "candidate-" + i);
      await initialize(work);
      await fs.writeFile(
        path.join(work, "config.json"),
        JSON.stringify(config),
        { mode: 0o600 },
      );
      const state = new State(work);
      let accepted = false;
      try {
        await collect(state, s, 0, 10000);
        if (state.cursor(s) !== s.size) {
          rejectedIncomplete++;
          continue;
        }
        const files = await fs.readdir(path.join(work, "outbox/ready"));
        const manifests = [];
        let bytes = 0,
          decoded = 0,
          events = 0,
          users = 0,
          tools = 0;
        for (const file of files) {
          const m = JSON.parse(
            await fs.readFile(path.join(work, "outbox/ready", file), "utf8"),
          );
          const b = Batch.parse(m.payload);
          bytes += compressBatch(b).length;
          decoded += Buffer.byteLength(JSON.stringify(b));
          events += b.events.length;
          users += b.events.filter((e) => e.kind === "user").length;
          tools += b.events.filter((e) => e.kind === "tool_call").length;
          manifests.push(file);
        }
        if (
          !users ||
          !tools ||
          selected.length >= 8 ||
          wireBytes + bytes > cap ||
          decodedBytes + decoded > 30_000_000
        ) {
          rejectedBudget++;
          continue;
        }
        selected.push({
          source: s,
          work,
          bytes,
          decoded,
          events,
          users,
          tools,
          batches: manifests.length,
        });
        wireBytes += bytes;
        decodedBytes += decoded;
        accepted = true;
      } catch {
        rejectedLarge++;
      } finally {
        state.close();
        if (!accepted) await fs.rm(work, { recursive: true, force: true });
      }
    }
    const plan = {
      createdAt: until.toISOString(),
      since,
      until: until.toISOString(),
      cap,
      wireBytes,
      decodedBytes,
      excludedSubagents,
      excludedActive,
      selected,
      scanned: list.length,
      rejectedLarge,
      rejectedIncomplete,
      rejectedBudget,
    };
    await fs.writeFile(
      path.join(root, "plan.json"),
      JSON.stringify(plan, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        scanned: plan.scanned,
        selected: selected.length,
        wireBytes,
        decodedBytes,
        excludedSubagents,
        excludedActive,
        events: selected.reduce((n, s) => n + s.events, 0),
        rejectedLarge,
        rejectedIncomplete,
        rejectedBudget,
        since,
        until: plan.until,
      }),
    );
  } else {
    const plan = JSON.parse(
      await fs.readFile(path.join(root, "plan.json"), "utf8"),
    );
    if (plan.wireBytes > cap) throw new Error("Pilot budget exceeded");
    const token = execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        `com.agent-observatory.atlas-collector:${config.url}:${config.deviceId || "pending"}`,
        "-a",
        os.userInfo().username,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const ledgerPath = path.join(root, "delivery.json");
    let ledger = { requests: 0, requestBytes: 0 };
    try {
      ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    let sent = 0,
      requests = ledger.requests,
      requestBytes = ledger.requestBytes;
    let acknowledged = 0;
    for (const item of plan.selected) {
      const state = new State(item.work);
      try {
        // Normal collector delivery: server validation/masking, hash ACK, bounded retries.
        while (
          Number(
            state.db
              .prepare(
                "SELECT count(*) AS n FROM batches WHERE status='pending'",
              )
              .get()!.n,
          ) > 0
        ) {
          const count = await sendPending(
            state,
            config,
            token,
            async (input, init) => {
              if (init?.method === "POST") {
                requests++;
                requestBytes +=
                  init.body instanceof Uint8Array
                    ? init.body.byteLength
                    : Buffer.byteLength(String(init.body));
                if (requestBytes > cap)
                  throw new Error("Request budget exceeded");
              }
              await fs.writeFile(
                ledgerPath,
                JSON.stringify({ requests, requestBytes }),
                { mode: 0o600 },
              );
              const response = await fetch(input, init);
              console.log(
                JSON.stringify({ request: requests, status: response.status }),
              );
              return response;
            },
          );
          sent += count;
          if (!count) throw new Error("Delivery deferred; retry later");
          console.log(
            JSON.stringify({ acknowledged: sent, requests, requestBytes }),
          );
        }
        if (
          Number(
            state.db
              .prepare(
                "SELECT count(*) AS n FROM batches WHERE status!='acknowledged'",
              )
              .get()!.n,
          )
        )
          throw new Error("Blocked batch");
        acknowledged += Number(
          state.db
            .prepare(
              "SELECT count(*) AS n FROM batches WHERE status='acknowledged'",
            )
            .get()!.n,
        );
      } finally {
        state.close();
      }
    }
    const receipt = {
      completedAt: new Date().toISOString(),
      sessions: plan.selected.length,
      acknowledged,
      requests,
      requestBytes,
      plannedWireBytes: plan.wireBytes,
    };
    await fs.writeFile(
      path.join(root, "receipt.json"),
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(receipt));
  }
}
main().catch((e) => {
  console.error("Pilot stopped:", e instanceof Error ? e.name : "Error");
  process.exitCode = 1;
});
