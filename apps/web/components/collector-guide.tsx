"use client";
import { useState } from "react";
import Link from "next/link";
import { collectorGuide } from "../lib/collector-guide";
export function CollectorGuide({ language }: { language: "ko" | "en" }) {
  const t = (ko: string, en: string) => (language === "en" ? en : ko);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sections = collectorGuide(language);
  const commandBlock = (id: string, command: string) => (
    <div className="command-row">
      <pre>{command}</pre>
      <button
        type="button"
        aria-label={t(`${id} 명령 복사`, `Copy ${id} command`)}
        onClick={async () => {
          setError("");
          try {
            await navigator.clipboard.writeText(command);
            setCopied(id);
          } catch {
            setError(
              t(
                "복사하지 못했습니다. 명령을 직접 선택해 주세요.",
                "Could not copy. Select the command manually.",
              ),
            );
          }
        }}
      >
        {copied === id ? t("복사됨", "Copied") : t("복사", "Copy")}
      </button>
    </div>
  );
  return (
    <div className="collector-guide">
      <div className="guide-links">
        <a href={`/docs/collector.md?lang=${language}`}>
          {t("에이전트용 Markdown", "Markdown for agents")} ↗
        </a>
        <Link href="/settings">
          {t("연결된 기기 관리", "Manage connected devices")} →
        </Link>
      </div>
      <div className="guide-index">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.title}
          </a>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {sections.map((section) => (
        <section className="panel" id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          {section.text && <p>{section.text}</p>}
          {section.items && (
            <ol
              className={section.id === "start" ? "guide-steps" : "guide-items"}
            >
              {section.items.map((item) => (
                <li key={item.id}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  {item.command && commandBlock(item.id, item.command)}
                </li>
              ))}
            </ol>
          )}
          {section.facts && (
            <dl className="residency-details">
              {section.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}
