export type GuideItem = {
  id: string;
  title: string;
  text: string;
  command?: string;
  format?: "bash" | "json";
};
export type GuideSection = {
  id: string;
  title: string;
  text?: string;
  items?: GuideItem[];
  facts?: Array<{ label: string; value: string }>;
};
const cli = "atlas-collector";
const install =
  "npm install --global https://github.com/agent-observatory/agent-session-atlas/releases/download/collector-v0.4.0/agent-observatory-collector-0.4.0.tgz\natlas-collector setup";
export function collectorGuide(language: "ko" | "en" = "ko"): GuideSection[] {
  const t = (ko: string, en: string) => (language === "en" ? en : ko);
  const steps = [
    {
      id: "install",
      title: t("Collector 설치", "Install Collector"),
      text: t(
        "macOS와 Node.js 22.15 이상이 필요합니다. 로그인 시와 30분마다 실행하는 스케줄러, 웹 조회에 응답하는 백그라운드 프로세스를 등록합니다.",
        "Requires macOS and Node.js 22.15 or later. Setup registers the login/30-minute scheduler and a background process for web inspection.",
      ),
      command: install,
    },
    {
      id: "pause-first",
      title: t("자동 전송을 멈추고 범위 선택", "Pause and choose a scope"),
      text: t(
        "먼저 자동 전송을 멈추세요. 모든 프로젝트가 기본 대상이므로, 일부만 올리려면 아래 프로젝트·기간 설정의 configure 명령으로 범위를 지정한 뒤 진행하세요.",
        "Pause automatic uploads first. All projects are included by default. To upload only some projects, use configure in Projects and time range below before continuing.",
      ),
      command: `${cli} pause`,
    },
    {
      id: "inventory",
      title: t("수집 범위 확인", "Inspect your records"),
      text: t(
        "Codex와 Claude Code의 로컬 기록 수와 용량을 확인합니다. 이 명령은 파일을 전송하지 않습니다.",
        "Check the number and size of local Codex and Claude Code records. This command does not upload files.",
      ),
      command: `${cli} inventory`,
    },
    {
      id: "connect",
      title: t("GitHub 계정에 연결", "Connect your GitHub account"),
      text: t(
        "명령에 표시된 주소를 열어 로그인하고, PC에 표시된 코드와 같은지 확인한 뒤 연결을 승인하세요. 연결해도 pause 설정은 유지됩니다. 확인한 범위만 수동 sync하고, 자동 전송이 필요하면 resume 하세요.",
        "Open the displayed URL, sign in, verify the code matches your computer, and approve the connection. Connecting preserves pause. Run sync for your reviewed scope, then resume if automatic uploads are wanted.",
      ),
      command: `${cli} connect`,
    },
    {
      id: "sync",
      title: t("지금 가져오기·분석", "Import and analyze now"),
      text: t(
        "변경된 기록을 전송합니다. 완료 후 세션 페이지에서 전체 또는 선택한 세션을 분석하세요.",
        "Upload changed records, then analyze all or selected sessions on the Sessions page.",
      ),
      command: `${cli} sync`,
    },
  ];
  return [
    {
      id: "start",
      title: t("Collector 시작하기", "Get started with Collector"),
      text: t(
        "PC당 하나만 설치합니다. 처음에는 설치 → pause → 범위 설정·inventory → connect → sync 순서로 실행하고, 자동 전송이 필요하면 resume 합니다.",
        "Install once per computer. Start with setup → pause → configure scope and inventory → connect → sync, then resume if automatic uploads are wanted.",
      ),
      items: steps,
    },
    {
      id: "device-inspection",
      title: t(
        "웹에서 현재 수집 범위 확인",
        "Inspect current collection scope",
      ),
      text: t(
        "설정 → 연결된 기기 → 현재 설정 조회를 누르세요. 실행 중인 Collector가 요청을 받은 뒤 로컬 설정과 수집 대상 프로젝트를 읽습니다. 전송할 세션 본문을 읽거나 업로드하지 않습니다.",
        "Open Settings → Connected devices → Inspect current settings. The running Collector reads its local settings and eligible projects after receiving the request. It does not upload sessions.",
      ),
      items: [
        {
          id: "start-collector",
          title: t("Collector 실행", "Start Collector"),
          text: t(
            "연결할 수 없다는 안내가 나오면 해당 PC에서 실행하세요. 기존 pause 설정을 유지하며 예약 실행과 웹 조회 응답을 시작합니다. 네트워크가 정상일 때 조회 요청은 보통 10초 이내 확인하며, 파일 수에 따라 결과 계산 시간이 더 걸릴 수 있습니다.",
            "Run this on the target PC if it cannot be reached. Starts scheduling and web inspection while preserving pause. Requests are usually picked up within 10 seconds; scanning may take longer.",
          ),
          command: `${cli} start`,
        },
        {
          id: "stop-collector",
          title: t("Collector 종료", "Stop Collector"),
          text: t(
            "예약 실행과 웹 조회 응답을 종료합니다. 다시 start하거나 다음 로그인 시 시작됩니다. 자동 전송만 멈추려면 pause를 사용하세요.",
            "Stops scheduling and web inspection until start or the next login. Use pause to stop only automatic uploads.",
          ),
          command: `${cli} stop`,
        },
      ],
      facts: [
        {
          label: t("조회 결과", "Result"),
          value: t(
            "포함·제외 프로젝트, 기간, 활성 에이전트, 프로젝트별 로컬 세션 수·원본 크기와 조회 시각. 200개 초과 목록은 일부만 표시합니다.",
            "Includes/excludes, period, active agents, per-project local session counts and source sizes, and inspection time. Lists over 200 items are truncated.",
          ),
        },
        {
          label: t("대기 전송", "Queued uploads"),
          value: t(
            "이미 대기 중인 배치는 새 제외 설정과 별개입니다. 표시한 원본 크기는 실제 압축 전송량이나 새로 전송할 양이 아닙니다.",
            "Queued batches are independent of new exclusions. Source size is neither compressed transfer size nor incremental upload size.",
          ),
        },
        {
          label: t("연결·보관", "Connection and retention"),
          value: t(
            "응답이 없으면 현재 설정을 표시하지 않습니다. 조회 결과는 5분 동안만 서버에서 읽을 수 있고, 만료 뒤 Collector 연결 또는 매시간 정리 작업에서 제거합니다. 키와 세션 본문은 포함하지 않습니다.",
            "No current settings are shown without a response. Results remain readable for 5 minutes and are removed on a later Collector connection or hourly cleanup. Keys and session content are excluded.",
          ),
        },
      ],
    },
    {
      id: "projects",
      title: t("프로젝트·기간 설정", "Projects and time range"),
      text: t(
        "기본은 모든 프로젝트입니다. 경로와 그 하위 폴더가 함께 선택되며 exclude가 include보다 우선합니다. 여러 경로는 쉼표로 구분하고, 공백이 있는 값은 따옴표로 감싸세요.",
        "All projects are included by default. Paths include their descendants; exclude takes precedence over include. Separate multiple paths with commas and quote values containing spaces.",
      ),
      items: [
        {
          id: "pause",
          title: t("자동 전송 중지", "Pause automatic uploads"),
          text: t(
            "범위를 바꾸기 전에 실행하세요. 이미 실행 중인 sync를 종료하거나 기존 대기 파일을 지우지는 않습니다.",
            "Pause before changing scope. This does not stop a running sync or clear existing queued files.",
          ),
          command: `${cli} pause`,
        },
        {
          id: "include",
          title: t("포함할 프로젝트", "Include projects"),
          text: t(
            "예시 경로를 내 프로젝트의 절대 경로로 바꾸세요. 기존 include 목록을 교체합니다.",
            "Replace example paths with your absolute project paths. This replaces the existing include list.",
          ),
          command: `${cli} configure --include "/path/to/project-a,/path/to/project-b"`,
        },
        {
          id: "exclude",
          title: t("제외할 프로젝트", "Exclude projects"),
          text: t(
            "기존 exclude 목록을 교체합니다. 이미 서버에 올라간 세션은 웹에서 별도로 삭제합니다.",
            "This replaces the exclude list. Delete already uploaded sessions separately in the web app.",
          ),
          command: `${cli} configure --exclude "/path/to/private-project"`,
        },
        {
          id: "period",
          title: t("기간 제한", "Limit the time range"),
          text: t(
            "세션 시작 시각으로 범위를 고릅니다. 세션 내부 메시지를 이 기간으로 자르지 않습니다. 날짜와 UTC 오프셋을 원하는 값으로 바꾸세요.",
            "Filters by session start time; it does not trim messages within a session. Replace the dates and UTC offsets.",
          ),
          command: `${cli} configure --since "2026-09-01T00:00:00+09:00" --until "2026-09-07T23:59:59+09:00"`,
        },
        {
          id: "all",
          title: t("포함·기간 제한 해제", "Clear include and time filters"),
          text: t(
            "--all은 include와 since/until만 초기화합니다. exclude는 유지됩니다. exclude를 비우려면 config.json의 해당 배열만 []로 수정합니다.",
            "--all resets include and since/until only; exclude is retained. To clear exclusions, change only the exclude array in config.json to [].",
          ),
          command: `${cli} configure --all`,
        },
        {
          id: "queue",
          title: t("이미 대기 중인 파일", "Already queued files"),
          text: t(
            "범위 변경은 새 수집에 적용됩니다. 기존 Outbox 대기 파일은 sync에서 전송될 수 있습니다. status의 batches에 대기 항목이 있으면 전송 전 별도로 검토하세요.",
            "Scope changes apply to new collection. Existing Outbox files may still be sent by sync. Review queued batches in status before uploading.",
          ),
        },
      ],
    },
    {
      id: "sources",
      title: t("기록 소스와 로컬 설정", "Sources and local configuration"),
      text: t(
        "Codex(~/.codex)와 Claude Code(~/.claude/projects)가 기본 활성화됩니다. ~/.agent-session-atlas/config.json의 sources에서 enabled와 절대 home 경로를 조정합니다. 소스 전용 CLI 옵션은 아직 없습니다.",
        "Codex (~/.codex) and Claude Code (~/.claude/projects) are enabled by default. Configure enabled and absolute home paths under sources in ~/.agent-session-atlas/config.json. Source-specific CLI flags are not available.",
      ),
      items: [
        {
          id: "source-config",
          title: t(
            "Claude Code 수집 제외 예시",
            "Example: disable Claude Code collection",
          ),
          text: t(
            "아래는 변경할 부분만의 예시입니다. 파일 전체를 덮어쓰지 말고 기존 연결·경로·설정을 유지한 채 합치세요.",
            "This is a partial configuration example. Merge it into the existing file without overwriting connection details, paths, or other settings.",
          ),
          command:
            '{\n  "sources": {\n    "claude-code": { "enabled": false }\n  }\n}',
          format: "json",
        },
      ],
    },
    {
      id: "manage",
      title: t("동기화 관리", "Manage synchronization"),
      text: t(
        "macOS launchd가 로그인 시와 30분마다 실행합니다. Codex 앱과 독립적이며, PC가 꺼져 있으면 전송하지 않습니다. 설정·진행 위치는 로컬에, 기기 토큰은 macOS Keychain에 보관합니다.",
        "macOS launchd runs at login and every 30 minutes, independently of the Codex app. A powered-off computer cannot upload. Settings and checkpoints stay local; the device token is stored in macOS Keychain.",
      ),
      items: [
        {
          id: "doctor",
          title: t("상태 확인", "Check status"),
          text: t(
            "inventory와 status/doctor는 JSON을 출력합니다. status/doctor는 연결·pause·대기 배치를 표시합니다. 서버 마지막 활동은 웹 설정에서 확인합니다.",
            "inventory and status/doctor return JSON. status/doctor show connection, pause, and queued batches. Check the last server activity in web Settings.",
          ),
          command: `${cli} doctor`,
        },
        {
          id: "resume",
          title: t("자동 전송 재개", "Resume automatic uploads"),
          text: t(
            "선택한 범위가 맞는지 확인한 후 재개합니다. sync는 pause 중에도 수동 실행됩니다.",
            "Resume after checking the selected scope. Manual sync still runs while paused.",
          ),
          command: `${cli} resume`,
        },
        {
          id: "update",
          title: t("Collector 업데이트", "Update Collector"),
          text: t(
            "설치할 Release 패키지의 update 명령을 실행합니다. 현재 설치본의 update만 실행하면 그 버전을 다시 설치하며 최신 버전을 자동 검색하지 않습니다. 설정·Outbox는 유지됩니다.",
            "Run update from the release package you want to install. Running update from the installed CLI reinstalls that version; it does not discover the latest release. Settings and Outbox are preserved.",
          ),
          command: install.replace(/setup$/, "update"),
        },
        {
          id: "uninstall",
          title: t("자동 실행 해제", "Unregister automatic execution"),
          text: t(
            "LaunchAgent와 실행 링크를 해제합니다. 원본·설정·접수증·대기 파일은 보존합니다.",
            "Removes the LaunchAgent and execution link. Original records, settings, receipts, and queued files are preserved.",
          ),
          command: `${cli} uninstall`,
        },
      ],
    },
    {
      id: "residency",
      title: "Data residency & retention",
      text: t(
        "변경된 텍스트와 이미지 메타데이터를 압축해 전송합니다. 이미지 본문은 로컬에 남기며, 민감정보 마스킹은 기본적으로 서버 저장 전에 적용합니다.",
        "Changed text and image metadata are compressed for upload. Image contents remain local. Sensitive information is masked before server storage by default.",
      ),
      facts: [
        { label: t("웹·API", "Web and API"), value: "Vercel · Seoul (icn1)" },
        {
          label: t("DB·비공개 파일", "Database and private files"),
          value: "Supabase · Seoul (ap-northeast-2)",
        },
        {
          label: t("상세 데이터", "Detailed data"),
          value: t(
            "세션 파일·이벤트·상세 분석 결과: 최대 7일",
            "Session files, events, and detailed analysis: up to 7 days",
          ),
        },
        {
          label: t("집계 요약", "Aggregate summaries"),
          value: t(
            "간단한 결과 요약: 최대 30일",
            "Brief result summaries: up to 30 days",
          ),
        },
        {
          label: t("AI 처리", "AI processing"),
          value: t(
            "분석 근거는 선택된 AI 제공자에게 전달됩니다. 처리 위치와 보관은 해당 제공자의 정책을 따르며 Free tier와 BYOK 모두 적용됩니다.",
            "Evidence is sent to the selected AI provider. Processing location and retention follow that provider's policy for both Free tier and BYOK.",
          ),
        },
      ],
    },
    {
      id: "agents",
      title: t("에이전트에서 사용하기", "Use with an agent"),
      text: t(
        "이 문서의 Markdown 원문과 /llms.txt를 에이전트에 전달하세요. 웹과 Markdown은 같은 내용에서 생성합니다. Skill·MCP·플러그인은 아직 배포하지 않았습니다.",
        "Give your agent the Markdown version and /llms.txt. Web and Markdown are generated from the same content. A Skill, MCP server, and plugin have not been released.",
      ),
      items: [
        {
          id: "agent-flow",
          title: t("권장 작업 순서", "Recommended workflow"),
          text: t(
            "요청한 프로젝트·기간 파악 → 현재 설정과 status 확인 → 필요 시 pause → configure → inventory의 규모 검토 → 승인된 범위만 sync → 서버 접수와 분석 결과 확인. 원본·키를 출력하거나 범위를 임의 확대하지 마세요. 삭제는 정확한 세션을 확인한 뒤 웹에서 실행합니다.",
            "Identify the requested projects and period → inspect settings and status → pause if needed → configure → review inventory size → sync only the authorized scope → verify server receipts and analysis. Do not expose source records or keys or broaden scope silently. Confirm exact sessions before deleting them in the web app.",
          ),
        },
      ],
    },
  ];
}
export function collectorGuideMarkdown(language: "ko" | "en" = "ko") {
  return (
    "# Atlas Collector\n\n## Overview\n\n![How Atlas works: collect, analyze, review, and improve the next session.](https://agent-session-atlas.vercel.app/overview-cycle.svg)\n\n" +
    collectorGuide(language)
      .map((section) =>
        [
          `## ${section.title}`,
          section.text || "",
          ...(section.items || []).flatMap((item) => [
            `### ${item.title}`,
            item.text,
            ...(item.command
              ? [`\`\`\`${item.format || "bash"}\n${item.command}\n\`\`\``]
              : []),
          ]),
          ...(section.facts || []).map(
            (fact) => `- **${fact.label}**: ${fact.value}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
      .join("\n\n") +
    "\n"
  );
}
