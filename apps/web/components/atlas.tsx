"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "./select";
import { NavigationIcon } from "./navigation-icon";
import { signIn, signOut } from "next-auth/react";
import { type AtlasBatch } from "@agent-observatory/contracts";
import { codexEventWithImages } from "@agent-observatory/contracts/images";
import {
  aiPendingLabel,
  formatAiProvenance,
  normalizedProvider,
  providerName,
} from "../lib/ai-provenance";
type Settings = {
  language: "ko" | "en";
  theme: "dark" | "light" | "system";
  masking: boolean;
  provider: "free" | "openrouter" | "custom";
  endpoint: string;
  model: string;
};
type FreeCandidate = { provider: string; model: string; endpoint: string };
type User = {
  id: string;
  name: string;
  guest: boolean;
  settings: Settings;
  has_key: boolean;
};
type Session = {
  id: string;
  project: string;
  source_id: string;
  revision: number;
  first_received: string;
  expires_at: string;
  status?: string;
  metrics?: Record<string, number | null>;
  candidate_count?: number;
};
type Job = {
  id: string;
  scope: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  created_at: string;
};
const defaults: Settings = {
  language: "ko",
  theme: "dark",
  masking: true,
  provider: "free",
  endpoint: "",
  model: "auto",
};
const collectorCommands = {
  connect: "node ~/.agent-session-atlas/current/cli.js connect",
  inventory: "node ~/.agent-session-atlas/current/cli.js inventory",
  sync: "node ~/.agent-session-atlas/current/cli.js sync",
} as const;
const settingsFrom = (value?: Partial<Settings>): Settings => ({
  ...defaults,
  ...value,
  provider: normalizedProvider(value?.provider) as Settings["provider"],
});
async function api(url: string, body?: unknown, method?: string) {
  const r = await fetch(url, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text();
    let message = text;
    try {
      message = JSON.parse(text).error || text;
    } catch {}
    throw new Error(message || `HTTP ${r.status}`);
  }
  return r.json();
}
const digest = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
type AtlasView = "sessions" | "jobs" | "settings";

