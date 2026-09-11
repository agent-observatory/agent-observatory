#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  initialize,
  State,
  sources,
  allowed,
  collect,
  recover,
  sendPending,
  acquire,
  type Config,
} from "./core.js";
const root =
  process.env.ATLAS_HOME || path.join(os.homedir(), ".agent-session-atlas");
const configFile = path.join(root, "config.json");
const label = "com.agent-observatory.atlas-collector";
const args = process.argv.slice(2);
const cmd = args[0] || "status";
function option(key: string) {
  const i = args.indexOf("--" + key);
  return i < 0 ? undefined : args[i + 1];
}
async function config(): Promise<Config> {
  return JSON.parse(await fs.readFile(configFile, "utf8"));
}
async function save(c: Config) {
  await fs.writeFile(configFile + ".tmp", JSON.stringify(c, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.rename(configFile + ".tmp", configFile);
}
function key(c: Config) {
  return `${label}:${c.url}:${c.deviceId || "pending"}`;
}
function token(c: Config) {
  try {
    return execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        key(c),
        "-a",
        os.userInfo().username,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}
function storeToken(c: Config, value: string) {
  execFileSync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-s",
      key(c),
      "-a",
      os.userInfo().username,
      "-w",
      value,
    ],
    { stdio: "ignore" },
  );
}
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
async function install() {
  if (process.platform !== "darwin")
    throw new Error("현재 setup은 macOS를 지원합니다");
  await initialize(root);
  let c: Config;
  try {
    c = await config();
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    c = {
      url: "https://agent-session-atlas.vercel.app",
      sourceHome: path.join(os.homedir(), ".codex"),
      exclude: [],
      include: [],
      paused: false,
    };
    await save(c);
  }
  const dir = path.join(root, "versions/0.2.0");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const bundle = fileURLToPath(import.meta.url);
  await fs.copyFile(bundle, path.join(dir, "cli.js"));
  await fs.writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  const link = path.join(root, "current");
  await fs.symlink(dir, link + ".new");
  await fs.rename(link + ".new", link);
  const node = await fs.realpath(process.execPath);
  const script = path.join(root, "current/cli.js");
  const plist = path.join(
    os.homedir(),
    "Library/LaunchAgents",
    label + ".plist",
  );
  await fs.mkdir(path.dirname(plist), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${esc(node)}</string><string>${esc(script)}</string><string>sync</string><string>--scheduled</string></array><key>StartInterval</key><integer>1800</integer><key>RunAtLoad</key><false/><key>EnvironmentVariables</key><dict><key>ATLAS_HOME</key><string>${esc(root)}</string></dict><key>StandardOutPath</key><string>${esc(path.join(root, "collector.log"))}</string><key>StandardErrorPath</key><string>${esc(path.join(root, "collector-error.log"))}</string></dict></plist>`;
  await fs.writeFile(plist, xml, { mode: 0o600 });
  try {
    execFileSync(
      "launchctl",
      ["bootout", `gui/${process.getuid!()}/${label}`],
      { stdio: "ignore" },
    );
  } catch {}
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid!()}`, plist], {
    stdio: "pipe",
  });
  console.log("Collector 0.2.0 설치 완료 · 30분 스케줄러 등록");
  console.log("계정 연결: " + node + " " + script + " connect");
}
async function connect() {
  const c = await config();
  const res = await fetch(c.url + "/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "error",
  });
  if (!res.ok) throw new Error(`연결 시작 실패 HTTP ${res.status}`);
  const d = (await res.json()) as any;
  console.log(
    "브라우저에서 로그인 후 기기를 연결하세요: " + d.verification_url,
  );
  console.log("연결 코드: " + d.user_code);
  const until = Date.now() + 600000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await fetch(c.url + "/api/devices/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: d.device_code }),
      redirect: "error",
    });
    if (r.status === 202) continue;
    if (!r.ok) throw new Error(`기기 연결 실패 HTTP ${r.status}`);
    const result = (await r.json()) as any;
    c.deviceId = result.device_id;
    storeToken(c, result.token);
    await save(c);
    console.log("계정 연결 완료. sync로 기존 기록을 전송할 수 있습니다.");
    return;
  }
  throw new Error("연결 시간이 만료되었습니다");
}
async function sync() {
  const c = await config();
  if (c.paused && args.includes("--scheduled")) return;
  const auth = token(c);
  if (!auth) {
    console.log("계정 연결 대기 · 전송 없음");
    return;
  }
  const unlock = await acquire(root);
  if (!unlock) return;
  const state = new State(root);
  try {
    await recover(state);
    let batches = 0;
    // Send recovered pending data before discovering more work.
    let sent = await sendPending(state, c, auth);
    for (const s of await sources(c.sourceHome)) {
      if (
        !allowed(s.project, c) ||
        (c.since && (!s.startedAt || s.startedAt < c.since)) ||
        (c.until && (!s.startedAt || s.startedAt > c.until))
      )
        continue;
      let cursor = state.cursor(s);
      if (cursor === null) {
        const url = new URL(c.url + "/api/checkpoint");
        url.searchParams.set("session_id", s.sessionId);
        url.searchParams.set("generation", s.generation);
        const r = await fetch(url, {
          headers: { authorization: `Bearer ${auth}` },
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        });
        if (!r.ok) throw new Error(`서버 접수 대조 실패 HTTP ${r.status}`);
        const ck = (await r.json()) as any;
        cursor = Math.min(Number(ck.offset) || 0, s.size);
        state.checkpoint(s, cursor);
      }
      if (s.size > cursor) {
        try {
          batches += await collect(state, s, cursor, 20 - batches);
        } catch {
          // A malformed or oversized source must not prevent later sources
          // from being collected. Keep the diagnostic free of source content.
          console.error("소스 처리 실패 · 원본 보존 · 다음 소스로 계속합니다");
        }
      }
      if (batches >= 20) break;
    }
    sent += await sendPending(state, c, auth);
    console.log(`전송 완료 ${sent}개 배치 · 새 대기 ${batches}개`);
  } finally {
    state.close();
    await unlock();
  }
}
async function main() {
  if (cmd === "setup" || cmd === "update") {
    await install();
    return;
  }
  await initialize(root);
  if (cmd === "connect") {
    await connect();
    return;
  }
  if (cmd === "pause" || cmd === "resume") {
    const c = await config();
    c.paused = cmd === "pause";
    await save(c);
    console.log(c.paused ? "동기화 중지" : "동기화 재개");
    return;
  }
  if (cmd === "configure") {
    const c = await config();
    if (option("include")) c.include = option("include")!.split(",");
    if (option("exclude")) c.exclude = option("exclude")!.split(",");
    for (const k of ["since", "until"] as const)
      if (option(k)) {
        if (Number.isNaN(Date.parse(option(k)!)))
          throw new Error("날짜 형식 오류");
        c[k] = new Date(option(k)!).toISOString();
      }
    if (args.includes("--all")) {
      c.include = [];
      delete c.since;
      delete c.until;
    }
    await save(c);
    console.log("수집 범위 설정 완료. inventory로 건수와 용량을 확인하세요.");
    return;
  }
  if (cmd === "sync") {
    await sync();
    return;
  }
  if (cmd === "inventory") {
    const c = await config();
    const list = (await sources(c.sourceHome)).filter(
      (s) =>
        allowed(s.project, c) &&
        (!c.since || (!!s.startedAt && s.startedAt >= c.since)) &&
        (!c.until || (!!s.startedAt && s.startedAt <= c.until)),
    );
    console.log(
      JSON.stringify(
        {
          sessions: list.length,
          bytes: list.reduce((n, s) => n + s.size, 0),
          projects: new Set(list.map((s) => s.project)).size,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === "status" || cmd === "doctor") {
    const c = await config();
    const state = new State(root);
    try {
      console.log(
        JSON.stringify(
          {
            version: "0.2.0",
            installed: true,
            connected: !!token(c),
            paused: c.paused,
            intervalMinutes: 30,
            node: process.version,
            batches: state.db
              .prepare(
                "SELECT status,count(*) AS count FROM batches GROUP BY status",
              )
              .all(),
          },
          null,
          2,
        ),
      );
    } finally {
      state.close();
    }
    return;
  }
  if (cmd === "uninstall") {
    try {
      execFileSync(
        "launchctl",
        ["bootout", `gui/${process.getuid!()}/${label}`],
        { stdio: "ignore" },
      );
    } catch {}
    await fs
      .unlink(path.join(os.homedir(), "Library/LaunchAgents", label + ".plist"))
      .catch(() => {});
    await fs.unlink(path.join(root, "current")).catch(() => {});
    console.log("자동 실행 해제. 설정·접수증·대기 기록은 보존했습니다.");
    return;
  }
  throw new Error(
    "명령: setup · connect · inventory · configure · sync · status · doctor · pause · resume · update · uninstall",
  );
}
main().catch(() => {
  console.error(
    "Collector 작업 실패. 원본과 대기 파일은 보존했습니다. status/doctor로 상태를 확인하세요.",
  );
  process.exitCode = 1;
});
