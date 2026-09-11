import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluationCatalog,
  semanticSystemCommonRubric,
  type EvaluationCatalogRule,
} from "../packages/contracts/src/evaluation-catalog.ts";

const outputPath = resolve(import.meta.dirname, "../docs/evaluation.md");
const checkOnly = process.argv.includes("--check");
const startMarker = "<!-- evaluation-rules:start -->";
const endMarker = "<!-- evaluation-rules:end -->";

function ruleSection(rule: EvaluationCatalogRule): string {
  const requiredFacts = rule.requiredFacts.length
    ? rule.requiredFacts.map((fact) => `\`${fact}\``).join(", ")
    : "없음";
  return [
    `#### ${rule.id}@${rule.version} — ${rule.title}`,
    "",
    `| 항목 | 값 |`,
    `| --- | --- |`,
    `| 종류 | \`${rule.kind}\` |`,
    `| 상태 | \`${rule.status}\` |`,
    `| 기본 활성화 | \`${rule.defaultEnabled}\` |`,
    `| 그룹 | \`${rule.group}\` |`,
    `| 필요한 관측 사실 | ${requiredFacts} |`,
    "",
    `적용: ${rule.applicability}`,
    "",
    ...rule.rubric.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function render(): string {
  const deterministic = evaluationCatalog.filter(
    (rule) => rule.kind === "deterministic",
  );
  const semantic = evaluationCatalog.filter((rule) => rule.kind === "semantic");
  const semanticStatusSummary = semantic
    .map(
      (rule) =>
        `\`${rule.id}\`은 \`${rule.status}\`${rule.defaultEnabled ? "·기본 활성" : ""}`,
    )
    .join(", ");
  return [
    "## 평가 규칙 카탈로그",
    "",
    "이 절은 `evaluation-catalog.ts`에서 자동 생성한다. 규칙 변경은 코드에 반영한 뒤 문서를 다시 생성한다.",
    "",
    "### 공통 원칙",
    "",
    ...semanticSystemCommonRubric.map((item) => `- ${item}`),
    "",
    "### 결정적 규칙",
    "",
    ...deterministic.map(ruleSection),
    "### 의미 기반 rubric",
    "",
    `${semanticStatusSummary}. 필수 관측 사실·최대 그룹 수가 모두 충족된 항목만 평가 모델 입력에 넣는다. 선택되지 않은 항목은 disabled, insufficient, not_applicable 또는 deferred 이유와 함께 보존한다.`,
    "",
    ...semantic.map(ruleSection),
  ].join("\n");
}

async function main() {
  const current = await readFile(outputPath, "utf8");
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if (
    start < 0 ||
    end <= start ||
    current.indexOf(startMarker, start + startMarker.length) !== -1 ||
    current.indexOf(endMarker, end + endMarker.length) !== -1
  ) {
    throw new Error(
      "docs/evaluation.md must contain exactly one ordered pair of evaluation-rules markers",
    );
  }
  const rendered =
    current.slice(0, start + startMarker.length) +
    `\n\n${render().trimEnd()}\n\n` +
    current.slice(end);
  if (checkOnly) {
    if (current !== rendered) {
      throw new Error(
        "docs/evaluation.md rule catalog is stale; run pnpm generate:evaluation-docs",
      );
    }
  } else {
    await writeFile(outputPath, rendered);
  }
}

void main();