export function Atlas({ view }: { view: AtlasView }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null),
    [settings, setSettings] = useState<Settings>(defaults),
    [savedSettings, setSavedSettings] = useState<Settings>(defaults),
    [sessions, setSessions] = useState<Session[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [summaries, setSummaries] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<any>(null),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [key, setKey] = useState(""),
    [pair, setPair] = useState(""),
    [copiedCommand, setCopiedCommand] = useState<string | null>(null),
    [freeCandidates, setFreeCandidates] = useState<FreeCandidate[]>([]),
    [ready, setReady] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const userIdRef = useRef<string | null | undefined>(undefined);
  const loadRequestRef = useRef(0);
  const t = (ko: string, en: string) => (settings.language === "ko" ? ko : en);
  const apply = (s: Settings) => {
    setSettings(s);
    localStorage.setItem("atlas-theme", s.theme);
    localStorage.setItem("atlas-language", s.language);
    document.documentElement.lang = s.language;
    document.documentElement.dataset.theme =
      s.theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : s.theme;
  };
  const load = useCallback(async () => {
    const request = ++loadRequestRef.current;
    const me = await api("/api/me");
    if (request !== loadRequestRef.current) return null;
    const nextUser = (me.user || null) as User | null;
    const nextUserId = nextUser?.id || null;
    const previousUserId = userIdRef.current;
    const identityChanged = previousUserId !== nextUserId;

    if (identityChanged) {
      setSessions([]);
      setJobs([]);
      setSummaries([]);
      setSelected([]);
      setDetail(null);
      setKey("");
      if (!nextUser && previousUserId) {
        const url = new URL(location.href);
        url.searchParams.delete("session");
        history.replaceState(null, "", url.pathname + url.search);
      }

      const nextSettings: Settings = nextUser
        ? settingsFrom(nextUser.settings)
        : {
            ...defaults,
            language:
              localStorage.getItem("atlas-language") === "en" ? "en" : "ko",
            theme: (["dark", "light", "system"] as const).includes(
              localStorage.getItem("atlas-theme") as Settings["theme"],
            )
              ? (localStorage.getItem("atlas-theme") as Settings["theme"])
              : "dark",
          };
      apply(nextSettings);
      setSavedSettings(nextSettings);
      userIdRef.current = nextUserId;
    }

    setUser(nextUser);
    setFreeCandidates(me.freeCandidates || []);
    if (nextUser) {
      const data = await api("/api/sessions");
      if (request !== loadRequestRef.current) return null;
      setSessions(data.sessions);
      setJobs(data.jobs);
      setSummaries(data.summaries);
    } else {
      setSessions([]);
      setJobs([]);
      setSummaries([]);
      setSelected([]);
      setDetail(null);
    }
    return nextUser;
  }, []);
  useEffect(() => {
    load()
      .then(async (currentUser) => {
        if (currentUser) {
          const sessionId = new URLSearchParams(location.search).get("session");
          if (sessionId) {
            const sessionDetail = await api("/api/sessions/" + sessionId);
            setDetail(sessionDetail);
          }
        }
        setPair(new URLSearchParams(location.search).get("connect") || "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    let refreshTimer: number | undefined;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () => load().catch((e) => setError(e.message)),
        0,
      );
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load, ready]);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(timer);
  }, [user?.id, load]);
  useEffect(() => {
    if (!detail?.session.id) return;
    let active = true;
    const id = detail.session.id;
    const timer = setInterval(() => {
      api("/api/sessions/" + id)
        .then((next) => {
          if (active) setDetail(next);
        })
        .catch(() => {});
    }, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [detail?.session.id]);
  useEffect(() => {
    if (!detail?.session.id) return;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail?.session.id]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => {
      if (settings.theme === "system")
        document.documentElement.dataset.theme = media.matches
          ? "dark"
          : "light";
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [settings.theme]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  async function analyze(
    scope: "all" | "selected" | "single",
    ids = selected,
    force = false,
  ) {
    await api("/api/analyses", {
      scope,
      sessionIds: ids,
      requestKey: crypto.randomUUID(),
      force,
    });
    setMessage(
      t(
        "분석을 시작했습니다. 완료되는 결과부터 확인할 수 있어요.",
        "Analysis queued. Results appear as sessions finish.",
      ),
    );
    await load();
    if (detail?.session.id)
      setDetail(await api("/api/sessions/" + detail.session.id));
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      if (!user) {
        await api("/api/guest", {});
        await load();
      }
      let count = 0;
      for (const file of Array.from(files)) {
        if (file.size > 40 * 1024 * 1024)
          throw new Error(
            t(
              "40MB를 넘는 파일은 Collector로 가져오세요.",
              "Use the Collector for files larger than 40 MB.",
            ),
          );
        const text = await file.text();
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {}
        if (raw && typeof raw === "object" && "schema_version" in raw) {
          await api("/api/ingest", raw);
          count++;
          continue;
        }
        const lines = text.split("\n");
        const metadata = JSON.parse(lines[0]);
        if (metadata.type !== "session_meta" || !metadata.payload?.cwd)
          throw new Error(
            t(
              "Codex 세션 JSONL 파일을 선택하세요.",
              "Choose a Codex session JSONL file.",
            ),
          );
        const generation = await digest(lines[0]);
        const ck = await api(
          `/api/checkpoint?session_id=${encodeURIComponent(metadata.payload.id)}&generation=${generation}`,
        ).catch((e) => {
          if (!user || user.guest) return { offset: 0 };
          throw e;
        });
        let offset = 0,
          start = ck.offset,
          events: any[] = [];
        const flush = async (end: number) => {
          if (end <= start) return;
          const body: AtlasBatch = {
            schema_version: 1,
            batch_id: crypto.randomUUID(),
            source: "codex",
            session_id: metadata.payload.id,
            project: metadata.payload.cwd,
            generation,
            start_offset: start,
            end_offset: end,
            events,
          };
          await api("/api/ingest", body);
          start = end;
          events = [];
        };
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (i === lines.length - 1 && !line) break;
          const next =
            offset +
            new TextEncoder().encode(line + (i < lines.length - 1 ? "\n" : ""))
              .length;
          if (offset >= ck.offset && line) {
            const event = await codexEventWithImages(
              JSON.parse(line),
              await digest(generation + ":" + offset),
            );
            if (event) {
              if (JSON.stringify(event).length > 150000)
                throw new Error(
                  t(
                    "큰 이벤트는 Collector에서 확인하세요.",
                    "This event exceeds the import limit.",
                  ),
                );
              if (
                new TextEncoder().encode(JSON.stringify([...events, event]))
                  .length > 750000 ||
                events.length >= 300
              )
                await flush(offset);
              events.push(event);
            }
          }
          offset = next;
        }
        await flush(offset);
        count++;
        setMessage(
          `${count}/${files.length} ${t("파일 가져오는 중", "files imported")}`,
        );
      }
      await load();
      setMessage(
        t(
          "가져오기 완료. 전체 세션 지금 분석을 눌러 시작하세요.",
          "Import complete. Start analyzing all sessions.",
        ),
      );
    });
  }
  const visible = sessions.filter((s) =>
    `${s.project} ${s.source_id}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const sum = (k: string) =>
    sessions.reduce((n, s) => n + (Number(s.metrics?.[k]) || 0), 0);
  const complete = sessions.filter((s) => s.status === "completed").length;
  const projectAggregates = Array.from(
    sessions
      .reduce((groups, session) => {
        const current = groups.get(session.project) || {
          project: session.project,
          sessions: 0,
          toolCalls: 0,
        };
        current.sessions += 1;
        current.toolCalls += Number(session.metrics?.toolCalls) || 0;
        groups.set(session.project, current);
        return groups;
      }, new Map<string, { project: string; sessions: number; toolCalls: number }>())
      .values(),
  ).sort((a, b) => b.toolCalls - a.toolCalls || b.sessions - a.sessions);
  const settingsDirty =
    JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const status = (s: string) =>
    ({
      queued: t("대기", "Queued"),
      running: t("분석 중", "Running"),
      completed: t("완료", "Completed"),
      failed: t("실패", "Failed"),
      partial: t("일부 실패", "Partial"),
      expired: t("만료", "Expired"),
      dispatch_failed: t("시작 실패", "Dispatch failed"),
    })[s] || t("미분석", "Not analyzed");
  const setSessionUrl = (sessionId?: string) => {
    const url = new URL(location.href);
    if (sessionId) url.searchParams.set("session", sessionId);
    else url.searchParams.delete("session");
    history.replaceState(null, "", url.pathname + url.search);
  };
  const focusEvidence = (id: string) => {
    const evidence = document.getElementById(`evidence-${id}`);
    if (!(evidence instanceof HTMLDetailsElement)) return;
    evidence.open = true;
    evidence.classList.remove("evidence-focus");
    requestAnimationFrame(() => {
      evidence.classList.add("evidence-focus");
      evidence.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(
        () => evidence.classList.remove("evidence-focus"),
        1800,
      );
    });
  };
  const copyCommand = async (name: string, command: string) => {
    setError("");
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(name);
      window.setTimeout(
        () =>
          setCopiedCommand((current) => (current === name ? null : current)),
        1800,
      );
    } catch {
      setError(t("명령을 복사하지 못했습니다.", "Could not copy command."));
    }
  };
  return (
    <div className="app">
      <aside>
        <div className="product-identity">
          <Link className="brand" href="/sessions">
            <span>
              Atlas<small>Agent Observatory</small>
            </span>
          </Link>
          <div className="product-meta">
            <span>
              <span className="dot" />
              Seoul · icn1
            </span>
            <span>v0.2.0</span>
          </div>
        </div>
        <div className="workspace">
          <span className="avatar">
            {user?.name?.[0]?.toUpperCase() || "A"}
          </span>
          <span>
            {user?.guest
              ? t("방문자 공간", "Guest workspace")
              : user?.name || t("개인 워크스페이스", "Personal workspace")}
          </span>
        </div>
        <div className="aside-account">
          {user && !user.guest ? (
            <button onClick={() => signOut()}>
              {t("로그아웃", "Sign out")}
            </button>
          ) : (
            <button
              onClick={() => signIn("github", { redirectTo: location.href })}
            >
              {t("GitHub로 시작하기", "Continue with GitHub")} ↗
            </button>
          )}
        </div>
        <nav>
          {[
            ["sessions", "/sessions", t("세션", "Sessions")],
            ["jobs", "/analyses", t("분석 기록", "Analyses")],
            ["settings", "/settings", t("설정", "Settings")],
          ].map(([id, href, label]) => (
            <Link
              className={`nav-link ${view === id ? "active" : ""}`}
              key={id}
              aria-current={view === id ? "page" : undefined}
              href={href}
            >
              <NavigationIcon name={id as "sessions" | "jobs" | "settings"} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main>
        <header>
          <span>
            {t("개인 공간", "Personal workspace")} /{" "}
            <strong>
              {view === "settings"
                ? t("설정", "Settings")
                : view === "jobs"
                  ? t("분석 기록", "Analyses")
                  : t("세션", "Sessions")}
            </strong>
          </span>
          <button
            className="icon-button"
            aria-label={t("테마 전환", "Toggle theme")}
            onClick={() =>
              apply({
                ...settings,
                theme: settings.theme === "dark" ? "light" : "dark",
              })
            }
          >
            {settings.theme === "dark" ? "☀" : "☾"}
          </button>
        </header>
        <div className="content">
          <div className="title-row">
            <div>
              <h1>
                {view === "settings"
                  ? t("설정", "Settings")
                  : view === "jobs"
                    ? t("분석 기록", "Analysis history")
                    : t("세션 검토", "Session review")}
              </h1>
              <p className="muted">
                {view === "settings"
                  ? t(
                      "언어부터 분석 모델까지 직접 선택하세요.",
                      "Choose your language, appearance, and analysis model.",
                    )
                  : t(
                      "세션을 선택해 발견 사항과 원문 근거를 함께 검토하세요.",
                      "Select a session to review findings alongside source evidence.",
                    )}
              </p>
            </div>
            {view === "sessions" && (
              <button
                className="primary"
                disabled={busy || !sessions.length}
                onClick={() => run(() => analyze("all"))}
              >
                {t("전체 세션 지금 분석", "Analyze all sessions")} ↗
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {message && (
            <div role="status" className="notice">
              {message}
            </div>
          )}
          {pair && (
            <section className="panel">
              <h2>{t("Collector 연결", "Connect Collector")}</h2>
              <p>
                {t(
                  "내 PC에 표시된 코드와 일치하는지 확인하세요.",
                  "Check this code matches the one on your computer.",
                )}
              </p>
              <code>{pair}</code>{" "}
              <button
                disabled={busy || !user || user.guest}
                onClick={() =>
                  run(async () => {
                    await api("/api/devices/approve", { code: pair });
                    setPair("");
                    history.replaceState(null, "", "/");
                    setMessage(
                      t("기기가 연결되었습니다.", "Device connected."),
                    );
                  })
                }
              >
                {t("이 기기 연결", "Connect this device")}
              </button>
              {(!user || user.guest) && (
                <button
                  onClick={() =>
                    signIn("github", { redirectTo: location.href })
                  }
                >
                  {t("GitHub 가입·로그인", "Sign up / sign in with GitHub")}
                </button>
              )}
            </section>
          )}
          {view === "sessions" && (
            <>
              {(!user || user.guest) && (
                <section className="welcome">
                  <div>
                    <h2>
                      {t("내 기록을 이어서 보려면", "Keep your work together")}
                    </h2>
                    <p>
                      {t(
                        "GitHub 계정으로 가입하면 기존 세션 가져오기와 자동 동기화를 사용할 수 있어요.",
                        "Sign up with GitHub to import your history and sync future sessions.",
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      signIn("github", { redirectTo: location.href })
                    }
                  >
                    {t("GitHub로 가입·로그인", "Sign up / sign in with GitHub")}{" "}
                    ↗
                  </button>
                </section>
              )}
              <div className="stats">
                {[
                  [
                    t("전체 세션", "Sessions"),
                    sessions.length,
                    t("보관 중인 기록", "Available sessions"),
                  ],
                  [
                    t("분석 완료", "Analyzed"),
                    complete,
                    `${sessions.length ? Math.round((complete / sessions.length) * 100) : 0}% ${t("완료", "complete")}`,
                  ],
                  [
                    t("도구 호출", "Tool calls"),
                    sum("toolCalls").toLocaleString(),
                    t("관측된 실행", "Observed calls"),
                  ],
                  [
                    t("개선 후보", "Candidates"),
                    sessions.reduce((n, s) => n + (s.candidate_count || 0), 0),
                    t("근거를 보고 판단하세요", "Review the evidence"),
                  ],
                ].map(([label, value, note]) => (
                  <div className="stat" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    {t("세션 목록", "Sessions")} <small>{visible.length}</small>
                  </h2>
                  <div className="actions">
                    <input
                      aria-label={t("세션 검색", "Search sessions")}
                      placeholder={t(
                        "프로젝트·세션 검색",
                        "Search projects or sessions",
                      )}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <label className="button upload">
                      ＋ {t("기록 가져오기", "Import sessions")}
                      <input
                        type="file"
                        multiple
                        accept=".jsonl,.json"
                        disabled={busy}
                        onChange={(e) => {
                          upload(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                {selected.length > 0 && (
                  <div className="selection">
                    {selected.length} {t("개 선택", "selected")}{" "}
                    <button
                      disabled={busy}
                      onClick={() => run(() => analyze("selected"))}
                    >
                      {t("선택 세션 분석", "Analyze selected")}
                    </button>
                    <button onClick={() => setSelected([])}>
                      {t("선택 해제", "Clear")}
                    </button>
                  </div>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label={t(
                              "검색 결과 전체 선택",
                              "Select filtered sessions",
                            )}
                            checked={
                              !!visible.length &&
                              visible.every((s) => selected.includes(s.id))
                            }
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? visible.map((s) => s.id)
                                  : [],
                              )
                            }
                          />
                        </th>
                        <th>{t("프로젝트 / 세션", "Project / session")}</th>
                        <th>{t("접수일", "Imported")}</th>
                        <th>{t("도구 호출", "Tool calls")}</th>
                        <th>{t("개선 후보", "Candidates")}</th>
                        <th>{t("분석 상태", "Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => (
                        <tr
                          key={s.id}
                          className={
                            detail?.session.id === s.id ? "selected-row" : ""
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={s.source_id}
                              checked={selected.includes(s.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, s.id]
                                    : selected.filter((x) => x !== s.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <button
                              className="session-link"
                              onClick={() =>
                                run(async () => {
                                  setSessionUrl(s.id);
                                  setDetail(await api("/api/sessions/" + s.id));
                                })
                              }
                            >
                              {s.project.split("/").filter(Boolean).at(-1)}
                              <small>{s.source_id}</small>
                            </button>
                          </td>
                          <td>
                            {new Date(s.first_received).toLocaleDateString(
                              settings.language,
                            )}
                          </td>
                          <td>{s.metrics?.toolCalls ?? "—"}</td>
                          <td>{s.candidate_count ?? "—"}</td>
                          <td>
                            <span className={"badge " + (s.status || "")}>
                              {status(s.status || "")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!visible.length && (
                  <div className="empty">
                    <span>◈</span>
                    <h3>
                      {ready
                        ? t("첫 세션을 가져오세요", "Import your first session")
                        : t("불러오는 중", "Loading")}
                    </h3>
                    <p>
                      {t(
                        "Codex JSONL 파일을 올리거나, Collector를 연결해 기존 기록을 가져오세요.",
                        "Upload Codex JSONL files or connect the Collector to import your history.",
                      )}
                    </p>
                    <p className="muted">
                      {t(
                        "업로드한 파일은 기본 마스킹 후 저장됩니다.",
                        "Sensitive information is masked by default.",
                      )}
                    </p>
                  </div>
                )}
              </section>
              <section className="panel aggregate-panel">
                <div className="section-heading">
                  <h2>{t("프로젝트 집계", "Project overview")}</h2>
                  <small>{projectAggregates.length}</small>
                </div>
                {projectAggregates.length ? (
                  <div className="table-scroll">
                    <table className="aggregate-table">
                      <thead>
                        <tr>
                          <th>{t("프로젝트", "Project")}</th>
                          <th>{t("세션", "Sessions")}</th>
                          <th>{t("도구 호출", "Tool calls")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectAggregates.map((project) => (
                          <tr key={project.project}>
                            <td>
                              {project.project
                                .split("/")
                                .filter(Boolean)
                                .at(-1) || project.project}
                            </td>
                            <td>{project.sessions}</td>
                            <td>{project.toolCalls.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">
                    {t("집계할 세션이 없습니다.", "No sessions to aggregate.")}
                  </p>
                )}
              </section>
              {detail && (
                <section
                  className="panel detail"
                  id={`session-${detail.session.id}`}
                  ref={detailRef}
                >
                  <div className="section-heading">
                    <h2>{detail.session.project.split("/").at(-1)}</h2>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            analyze(
                              "single",
                              [detail.session.id],
                              detail.results.some(
                                (result: any) => result.status === "completed",
                              ),
                            ),
                          )
                        }
                      >
                        {detail.results.some(
                          (result: any) => result.status === "completed",
                        )
                          ? t("이 세션 다시 분석", "Analyze this session again")
                          : t("이 세션 지금 분석", "Analyze this session")}
                      </button>
                      <button
                        onClick={() => {
                          setDetail(null);
                          setSessionUrl();
                        }}
                      >
                        {t("닫기", "Close")}
                      </button>
                    </div>
                  </div>
                  <p className="muted">
                    {detail.session.source_id} · revision{" "}
                    {detail.session.revision}
                  </p>
                  {detail.results.length ? (
                    detail.results.map((r: any) => (
                      <article key={r.id}>
                        <span className={"badge " + r.status}>
                          {status(r.status)}
                        </span>
                        {r.error && <p className="muted">{r.error}</p>}
                        {r.result && (
                          <>
                            <p>
                              <strong>
                                {r.result.ai
                                  ? formatAiProvenance(
                                      r.result,
                                      settings.language,
                                    )
                                  : r.status === "failed"
                                    ? t(
                                        "AI 설명 생성 실패",
                                        "AI explanation failed",
                                      )
                                    : aiPendingLabel(settings.language)}
                              </strong>
                              {r.result.cost != null && (
                                <span className="muted">
                                  {" "}
                                  · {t("비용", "Cost")}: {r.result.cost}
                                </span>
                              )}
                            </p>
                            {!!r.result.ruleErrors?.length && (
                              <p className="muted">
                                {t(
                                  "일부 규칙을 평가하지 못했습니다. 저장된 지표와 나머지 근거를 확인하세요.",
                                  "Some rules could not be evaluated. Review the saved metrics and remaining evidence.",
                                )}
                              </p>
                            )}
                            <div className="result-summary">
                              <h3>{t("발견 사항", "Finding")}</h3>
                              <p>
                                {r.result.ai?.summary ||
                                  (r.status === "failed"
                                    ? t(
                                        "지표는 저장되었습니다. AI 설명은 다시 분석할 수 있습니다.",
                                        "Metrics are saved. You can retry the AI explanation.",
                                      )
                                    : t(
                                        "지표를 계산했습니다. AI 설명을 기다리는 중입니다.",
                                        "Metrics are ready. Waiting for AI explanation.",
                                      ))}
                              </p>
                            </div>
                            {!!r.result.metrics?.toolErrors && (
                              <p className="muted">
                                {t(
                                  "오류 지표는 출력에서 감지한 키워드 신호입니다. 실제 실패 횟수로 해석하지 말고 근거를 확인하세요.",
                                  "Error metrics count keyword signals in outputs, not confirmed failures. Review the evidence.",
                                )}
                              </p>
                            )}
                            {r.result.aiInput && (
                              <p className="muted">
                                {t(
                                  `지표·규칙은 전체 이벤트를 계산했습니다. AI 설명에는 ${r.result.aiInput.events}개 중 선별한 근거 ${r.result.aiInput.samples}개를 사용했습니다. 나머지 이벤트는 AI 설명에서 제외되었습니다.`,
                                  `Metrics and rules cover all events. The AI explanation uses ${r.result.aiInput.samples} selected evidence items from ${r.result.aiInput.events} events; remaining events were excluded from the AI explanation.`,
                                )}
                              </p>
                            )}
                            {!!r.result.imageInput?.occurrences && (
                              <p className="muted">
                                {t(
                                  `이미지 ${r.result.imageInput.occurrences}건은 위치·형식·해상도만 수집했습니다. 이미지 내용은 분석하지 않았습니다.`,
                                  `${r.result.imageInput.occurrences} image references include metadata only. Image content was not analyzed.`,
                                )}
                              </p>
                            )}
                            <div className="result-columns">
                              <div className="evidence-pane">
                                <h3>{t("근거", "Evidence")}</h3>
                                <div className="timeline">
                                  {r.result.timeline?.map((e: any) => (
                                    <details key={e.id} id={`evidence-${e.id}`}>
                                      <summary>
                                        <time>
                                          {e.timestamp
                                            ? new Date(
                                                e.timestamp,
                                              ).toLocaleTimeString(
                                                settings.language,
                                              )
                                            : "—"}
                                        </time>{" "}
                                        {e.name || e.kind}{" "}
                                        <small>{e.id.slice(0, 10)}</small>
                                      </summary>
                                      <pre>{e.text}</pre>
                                      {e.images?.map(
                                        (img: any, index: number) => (
                                          <p
                                            className="muted"
                                            key={`${img.sha256}-${index}`}
                                          >
                                            {img.mimeType} ·{" "}
                                            {img.width && img.height
                                              ? `${img.width} × ${img.height} · `
                                              : ""}
                                            {Math.ceil(img.bytes / 1024)} KB ·{" "}
                                            {t(
                                              "본문은 로컬 보관 · 미분석",
                                              "Content stays local · not analyzed",
                                            )}
                                          </p>
                                        ),
                                      )}
                                    </details>
                                  ))}
                                </div>
                                {Number(r.result.timelineTotal) >
                                  (r.result.timeline?.length || 0) && (
                                  <p className="muted timeline-note">
                                    {t(
                                      `전체 ${r.result.timelineTotal}개 중 ${r.result.timeline.length}개 표시`,
                                      `${r.result.timeline.length} of ${r.result.timelineTotal} events shown`,
                                    )}
                                  </p>
                                )}
                              </div>
                              <div>
                                <h3>{t("개선 방향", "Improvements")}</h3>
                                {r.result.ai?.suggestions?.map(
                                  (s: any, i: number) => (
                                    <div className="suggestion" key={i}>
                                      <p>{s.text}</p>
                                      <small className="evidence-links">
                                        {t("근거", "Evidence")}:{" "}
                                        {s.evidenceIds.map(
                                          (id: string, index: number) => (
                                            <span key={id}>
                                              {index > 0 && ", "}
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  focusEvidence(id)
                                                }
                                              >
                                                {id.slice(0, 10)}
                                              </button>
                                            </span>
                                          ),
                                        )}
                                      </small>
                                    </div>
                                  ),
                                )}
                                {r.result.candidates?.map(
                                  (c: any, i: number) => (
                                    <div className="suggestion" key={i}>
                                      <strong>
                                        {c.title} · {c.count}
                                      </strong>
                                      <small>
                                        {c.ruleId} v{c.version}
                                      </small>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </article>
                    ))
                  ) : (
                    <p>
                      {t(
                        "아직 분석하지 않은 세션입니다.",
                        "This session has not been analyzed.",
                      )}
                    </p>
                  )}
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            "이 세션과 분석 결과를 삭제할까요?",
                            "Delete this session and its analyses?",
                          ),
                        )
                      )
                        run(async () => {
                          await api(
                            "/api/sessions/" + detail.session.id,
                            undefined,
                            "DELETE",
                          );
                          setDetail(null);
                          setSessionUrl();
                          await load();
                        });
                    }}
                  >
                    {t("세션 삭제", "Delete session")}
                  </button>
                </section>
              )}
              <section className="collector">
                <div>
                  <h3>
                    {t(
                      "기록은 자동으로, 분석은 원할 때",
                      "Automatic sync. Analysis on your terms.",
                    )}
                  </h3>
                  <p>
                    {t(
                      "Collector는 PC당 하나. 30분마다 변경된 기록만 전송합니다.",
                      "One Collector per computer sends changed records every 30 minutes.",
                    )}
                  </p>
                </div>
                <button onClick={() => router.push("/settings")}>
                  {t("Collector 연결 안내", "Collector setup")} →
                </button>
              </section>
            </>
          )}
          {view === "jobs" && (
            <>
              <section className="panel">
                <h2>{t("최근 분석 작업", "Recent analyses")}</h2>
                {jobs.length ? (
                  jobs.map((j) => (
                    <div className="job" key={j.id}>
                      <div>
                        <strong>
                          {j.scope === "all"
                            ? t("전체 세션", "All sessions")
                            : j.scope === "single"
                              ? t("단일 세션", "Single session")
                              : t("선택 세션", "Selected sessions")}
                        </strong>
                        <small>
                          {new Date(j.created_at).toLocaleString(
                            settings.language,
                          )}
                        </small>
                      </div>
                      <progress
                        value={j.completed + j.failed}
                        max={j.total || 1}
                      />
                      <span>
                        {j.completed}/{j.total} · {t("실패", "failed")}{" "}
                        {j.failed}
                      </span>
                      <span className={"badge " + j.status}>
                        {status(j.status)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    {t(
                      "분석을 시작하면 진행 상태가 표시됩니다.",
                      "Start an analysis to see progress here.",
                    )}
                  </div>
                )}
              </section>
              <section className="panel">
                <h2>{t("30일 요약", "30-day summaries")}</h2>
                {summaries.length ? (
                  summaries.map((s: any) => (
                    <div className="job" key={s.session_id}>
                      <code>{s.session_id.slice(0, 8)}</code>
                      <span>
                        {t("도구 호출", "Tool calls")} {s.metrics.toolCalls}
                      </span>
                      <span>
                        {t("개선 후보", "Candidates")} {s.candidate_count}
                      </span>
                      <small>
                        {t("만료", "Expires")}{" "}
                        {new Date(s.expires_at).toLocaleDateString(
                          settings.language,
                        )}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    {t(
                      "분석 완료 후 집계 지표가 남습니다.",
                      "Aggregate metrics are saved after analysis.",
                    )}
                  </p>
                )}
              </section>
            </>
          )}
          {view === "settings" && (
            <>
              <section className="panel settings">
                <h2>{t("일반", "General")}</h2>
                <label>
                  {t("언어", "Language")}
                  <Select
                    label={t("언어", "Language")}
                    value={settings.language}
                    options={[
                      { value: "ko", label: "한국어" },
                      { value: "en", label: "English" },
                    ]}
                    onChange={(value) =>
                      apply({
                        ...settings,
                        language: value as Settings["language"],
                      })
                    }
                  />
                </label>
                <label>
                  {t("화면 모드", "Appearance")}
                  <Select
                    label={t("화면 모드", "Appearance")}
                    value={settings.theme}
                    options={[
                      { value: "dark", label: t("다크", "Dark") },
                      { value: "light", label: t("라이트", "Light") },
                      { value: "system", label: t("시스템", "System") },
                    ]}
                    onChange={(value) =>
                      apply({ ...settings, theme: value as Settings["theme"] })
                    }
                  />
                </label>
              </section>
              <section className="panel settings">
                <h2>{t("개인정보", "Privacy")}</h2>
                <label>
                  {t("민감정보 마스킹", "Mask sensitive information")}
                  <input
                    type="checkbox"
                    checked={settings.masking}
                    disabled={!user || user.guest}
                    onChange={(e) =>
                      setSettings({ ...settings, masking: e.target.checked })
                    }
                  />
                </label>
                <p className="muted">
                  {settings.masking
                    ? t(
                        "저장·분석 전에 API 키, 비밀번호, 이메일 등을 치환합니다.",
                        "Masks common API keys, passwords and email addresses before storage and analysis.",
                      )
                    : t(
                        "마스킹을 끄면 원문이 원격 저장소와 AI 제공자에게 전달됩니다.",
                        "Without masking, original text is sent to remote storage and the AI provider.",
                      )}
                </p>
                <p className="muted">
                  {t(
                    "상세 데이터 7일 · 집계 요약 30일 보관",
                    "Details retained for 7 days · aggregate summaries for 30 days",
                  )}
                </p>
              </section>
              <section className="panel settings">
                <h2>{t("AI 모델", "AI model")}</h2>
                <label>
                  Provider
                  <Select
                    label="Provider"
                    value={settings.provider}
                    options={[
                      {
                        value: "free",
                        label: t(
                          "Free tier · 자동 선택",
                          "Free tier · Auto select",
                        ),
                      },
                      { value: "openrouter", label: "OpenRouter · BYOK" },
                      { value: "custom", label: "Custom · OpenAI compatible" },
                    ]}
                    onChange={(value) => {
                      const provider = value as Settings["provider"];
                      setSettings({
                        ...settings,
                        provider,
                        endpoint:
                          provider === "free"
                            ? defaults.endpoint
                            : provider === "openrouter"
                              ? "https://openrouter.ai/api/v1"
                              : "",
                        model: provider === "free" ? defaults.model : "",
                      });
                    }}
                  />
                </label>
                {settings.provider === "free" ? (
                  <div>
                    <p className="muted">
                      {t(
                        "서버에 설정된 무료 후보를 위에서부터 순서대로 시도합니다. 목록은 연결 상태를 뜻하지 않습니다.",
                        "Configured free candidates are tried in order. This list does not indicate provider health.",
                      )}
                    </p>
                    {freeCandidates.length ? (
                      <ol className="model-candidates">
                        {freeCandidates.map((candidate, index) => (
                          <li
                            key={`${candidate.provider}:${candidate.model}:${candidate.endpoint}`}
                          >
                            <span>{index + 1}</span>
                            <strong>{candidate.model}</strong>
                            <small>{providerName(candidate.provider)}</small>
                          </li>
                        ))}
                      </ol>
                    ) : ready ? (
                      <p className="muted">
                        {t(
                          "서버에 무료 모델이 설정되어 있지 않습니다.",
                          "No free models are configured on the server.",
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <label>
                      Endpoint
                      <input
                        value={settings.endpoint}
                        disabled={settings.provider !== "custom"}
                        onChange={(e) =>
                          setSettings({ ...settings, endpoint: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Model
                      <input
                        value={settings.model}
                        onChange={(e) =>
                          setSettings({ ...settings, model: e.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                {settings.provider !== "free" && (
                  <label>
                    API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      placeholder={
                        user?.has_key
                          ? t(
                              "저장된 키 있음 · 변경할 때만 입력",
                              "Key saved · enter to replace",
                            )
                          : t("개인 API key", "Your API key")
                      }
                      onChange={(e) => setKey(e.target.value)}
                    />
                  </label>
                )}
                <p className="muted">
                  {t(
                    "기본 모델은 한 번에 1개씩 처리합니다. BYOK 요금은 개인 계정에 청구되며, 연결한 제공자의 데이터 정책이 적용됩니다.",
                    "The default model processes one request at a time. BYOK usage is charged to your provider account under its data policy.",
                  )}
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || !user || user.guest}
                    onClick={() =>
                      run(async () => {
                        const r = await api("/api/settings", {
                          ...settings,
                          ...(key ? { apiKey: key } : {}),
                        });
                        apply(r.settings);
                        setSavedSettings(r.settings);
                        setKey("");
                        await load();
                        setMessage(
                          t("설정을 저장했습니다.", "Settings saved."),
                        );
                      })
                    }
                  >
                    {t("계정 설정 저장", "Save account settings")}
                  </button>
                  <button
                    disabled={busy || !user || user.guest || settingsDirty}
                    onClick={() =>
                      run(async () => {
                        const result = await api("/api/settings/test", {});
                        setMessage(
                          t(
                            `저장된 ${formatAiProvenance(result, "ko")} 연결을 확인했습니다. 합성 요청만 사용했으며 세션 데이터는 전송하지 않았습니다.`,
                            `Saved ${formatAiProvenance(result, "en")} connection works. A synthetic request was used; no session data was sent.`,
                          ),
                        );
                      })
                    }
                  >
                    {t("저장된 AI 연결 테스트", "Test saved AI connection")}
                  </button>
                  {user?.has_key && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api("/api/settings", {
                            ...settings,
                            removeKey: true,
                          });
                          await load();
                          setMessage(t("키를 삭제했습니다.", "Key removed."));
                        })
                      }
                    >
                      {t("API key 삭제", "Remove key")}
                    </button>
                  )}
                </div>
                {(!user || user.guest) && (
                  <p>
                    {t(
                      "언어·테마는 이 기기에 저장됩니다. 나머지 설정은 로그인 후 변경할 수 있어요.",
                      "Language and theme are saved on this device. Sign in to change other settings.",
                    )}
                  </p>
                )}
                {settingsDirty && user && !user.guest && (
                  <p className="muted">
                    {t(
                      "변경한 설정을 먼저 저장하면 저장된 연결을 테스트할 수 있어요.",
                      "Save your changed settings before testing the saved connection.",
                    )}
                  </p>
                )}
              </section>
              <section className="panel settings collector-settings">
                <h2>{t("Collector 연결", "Connect Collector")}</h2>
                <p>
                  {t(
                    "설치된 Collector에서 다음 명령을 실행하고 표시되는 주소에서 GitHub로 로그인하세요.",
                    "Run the installed Collector and sign in with GitHub at the displayed URL.",
                  )}
                </p>
                <div className="command-row">
                  <pre>{collectorCommands.connect}</pre>
                  <button
                    type="button"
                    onClick={() =>
                      copyCommand("connect", collectorCommands.connect)
                    }
                  >
                    {copiedCommand === "connect"
                      ? t("복사됨", "Copied")
                      : t("복사", "Copy")}
                  </button>
                </div>
                <p>{t("로컬 기록 규모 확인", "Inspect local inventory")}</p>
                <div className="command-row">
                  <pre>{collectorCommands.inventory}</pre>
                  <button
                    type="button"
                    onClick={() =>
                      copyCommand("inventory", collectorCommands.inventory)
                    }
                  >
                    {copiedCommand === "inventory"
                      ? t("복사됨", "Copied")
                      : t("복사", "Copy")}
                  </button>
                </div>
                <p>{t("기존 기록 즉시 가져오기", "Import existing records")}</p>
                <div className="command-row">
                  <pre>{collectorCommands.sync}</pre>
                  <button
                    type="button"
                    onClick={() => copyCommand("sync", collectorCommands.sync)}
                  >
                    {copiedCommand === "sync"
                      ? t("복사됨", "Copied")
                      : t("복사", "Copy")}
                  </button>
                </div>
                <p className="muted">
                  {t(
                    "config.json의 include/exclude로 프로젝트를 선택합니다. 로그인·연결 전에는 자동 전송하지 않습니다.",
                    "Use include/exclude in config.json to select projects. No automatic transmission occurs before account linking.",
                  )}
                </p>
              </section>
            </>
          )}
          <footer className="page-footer">
            AgentSession Atlas{" "}
            <span>
              {t(
                "관측과 해석을 구분합니다.",
                "Observations and interpretations, kept distinct.",
              )}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
