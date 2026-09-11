"use client";
import { useState } from "react";
import Link from "next/link";
import { collectorGuide } from "../lib/collector-guide";
import "./docs-guide.css";
export function CollectorGuide({ language }: { language: "ko" | "en" }) {
  const t = (ko: string, en: string) => (language === "en" ? en : ko);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const sections = collectorGuide(language);
  const commandBlock = (id: string, command: string) => (
    <div className="docs-command">
      <pre tabIndex={0} aria-label={t(`${id} 명령`, `${id} command`)}>
        <code>{command}</code>
      </pre>
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
        <span aria-hidden="true">{copied === id ? "✓" : "⧉"}</span>
        {copied === id ? t("복사됨", "Copied") : t("복사", "Copy")}
      </button>
    </div>
  );
  return (
    <div className="collector-guide">
      <div className="docs-guide-actions" aria-label={t("문서 링크", "Documentation links")}>
        <a href={`/docs/collector.md?lang=${language}`}>{t("Markdown 원문", "Markdown source")} ↗</a>
        <Link href="/settings">{t("연결된 기기", "Connected devices")} →</Link>
      </div>
      {error && (
        <p role="alert" className="docs-guide-alert docs-guide-alert-error">
          {error}
        </p>
      )}
      <div className="docs-guide-layout">
        <nav className="docs-guide-index" aria-label={t("이 페이지의 목차", "On this page")}>
          <strong>{t("이 페이지에서", "On this page")}</strong>
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>{section.title}</a>
          ))}
        </nav>
        <article className="docs-guide-body">
          {sections.map((section) => (
            <section className="docs-guide-section" id={section.id} key={section.id}>
              <h2><a href={`#${section.id}`}>{section.title}</a></h2>
              {section.text && <p className="docs-guide-lead">{section.text}</p>}
              {section.items && (
                <ol className={section.id === "start" ? "docs-guide-steps" : "docs-guide-items"}>
                  {section.items.map((item) => (
                    <li key={item.id} id={item.id} className={!item.command ? "docs-guide-note" : undefined}>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                      {item.command && commandBlock(item.id, item.command)}
                    </li>
                  ))}
                </ol>
              )}
              {section.facts && (
                <dl className="docs-guide-facts">
                  {section.facts.map((fact) => (
                    <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </article>
      </div>
      <p className="docs-copy-status" aria-live="polite">
        {copied ? t("명령을 클립보드에 복사했습니다.", "Command copied to the clipboard.") : ""}
      </p>
    </div>
  );
}
