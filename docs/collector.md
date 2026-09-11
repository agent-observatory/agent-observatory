# Atlas Collector

![30분마다 새 기록을 JSON 대기 파일로 확정하고 Next.js에 전송한다. 서버가 마스킹 설정 적용 후 Storage 저장과 Supabase DB 접수를 확정한 ACK를 확인하면 로컬 파일을 삭제하고, 실패하면 보관 후 재시도한다. 원격 분석은 하루 한 번 또는 수동으로 별도 실행한다](assets/collector-delivery.svg)

[전체 흐름](README.md) · [Atlas](atlas.md) · [Collector](collector.md)

**Codex와 Claude Code 기록을 수집해 Atlas로 보내는 TypeScript 기반 Node.js CLI.** 0.3.0은 Claude Code adapter·기기 heartbeat·수집 snapshot 완료 handshake를 제공한다. Node.js 22.15 이상이 필요하다. 최근 pilot 설치본은 연결됐고 자동 전송은 `paused: true`다.

## 사용자 설치: npx setup

**Node.js 22.15 이상과 npm이 설치된 macOS부터 지원한다.** Windows·Linux 스케줄러는 후속으로 둔다.  
공개 npm 패키지는 아직 게시되지 않았다. 현재는 [Collector 0.3.0 GitHub Release](https://github.com/agent-observatory/agent-session-atlas/releases/tag/collector-v0.3.0)의 132,274-byte tarball을 사용한다. 로컬 설치와 운영 heartbeat를 확인했다.

```sh
npx --yes https://github.com/agent-observatory/agent-session-atlas/releases/download/collector-v0.3.0/agent-observatory-collector-0.3.0.tgz setup
```

`npx`는 GitHub Release tarball을 받아 실행하는 진입점이다. **영구 설치와 자동 실행 등록은 `setup`에 구현되어 있으며 로컬 설치에서 확인했다.** 설치 뒤의 명령은 `node ~/.agent-session-atlas/current/cli.js`로 실행한다.

| 단계      | `setup`이 실제로 하는 일                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------- |
| 설치      | 실행 파일을 `~/.agent-session-atlas/versions/<version>`에 복사하고 `current` 링크를 교체                 |
| 기본 설정 | 처음 한 번 Codex·Claude Code source를 켜고, include·exclude가 비어 있는 `all` 범위와 `paused: false` 저장 |
| 자동 기동 | `launchd` 사용자 LaunchAgent 하나에 로그인 시와 1,800초 간격으로 등록. Node·설치 CLI의 절대 경로 사용    |
| 다음 단계 | 계정 연결 URL·코드를 출력하지 않음. 설치가 끝나면 별도로 `connect`를 실행                                |

### 실행 주체·로그인·재부팅

Collector의 30분 실행은 **Codex 앱의 예약 작업이 아니라 macOS 사용자 `launchd` LaunchAgent**다. `setup`이 `com.agent-observatory.atlas-collector`을 등록해 설치된 CLI에 `sync --scheduled`를 전달한다. Codex 앱 예약 작업과 함께 쓸 수 있는지는 개발 후속 검증 항목이며, Collector의 실행 조건으로 가정하지 않는다.

0.3.0 등록값은 `StartInterval: 1800`, `RunAtLoad: true`다. 따라서 로그인·재부팅 뒤 복귀하면 즉시 한 번 실행하고 30분 주기를 이어 간다. 재로그인 뒤에도 설정과 cursor는 `~/.agent-session-atlas`에, 기기 토큰은 macOS Keychain에 남아 있으면 별도 연결 없이 다음 동기화를 시도한다. 토큰이 없거나 폐기됐으면 전송하지 않고 `connect`가 필요하다.

`pause`는 설정 파일의 `paused` 값을 유지한다. 예약 실행은 이 값이 참이면 전송·수집 대신 paused heartbeat만 남기며, 수동 `sync`는 범위 확인·복구를 위해 실행할 수 있다. `resume` 뒤 다음 예약 주기부터 자동 전송을 다시 시도한다.

0.3.0 Collector는 예약·paused 시작과 동기화 성공·실패 때 인증된 device heartbeat를 보낸다. 포함하는 값은 버전·활성 source 유형·pause 상태·마지막 성공 시각·안전한 오류 코드뿐이며, 경로·세션 본문·키는 보내지 않는다. 운영 API의 기기 목록과 로컬 설치본의 paused heartbeat를 확인했다. 웹 설정에서 마지막 활동·버전·일시 중지 상태를 보여 준다.

최초 연결에서는 **기존 기록 가져오기**를 제공한다. 현재 CLI는 `configure --include/--exclude/--since/--until`로 프로젝트·기간을 선택하고, `inventory`로 선택 범위의 세션 수·바이트·프로젝트 수를 집계한다. 대화형 GUI 미리보기는 아직 제공하지 않는다. 로컬 접수 이력이 없으면 서버 접수 내역을 먼저 조회해 이미 보낸 범위를 제외하고, 진행 위치를 저장해 중단 후 이어간다. 가져오기 완료 후 웹에서 **지금 분석**으로 바로 분석할 수 있으며 이후에는 30분 증분 동기화로 이어진다.

30분마다 `npx …@latest`를 실행하지 않는다. **로컬에 설치된 고정 버전**을 실행해야 네트워크 장애에도 기동할 수 있다.  
MVP는 설치된 Node 경로를 LaunchAgent에 고정한다. `doctor`는 현재 Node 버전을 보여 주지만 경로·스케줄러·디스크를 진단하지 않는다. Node 경로가 바뀌면 `setup`을 다시 실행해 등록을 갱신한다.

### 현재 CLI 계약

아래는 0.3.0 코드에 있는 명령만 기록한 계약이다. `inventory`, `status`, `doctor`의 표준 출력은 JSON이고, 나머지는 사람용 짧은 메시지다. JSON schema·`--json`·`--dry-run`·source 선택 플래그는 아직 없다.

| 명령 | 실제 동작 | 상태 변경 |
| --- | --- | --- |
| `setup` | 설치본과 LaunchAgent를 등록하고, 없을 때만 기본 설정을 만든다 | 설치본·설정·LaunchAgent |
| `connect` | 브라우저 기기 연결을 시작하고 성공한 device token을 Keychain에 저장한다 | 기기 연결·Keychain |
| `inventory` | 현재 범위의 `sessions`, `bytes`, `projects`를 JSON으로 집계한다. 전송하지 않는다 | 없음 |
| `configure --include a,b --exclude c,d --since ISO --until ISO` | 준 옵션만 설정한다. 날짜는 ISO로 정규화한다 | 수집 범위 |
| `configure --all` | include·since·until을 지워 전체 기간으로 돌린다. **기존 exclude는 유지한다** | 수집 범위 |
| `sync` | 최대 20개 새 배치를 만들고 대기 배치도 보낸다. 일시 중지 중에도 수동 실행은 전송한다 | Outbox·cursor·원격 접수 |
| `pause` / `resume` | 예약 실행의 전송을 중지하거나 재개한다 | `paused` |
| `status` / `doctor` | 같은 JSON으로 버전·연결 여부·pause·30분 주기·Node 버전·배치 상태 수를 보인다 | 없음 |
| `update` | 현재 배포물로 `setup`과 같은 설치·등록 경로를 실행한다. 버전 검사·다운로드·롤백은 아직 없다 | 설치본·LaunchAgent |
| `uninstall` | LaunchAgent와 `current` 링크만 제거한다. 설정·Keychain token·Outbox·SQLite는 남긴다 | 자동 실행 |

Source Adapter는 Codex와 Claude Code가 기본 활성화되지만, 현재 `configure`에는 `--source` 또는 source 비활성화 플래그가 없다. `--exclude`를 빈 목록으로 되돌리는 CLI도 없다. source를 끄거나 exclude를 비워야 하면 아래 설정 파일의 해당 값만 바꾸는 수동 설정이 필요하다. 에이전트는 CLI에 없는 이 변경을 임의로 우회하지 않고, 사용자에게 source 또는 제외 목록 변경을 명시적으로 받는다.

#### 현재 로컬 설정 파일

`~/.agent-session-atlas/config.json`은 PC별 상태다. 저장소에 넣거나 전체 내용을 대화에 출력하지 않는다. `setup`은 파일이 없을 때만 기본값을 만들며, `configure`는 include·exclude·since·until만 갱신한다.

| 키 | 역할 | 변경 경로 |
| --- | --- | --- |
| `url` | Atlas API 기준 URL | 설치 기본값. 일반 설정에서 변경하지 않음 |
| `sourceHome` | Codex 기본 홈 | `sources.codex.home`이 없을 때 사용 |
| `sources.codex` / `sources.claude-code` | 각 source의 `enabled`, `home` | source 선택 CLI가 없으므로 명시적 수동 설정만 허용 |
| `include`, `exclude` | 프로젝트 경로 목록 | `configure`; exclude를 빈 배열로 되돌릴 때만 명시적 수동 설정 |
| `since`, `until` | 세션 시작 시각 ISO 범위 | `configure`; `--all`은 둘을 제거 |
| `paused` | 예약 전송 중지 여부 | `pause` / `resume` |
| `deviceId` | 연결된 기기 식별자 | `connect`가 관리. 수동 변경 금지 |

수동 설정은 먼저 `pause`한 뒤, 사용자가 지정한 키만 최소 변경하고, `inventory`로 결과를 확인한다. `url`·`deviceId`·기존 범위·다른 source를 덮어쓰지 않는다. 설정 파일에는 token이 없으며 token은 Keychain에 있다.

`setup` 재실행은 등록을 복구하며 중복 LaunchAgent를 만들지 않는다. 기기 토큰은 macOS Keychain에 보관한다.

## 첫 사용

최근 pilot 설치본은 계정 연결 후 자동 전송이 일시 중지된 상태다. `inventory`로 범위와 용량을 확인하고, 필요하면 `configure --include/--exclude/--since/--until`로 범위를 정한 뒤 `sync`를 직접 실행한다. 웹에서 **전체 세션 지금 분석**을 눌러 분석을 시작할 수 있다. `resume`을 실행하면 30분 주기 자동 전송을 다시 켠다.

### 에이전트가 Collector를 다루는 방법

에이전트는 먼저 사람용 문서(`/docs/collector.md`)와 기계 탐색용 문서(`/llms.txt`)를 읽고, 실제 조작은 설치된 로컬 CLI로 한다. 이 문서와 웹 경로가 먼저인 이유는 CLI가 범위·상태·동작을 결정하는 정식 인터페이스이기 때문이다. 세션 원문, Keychain, Outbox를 직접 읽거나 바꾸는 것은 지원 경로가 아니다. source 선택이나 exclude 초기화처럼 CLI에 없는 설정 파일 변경은 [현재 로컬 설정 파일](#현재-로컬-설정-파일)의 좁은 예외로만 다룬다.

| 순서 | 로컬 CLI | 권한·확인 기준 |
| --- | --- | --- |
| 1. 현재 상태 | `status` 또는 `doctor` | 읽기 전용 JSON. 연결·pause·배치 수를 확인한다. |
| 2. 후보 범위 | `inventory` | 읽기 전용 JSON. 전송 없이 건수·바이트·프로젝트 수만 확인한다. |
| 3. 자동 전송 차단 | `pause` | 사용자가 범위를 검토하는 동안 자동 실행을 멈추도록 승인한 경우에만 실행한다. |
| 4. 범위 지정 | `configure --include <absolute-path> --since <ISO>` | 쓰기 작업이다. include, exclude, 기간 중 사용자가 명시한 값만 전달한다. |
| 4a. source 예외 | 설정 파일의 한 source `enabled` 값 | CLI에 source 플래그가 없어 사용자가 명시한 source 전환에만 쓴다. 전체 파일·token·기기 ID를 출력하거나 덮어쓰지 않는다. |
| 5. 재확인 | `inventory` | 변경 뒤의 집계를 보고한다. 현재 CLI에는 개별 세션 목록·`--dry-run`이 없다. |
| 6. 업로드 | `sync` | 원격 전송을 허용받은 뒤에만 실행한다. 완료 메시지는 분석 완료가 아닌 배치 전송 결과다. |
| 7. 자동 전송 재개 | `resume` | 사용자가 이후 30분 자동 전송을 원할 때만 실행한다. |

`configure` 필터는 **새 source 발견과 새 Outbox 생성**에만 적용된다. `sync`는 먼저 기존 Outbox의 pending 배치를 전송하고, 그 뒤 현재 필터로 source를 발견한다. 따라서 필터를 바꿔도 이미 만들어진 pending 배치는 제외되지 않으며, 이미 서버에 접수된 세션도 철회되지 않는다. 원치 않는 기록을 피하려면 첫 `sync` 전에 범위를 지정해야 한다. 접수 뒤 삭제는 서버의 세션 삭제 기능으로 별도 처리해야 하며, 에이전트는 그 삭제 권한과 대상을 확인한 뒤에만 요청한다.

#### 현재 인터페이스와 제안 순서

| 층 | 현재 | 역할 |
| --- | --- | --- |
| 정식 운영 인터페이스 | 설치된 `atlas-collector` CLI | 로컬 source·Outbox·기기 token을 가진 유일한 조작 경로 |
| 에이전트 읽기 자료 | `/docs/collector.md`와 `/llms.txt` | 웹의 같은 공유 문서에서 제공하는 설치·범위·보관·명령 계약 |
| 얇은 Skill | 제안 | 위 읽기 순서와 inventory → 범위 확인 → sync 절차만 참조. 별도 상태나 명령 문서를 복제하지 않음 |
| 원격 MCP | 제안 | 계정·device별 서버 상태와 분석 결과를 원격으로 다룰 필요가 생길 때만 추가. 현재 MCP 서버·tool은 없음 |

Skill보다 먼저 CLI와 구조화 문서를 정한다. Skill은 기존 CLI의 안전한 순서를 알려 주는 얇은 래퍼여야 한다. MCP는 로컬 파일이나 Keychain을 직접 열어서는 안 되며, 원격 Atlas API에 인증된 tool 호출이 필요한 때에만 검토한다.

| 제안 MCP 범위 | 읽기 tool | 쓰기 tool |
| --- | --- | --- |
| Collector/device | `list_devices`, `get_device_status` | 없음. PC의 pause·configure·sync는 로컬 CLI에만 남김 |
| 원격 Atlas | `list_sessions`, `get_analysis_status` | `request_analysis`, `request_reanalysis`, `delete_session` |

쓰기 tool은 대상 workspace·session 범위, 확인용 요약, idempotency key를 요구하고 원문·token·절대 경로를 반환하지 않는다. `delete_session`은 별도 명시 승인과 보관 정책 검증을 요구한다. 이 표는 API 설계 제안이며, 현재 배포된 MCP tool 이름이나 권한이 아니다.

구조화 CLI의 다음 단계는 모든 명령에 안정된 `--json` 결과와 schema version을 제공하는 것이다. `configure --dry-run`은 변경 전후 범위 요약만, `sync --dry-run`은 pending과 새 후보를 구분한 계획만 내보내야 한다. source별 집계·필터 적용 시각·pending 배치 수를 포함하되 세션 본문·token·원본 경로는 기본 출력에서 제외한다.

### 최근 개인 pilot

최근 1주 기록에서 main 세션 4개·이벤트 3,717개를 15개 배치로 전송했고, subagent 21개와 실행 중 세션 1개는 제외했다. 선택한 범위의 로컬 cursor는 모두 완료됐다. 준비한 wire는 2,107,290 bytes였고, 500 재시도 1회를 포함한 실제 17회 POST는 2,428,355 bytes였다. 이후 gap 409는 수정했다.

서버에는 마스킹한 Zstd 파일 2,106,796 bytes가 저장됐고, 해제한 입력은 9,257,325 bytes였다. 이미지 본문 없이 metadata 251회·고유 binary 237개만 확인했다. 상세 데이터의 보관은 최대 7일이다. 이 확인은 업로드 범위이며, 4개 세션 분석 중 2개만 완료된 상태는 [Atlas 분석 상태](atlas.md#원격-분석-자동과-수동)에서 별도로 본다.

## 수집과 전송

**Collector는 분석 근거를 선별·정규화해 전송하고, 평가와 AI 해석은 서버가 맡는다.** 현재는 기본 이벤트 변환과 증분 전송이 구현되어 있으며, 아래 정교한 수집 정책은 다음 개발 과제다.
컴퓨터당 OS 스케줄러 하나가 수집기를 30분마다 실행한다. macOS는 `launchd`를 사용한다.
Codex 기록 저장소에서 신규·변경 기록을 찾고 작업 경로로 프로젝트를 분류한다. 프로젝트마다 스케줄러를 등록하지 않는다.

본문·도구 입출력을 확보하기 위해 세션 파일을 읽는 방식을 기본으로 한다.
내장 OTel은 에이전트별 내용·잘림 범위가 달라 후속 보완 경로로 둔다.

아래 YAML은 **목표 수집 정책 모델**이다. 0.3.0의 실제 설정 파일 형식은 이 YAML이 아니라 `~/.agent-session-atlas/config.json`이며, 현재 CLI는 위의 [현재 CLI 계약](#현재-cli-계약)에 적힌 옵션만 지원한다. 에이전트는 이 예시를 복사해 실제 설정 파일을 쓰지 않는다.

```yaml
# 목표 수집 정책 모델 — 현재 config.json 형식이 아님
sources:
  codex: { enabled: true, home: "~/.codex" }
  claude-code: { enabled: true, home: "~/.claude/projects" }

collection:
  projects:
    mode: all # all | allowlist
    include: []
    exclude: ["~/work/company/**"]

upload:
  mode: automatic # automatic | manual
  interval_minutes: 30
  workspace: personal
  format: canonical-json
  max_request_bytes: 1048576 # Zstd 압축 HTTP 본문 1 MiB
  compression: zstd-level-3
  outbox_dir: "~/.agent-session-atlas/outbox"
  max_pending_mb: 1024
  retry_backoff_minutes: [5, 10, 20, 40, 60]

analysis:
  schedule: daily # 원격 하루 1회. 대시보드 수동 실행도 제공
  external_ai: true
```

| 선택 범위      | 규칙                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프로젝트       | `exclude` 우선. 정규화한 경로로 비교하고 경로 미상은 자동 전송 제외                                                                                                                                                                             |
| 자동·수동 전송 | 기본은 설정 범위의 새 기록 자동 전송. `manual`은 선택 시점까지의 기록만 대기열에 등록                                                                                                                                                           |
| 본문·이미지    | 사용자·에이전트 메시지와 도구 입출력을 변환. 중첩된 user/tool data URL 이미지는 원본 bytes를 hash한 metadata(등장 횟수·MIME·bytes·PNG/JPEG 크기·`local_only`)로 바꾸고 본문에서는 제거. 인증 파일이나 프로젝트 소스 전체를 별도로 탐색하지 않음 |
| 마스킹         | **Next.js 서버에서 기본 `enabled: true`**. Atlas의 Settings → Privacy에서 켜기·끄기. 서버가 인증된 Workspace의 설정을 읽어 새 접수에 적용하며, Collector 요청값으로 해제할 수 없음                                                              |
| 설정 변경      | 새 source 발견에는 현재 필터를 적용. 이미 만든 pending Outbox는 먼저 전송되므로 필터 변경으로 철회되지 않음. 이미 서버에 보낸 기록은 별도 삭제                                                                                                  |
| 목적지         | 대기 파일에 Workspace·계정·기기·정책 버전을 고정. 설정을 바꿔도 기존 파일의 목적지는 바뀌지 않음                                                                                                                                                |

프로젝트 경로는 전송 대상을 고르는 기준이며, 붙여넣은 내용까지 개인 데이터라고 판별하지는 않는다.
Source Adapter는 Codex의 `~/.codex/sessions`·`~/.codex/archived_sessions`와 Claude Code의 `~/.claude/projects` JSONL을 읽는다. 기본은 두 source 전체이며 `exclude`가 우선한다. source 유형·세션 ID·generation을 함께 checkpoint 조회에 사용해 서로 다른 adapter의 읽기 위치를 섞지 않는다.
브라우저 파일 업로드도 같은 서버 수신·마스킹 경로를 사용한다.
로컬 대기 파일과 HTTPS 요청에는 원본 본문이 포함된다. 마스킹이 켜져 있으면 치환 후 Storage·DB에 저장하고, 꺼져 있으면 치환 없이 저장한다. 두 경우 모두 본문을 서버 로그·Workflow 실행 기록에 남기지 않는다.

## 근거를 보존하는 수집

**사용자 지시 → 스킬·도구 사용 → 결과 → 추가 지시·수정의 연결을 보존한다.** 0.2.0은 원본 형식 해석·기계적 정규화·중복 구분과 이미지 metadata-only 처리를 구현했다. 마스킹과 분석용 근거 선별·축약은 서버의 공통 경로에서 처리하며, 계층적 세션 증류는 후속 과제다.

| 기록               | 목표 처리                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프롬프트·추가 지시 | 평가 대상 원문과 턴 순서를 보존. 이벤트·턴 단위로 묶어 압축하고, 전송·처리 한도를 넘을 때만 분할. 누락이 생기면 범위를 표시                                                 |
| 스킬·도구 사용     | 명시적 호출·읽기 근거, 인자, 호출 ID, 결과·오류·후속 수정을 연결. 스킬 이름의 단순 언급을 사용으로 확정하지 않음                                                            |
| 큰 도구 출력·코드  | 원문·전체 길이·종료 상태·호출 연결을 보존해 압축 전송. 분석용 변경 요약·발췌는 서버에서 만들고, 동일 출력의 중복 표현은 출처를 유지한 참조로 전달                           |
| 중복 이벤트        | 원본 ID·호출 ID·출처를 기준으로 같은 실행의 여러 표현을 구분. 내용이 같아도 실제로 반복한 호출·지시는 별도 발생으로 유지                                                    |
| 사용량             | 누적·요청별 토큰을 구분하고 증분 집계. 모델·턴 경계와 누적값 초기화를 보존해 중복 합산 방지                                                                                 |
| 복원용 기록        | 암호화된 추론 데이터·복원용 중복 이력은 전송 제외. 압축 발생·맥락 손실 여부 등 분석에 필요한 메타데이터는 보존                                                              |
| 이미지             | 발생한 턴마다 hash·MIME·bytes·PNG/JPEG 폭·높이만 기록하고 원본 pixels는 로컬에 둠. 같은 binary가 반복돼도 발생 횟수는 보존. OCR·vision·이미지 픽셀 분석은 pilot 범위에 없음 |
| 알 수 없는 형식    | 해석 불가·미지원·잘림·정책 제외를 구분해 기록. 수집되지 않은 것을 사용하지 않은 것으로 판단하지 않음                                                                        |

전송 계약에는 원본 위치·이벤트 ID와 정제 정책 버전, 원본/전송 바이트, 제외·축약 사유 및 범위를 추가한다. 정책은 단계별 모듈과 등록 목록으로 확장하고 공통 계약 버전을 관리한다. 계약을 바꿀 때는 서버와 Collector를 함께 전환하고 구버전 호환 경로는 두지 않는다. 기존 Outbox·체크포인트는 새 계약에 맞게 이관하거나 원본에서 재생성하며, 이미 접수된 범위와 대조해 누락·중복을 검증한다.

이미지 중복 제거는 소유자 경계를 넘지 않는다. 리사이즈는 민감정보 마스킹이 아니며 텍스트 마스킹이 이미지 속 글자까지 처리한다고 표시하지 않는다. 이미지 전송·분석 범위와 보호 정책은 이미지 기능 구현 시 함께 검증한다.

검증은 합성 세션으로 수행한다. 재시작·재전송 전후 이벤트 ID와 사용량이 같아야 하고, 실제 반복 호출이 중복 제거로 사라지면 실패다. 큰 프롬프트·도구 출력·이미지가 있어도 메모리와 배치 크기를 제한하며, 초과 시 조용한 손실 없이 진행 위치와 사유를 남긴다. 축약률과 함께 핵심 지시·실패·복구·스킬 근거의 보존 여부를 검사한다.

[서버 증류와 품질 검증](atlas.md#서버-증류와-분석-품질)으로 이어진다.

### 압축과 분할

**논리적 이벤트·턴을 canonical JSON으로 묶어 Node.js native Zstd level 3으로 압축한다.** 압축 wire·저장 본문은 1 MiB, 해제 배치는 8 MiB, JSONL 한 줄은 64 MiB까지 검사한다. 압축률이 높아도 해제 후 크기 제한을 생략하지 않는다.

| 구간        | 목표 처리                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Collector   | 원본 해석·정규화 → canonical JSON Outbox 확정 → 전송 직전에 Zstd 압축. wire 1 MiB 또는 decoded 8 MiB를 넘는 단일 이벤트는 원본과 cursor를 보존하고 수집 중단 |
| 서버 접수   | 1 MiB 압축 본문 해제·계약 검증 → data URL 이미지를 다시 제거 → Workspace 마스킹 → `.json.zst` 재압축 저장·접수 확정. 저장 quota는 압축 bytes 기준            |
| 수동 업로드 | 브라우저 JSON wire는 1 MiB까지 허용하고 같은 이미지 제거·마스킹·Zstd 저장 경로 적용                                                                          |

불가피하게 나눈 이벤트는 원본 ID·순서·완료 여부를 유지하고 한 건으로 집계한다. 일부만 도착한 상태를 완료로 처리하지 않으며, 조각 경계에서도 마스킹이 누락되지 않아야 한다. 전송 배치와 AI 입력 구간은 별개다. 압축은 AI 입력 토큰을 줄이지 않는다.

Outbox에는 압축본이 아니라 재전송·복구용 raw canonical JSON을 둔다. 서버가 마스킹 뒤 압축본을 저장한다. 이미지 원본과 pixels는 Collector·서버·AI에 전송하지 않는다.

### 로컬 압축 비교 — 2026-09-11

**이 표는 2026-09-11의 historical codec benchmark다.** Zstd 3을 선택한 근거이지만, 현재 0.2.0의 실제 wire·Storage·개인 pilot 측정값은 아니다.

Apple M3 Pro에서 인식 가능한 Codex 파일 1,088개(약 1.232 GB)를 현재 Collector 코드로 읽었다. 설치된 수집기 상태와 원본은 변경하지 않았고, 외부 업로드·AI 호출은 없었다. 격리한 임시 Outbox는 측정 후 삭제했다. 보고서에는 집계만 남겼다.

| 처리 범위·결과                                           |                                        용량·건수 |
| -------------------------------------------------------- | -----------------------------------------------: |
| 끝까지 읽은 파일 / 큰 이벤트에서 중단된 파일             |                                       1,054 / 34 |
| Outbox에 확정한 원본 구간 / 아직 확정하지 못한 원본 구간 |                              575.2 MB / 656.4 MB |
| 생성한 전송 JSON                                         |       205.3 MB · 1,303개 배치 · 111,819개 이벤트 |
| 서버 `maskBatch` 적용 후 저장 JSON                       |                                         204.9 MB |
| 지표·규칙·타임라인 결과 JSON 합계                        | 43.5 MB · AI 응답·작업 메타데이터·DB 인덱스 제외 |

34개 파일의 미수집 부분은 절감량으로 계산하지 않는다. 기존 어댑터가 해석하지 않는 이벤트도 있으므로, 이 결과가 모든 원본의 의미를 보존했다는 뜻은 아니다. 마스킹된 도구 출력에도 이미지 data URL 약 10.4 MB가 남아 있어, 정교한 이미지 분리·정제는 별도 과제다.

동일한 **마스킹 후 1,303개 배치를 각각 독립 압축**한 결과다. MB는 10진 단위다.

| 방식        | 저장 파일 합계 |  압축 시간 |   해제 시간 |
| ----------- | -------------: | ---------: | ----------: |
| 비압축 JSON |       204.9 MB |          — |           — |
| gzip 1      |        62.3 MB |     1.10초 |     0.172초 |
| gzip 6      |        53.7 MB |     2.60초 |     0.156초 |
| Zstd 1      |        53.0 MB |     0.23초 |     0.106초 |
| **Zstd 3**  |    **49.3 MB** | **0.32초** | **0.114초** |
| LZ4 기본    |        77.0 MB |     0.17초 |     0.034초 |
| LZ4 HC 9    |        62.1 MB |     2.20초 |     0.038초 |

네이티브 zlib 1.2.12·Zstd 1.5.7·LZ4 1.10.0의 단일 스레드 API를 사용했다. 배치당 예열 1회와 측정 3회를 수행하고, 회차별 시간 합계의 중앙값을 기록했다. 모든 압축 해제 결과를 원본 바이트와 비교했다. 표의 시간은 파일 I/O·프로세스 간 전송을 제외한 코덱 시간이며 Node 바인딩·Vercel에서의 실제 처리 시간은 아니다. 원본 읽기·Outbox 확정·마스킹·양쪽 단계의 반복 측정까지 전체 실행은 약 100초였다.

Zstd 3 도입 시 **수집된 범위의 파일 약 49.3 MB + 분석 결과 JSON 약 43.5 MB**라는 과거 로컬 예상치였다. DB 물리 사용량·AI 응답·접수/작업 메타데이터·인덱스와 0.2.0 운영값은 포함하지 않았다.

재현: `pnpm exec tsx scripts/benchmark-compression.ts --synthetic`로 합성 검증 후, `pnpm exec tsx scripts/benchmark-compression.ts`로 로컬 집계한다. C 컴파일러와 로컬 LZ4·Zstd 개발 라이브러리가 필요하다. macOS 기본 경로는 Homebrew이며 다른 설치 위치는 `CODEC_PREFIX`로 지정한다. 새 앱 의존성은 추가하지 않았다.

[집계 보고서](../ops/compression-local.json) · [합성 검증](../ops/compression-synthetic.json) · [측정 스크립트](../scripts/benchmark-compression.ts)

## 30분 전송과 장애 복구

임시 파일은 OS가 청소하는 `/tmp`가 아닌 **앱 전용 영속 폴더**에 둔다.
Outbox는 raw canonical JSON의 `events` 배열을 보관하고, 전송할 때 같은 목적지의 새 기록을 Zstd로 압축한다.

```text
~/.agent-session-atlas/
├── state.sqlite              # 읽기 위치·배치 상태·재시도 시각·접수증
└── outbox/
    ├── .staging/<id>.json     # 작성 중: 전송 금지
    └── ready/<id>.json        # 확정 파일: 재시작 후에도 전송 가능
```

각 JSON 파일은 `manifest`와 `payload`를 포함한다.
`manifest`에는 목적지·원본 파일 구간·전송 본문 SHA-256, `payload`에는 고정 `batch_id`와 `events`를 둔다.

| 순서              | 처리·완료 기준                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 기동·복구      | OS 파일 잠금으로 동시 실행 방지. 이전 실행이 진행 중이면 종료. 만료된 전송 lease와 대기 파일부터 복구                                                                         |
| 2. 새 기록 읽기   | 파일별 읽기 위치 이후의 **완성된 JSONL 줄**만 읽음. 쓰는 중인 마지막 줄은 다음 실행까지 대기                                                                                  |
| 3. 대기 파일 확정 | JSON 작성 → 파일 동기화 → 같은 파일시스템의 `ready`로 atomic rename → 부모 디렉터리 동기화. 로컬에서는 마스킹하지 않음                                                        |
| 4. 읽기 위치 저장 | 파일 확정 후 SQLite 트랜잭션으로 배치 등록·읽기 위치 갱신. 서버 전송 성공 여부와 분리                                                                                         |
| 5. 전송           | 재시도 시각이 지난 배치부터 처리. Zstd 압축 본문을 1 MiB 이하로 제한하고 `application/octet-stream`으로 전송                                                                  |
| 6. 서버 접수      | 인증·압축/해제 크기·원본 해시 확인 → 이미지 data URL 재제거 → Workspace 마스킹 → `.json.zst` Storage 저장 → compressed bytes quota 확인 → DB 배치 접수·세션 변경 COMMIT → ACK |
| 7. 로컬 정리      | ACK의 `batch_id`·`received_sha256`을 확인하고 SQLite에 접수증 저장. 그다음 대기 파일 삭제. 에이전트 원본은 유지                                                               |

**ACK는 서버의 보관·접수가 끝났다는 뜻이다. 분석 완료를 기다리지 않는다.**
변경이 없고 재시도할 배치도 없으면 네트워크 호출 없이 종료한다. 실행당 작업량을 제한하고 나머지는 다음 기동에서 처리한다.

| 장애·경계 상황                   | 처리                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 오프라인·timeout·5xx             | Collector는 파일을 보존하고 다음 기동에서 재시도. 원격 AI의 후보 전환·재시도는 [Atlas의 무료 AI 운영 규칙](atlas.md#ai-실행-선택)을 따름 |
| 429                              | `Retry-After`와 자체 backoff 중 늦은 시각 적용. 서버가 막혀도 새 기록은 로컬 여유 공간까지 보관                                          |
| 401·403 / 잘못된 배치            | 자격증명 오류는 목적지 전송 중지, 스키마 오류·동일 ID의 다른 해시는 해당 배치 격리. 파일 보관·사용자 조치 후 재개                        |
| 서버 처리 중 통신 단절           | 같은 ID로 접수 상태를 먼저 조회. 미접수면 동일 JSON 재전송. 진행 중이면 대기하고, Storage만 남았으면 서버가 이어서 접수                  |
| 서버 COMMIT 후 ACK 유실          | 같은 ID·해시로 다시 접수하면 기존 접수증 반환. 서버에 이벤트·분석 대상을 중복 등록하지 않음                                              |
| 파일 확정 후 SQLite 기록 전 종료 | 시작 시 `ready` JSON의 manifest를 대조해 미등록 배치·읽기 위치 복구. 확정 파일은 수정하지 않고 같은 ID로 전송                            |
| 미완성 파일·파일 유실            | `.staging`은 미전송 상태로 재생성. 등록된 대기 파일이 사라졌으면 읽기 위치를 되돌려 원본 재수집, 원본도 없으면 누락 표시                 |
| 원본 교체·잘림                   | 파일 식별자·내용 변경을 감지해 새 generation 부여. 기존 cursor를 새 파일에 적용하지 않음                                                 |
| 절전·재부팅 / 디스크 가득 참     | 복귀 후 읽기 위치에서 재개. 대기 용량 상한이면 새 수집을 멈추고 알림. 미접수 파일은 나이·실패 횟수만으로 삭제하지 않음                   |

서버는 원본 해시(`received_sha256`)와 설정 적용 후 저장 해시(`stored_sha256`)·마스킹 적용 여부·정책 버전을 구분해 보존한다. 접수된 배치의 재시도에는 기존 접수증을 반환하며 설정 변경으로 재저장하지 않는다.
마스킹이 켜진 상태에서 처리에 실패하면 ACK 없이 실패 처리하며 원문 저장으로 우회하지 않는다. 설정 조회 실패·누락도 해제된 것으로 해석하지 않는다.

`batch_id`는 처음 만들 때 고정하고 재시도에서도 유지한다. 현재 서버의 배치 유일 키는 `(owner, batch_id)`이며, 기기·workspace 확장은 설계 범위다.
이벤트에도 출처 ID 또는 `(device, file_generation, byte_offset)`을 부여해 재수집·배치 재구성 시 중복을 제거한다.

Collector가 발견 시점에 고정한 마지막 완성 JSONL 줄까지 만든 배치가 모두 ACK된 경우에만 `POST /api/checkpoints/complete`로 **수집 snapshot 완료**를 표시한다. 서버는 같은 source·session·generation의 terminal ACK offset이 요청 offset과 정확히 같을 때만 완료 시각을 기록한다. 이후 새 배치는 완료 표시를 지운다. 따라서 계속 쓰이는 파일을 영구 완료로 표시하지 않는다.

읽기 위치는 **로컬에 안전하게 복사한 지점**, 접수증은 **서버에 안전하게 접수된 지점**이다.
전송 상태는 `pending → sending → acknowledged`, 실패하면 `pending`, 조치가 필요하면 `blocked`로 관리한다.

[Atlas 분석](atlas.md#원격-분석-자동과-수동) · [공통 계약](README.md#공통-계약과-책임) · [참고 자료](README.md#참고-자료)
