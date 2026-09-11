"use client";

import { useEffect, useRef, useState } from "react";
import type { DeviceSnapshot } from "@agent-observatory/contracts/device-inspection";
import { displayDate } from "../lib/timezone";

type Inspection = {
  status: "pending" | "complete" | "failed" | "expired";
  snapshot?: DeviceSnapshot;
  error?: string;
};

const COMMAND = "atlas-collector start";
const POLL_MS = 2_000;
const TIMEOUT_MS = 60_000;

const formatBytes = (value: number) =>
  value >= 1_048_576
    ? `${(value / 1_048_576).toFixed(2)} MiB`
    : value >= 1_024
      ? `${(value / 1_024).toFixed(1)} KiB`
      : `${value} B`;

const sleep = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });

export function DeviceScope({
  deviceId,
  revoked,
  language,
  timezone,
}: {
  deviceId: string;
  revoked: boolean;
  language: "ko" | "en";
  timezone: string;
}) {
  const t = (ko: string, en: string) => (language === "ko" ? ko : en);
  const [state, setState] = useState<"idle" | "loading" | "complete" | "error">(
    "idle",
  );
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const inspect = async () => {
    if (runningRef.current || revoked) return;
    runningRef.current = true;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    setSnapshot(null);
    setError("");
    setCopied(false);
    setState("loading");

    try {
      const endpoint = `/api/devices/${encodeURIComponent(deviceId)}/inspect`;
      const startedAt = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
      });
      const started = (await response.json()) as {
        requestId?: string;
        error?: string;
      };
      if (!response.ok || !started.requestId) {
        throw new Error(
          started.error ||
            t(
              "Collector 연결을 확인할 수 없습니다. PC에서 atlas-collector start를 실행해 주세요.",
              "The Collector cannot be reached. Run atlas-collector start on the PC.",
            ),
        );
      }

      while (Date.now() - startedAt < TIMEOUT_MS) {
        await sleep(POLL_MS, controller.signal);
        const resultResponse = await fetch(
          `${endpoint}?requestId=${encodeURIComponent(started.requestId)}`,
          { signal: controller.signal },
        );
        const result = (await resultResponse.json()) as Inspection;
        if (!resultResponse.ok)
          throw new Error(result.error || `HTTP ${resultResponse.status}`);
        if (result.status === "pending") continue;
        if (result.status === "complete" && result.snapshot) {
          setSnapshot(result.snapshot);
          setState("complete");
          return;
        }
        throw new Error(
          result.error ||
            t(
              "Collector 연결을 확인할 수 없습니다. PC에서 atlas-collector start를 실행해 주세요.",
              "The Collector cannot be reached. Run atlas-collector start on the PC.",
            ),
        );
      }
      throw new Error(
        t(
          "60초 안에 응답이 없었습니다. PC에서 atlas-collector start를 실행해 주세요.",
          "The Collector did not respond within 60 seconds. Run atlas-collector start on the PC.",
        ),
      );
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        if (!timedOut) return;
        setSnapshot(null);
        setError(
          t(
            "60초 안에 응답이 없었습니다. PC에서 atlas-collector start를 실행해 주세요.",
            "The Collector did not respond within 60 seconds. Run atlas-collector start on the PC.",
          ),
        );
        setState("error");
        return;
      }
      setSnapshot(null);
      setError(
        cause instanceof Error
          ? cause.message
          : t("조회에 실패했습니다.", "Inspection failed."),
      );
      setState("error");
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) controllerRef.current = null;
      runningRef.current = false;
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details className="device-scope">
      <summary>
        {t(
          "현재 Collector 설정과 프로젝트 범위",
          "Current Collector settings and project scope",
        )}
      </summary>
      <div className="device-scope-content">
        <div className="device-scope-actions">
          <button
            type="button"
            onClick={inspect}
            disabled={revoked || state === "loading"}
          >
            {state === "loading"
              ? t("조회 중…", "Inspecting…")
              : t("현재 설정 조회", "Inspect current settings")}
          </button>
          {revoked && (
            <span className="muted">
              {t("해지된 기기입니다.", "This device is revoked.")}
            </span>
          )}
        </div>

        {state === "loading" && (
          <p className="device-scope-status" role="status">
            {t(
              "Collector 응답을 기다리고 있습니다.",
              "Waiting for the Collector to respond.",
            )}
          </p>
        )}

        {state === "error" && (
          <div className="device-scope-error" role="alert">
            <p>{error}</p>
            <div className="device-scope-command">
              <code>{COMMAND}</code>
              <button type="button" onClick={copyCommand}>
                {copied ? t("복사됨", "Copied") : t("복사", "Copy")}
              </button>
              <button type="button" onClick={inspect}>
                {t("다시 조회", "Retry")}
              </button>
            </div>
          </div>
        )}

        {state === "complete" && snapshot && (
          <div className="device-scope-result">
            <dl>
              <div>
                <dt>{t("조회 시각", "Observed at")}</dt>
                <dd>{displayDate(snapshot.observedAt, language, timezone)}</dd>
              </div>
              <div>
                <dt>{t("자동 업로드", "Automatic upload")}</dt>
                <dd>
                  {snapshot.paused
                    ? t("중지됨", "Paused")
                    : t("실행 중", "Running")}
                </dd>
              </div>
              <div>
                <dt>{t("소스", "Sources")}</dt>
                <dd>
                  {snapshot.sourceTypes.length
                    ? snapshot.sourceTypes.join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("수집 범위", "Collection scope")}</dt>
                <dd>
                  {snapshot.include.length
                    ? t("선택한 프로젝트", "Selected projects")
                    : t("전체 프로젝트", "All projects")}
                </dd>
              </div>
              <div>
                <dt>Include</dt>
                <dd>
                  {snapshot.include.length ? snapshot.include.join(", ") : "—"}
                </dd>
              </div>
              <div>
                <dt>Exclude</dt>
                <dd>
                  {snapshot.exclude.length ? snapshot.exclude.join(", ") : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("기간", "Date filter")}</dt>
                <dd>
                  {snapshot.since || snapshot.until
                    ? `${snapshot.since || "…"} – ${snapshot.until || "…"}`
                    : t("제한 없음", "No limit")}
                </dd>
              </div>
              <div>
                <dt>{t("로컬 합계", "Local total")}</dt>
                <dd>
                  {snapshot.sessions.toLocaleString(language)}{" "}
                  {t("세션", "sessions")} · {formatBytes(snapshot.bytes)}
                  {snapshot.truncated
                    ? ` · ${t("일부만 표시", "truncated")}`
                    : ""}
                </dd>
              </div>
            </dl>
            {snapshot.paused && (
              <p className="device-scope-note">
                {t(
                  "자동 업로드가 중지되어 있습니다.",
                  "Automatic upload is paused.",
                )}
              </p>
            )}
            {snapshot.pendingBatches > 0 && (
              <p className="device-scope-note">
                {t(
                  `이미 대기 중인 ${snapshot.pendingBatches.toLocaleString(language)}개 배치(${formatBytes(snapshot.pendingBytes)})는 새 제외 설정을 적용하지 않고 업로드됩니다.`,
                  `${snapshot.pendingBatches.toLocaleString(language)} queued batches (${formatBytes(snapshot.pendingBytes)}) will upload without applying new exclusions.`,
                )}
              </p>
            )}
            <div className="table-scroll device-scope-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("프로젝트", "Project")}</th>
                    <th>{t("로컬 세션", "Local sessions")}</th>
                    <th>{t("원본 크기", "Original bytes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.projects.length ? (
                    snapshot.projects.map((project) => (
                      <tr key={project.project}>
                        <td>{project.project}</td>
                        <td>{project.sessions.toLocaleString(language)}</td>
                        <td>{formatBytes(project.bytes)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>
                        {t(
                          "해당 범위에 프로젝트가 없습니다.",
                          "No projects are in this scope.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
