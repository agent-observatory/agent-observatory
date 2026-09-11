# 전체 흐름

![GitHub Actions가 원격 일정을 관리하고 Vercel 서울에서 웹·API·Workflow를 실행한다. Supabase 서울의 DB와 비공개 Storage에 세션·분석 결과를 저장하며 서버가 설정한 무료 AI 제공자 풀 또는 OpenAI 호환 BYOK로 AI 설명을 생성한다. 에이전트는 로컬 CLI를 통해 Collector를 다루고, 점선은 아직 구현되지 않은 원격 MCP 도구 경계를 나타낸다](assets/architecture-overview.svg)

[전체 흐름](README.md) · [Atlas](atlas.md) · [Collector](collector.md)

**AgentSession Atlas**는 세션을 보관·분석하는 웹 서비스다. **Atlas Collector**는 로컬 기록을 수집해 Atlas로 보내는 CLI다.

| 문서                                | 범위                                        |
| ----------------------------------- | ------------------------------------------- |
| 이 문서                             | 전체 구조·공통 계약·현재 상태·구현 순서     |
| [Atlas](atlas.md)                   | 대시보드·로그인·AI 분석·BYOK·배포·운영      |
| [Collector](collector.md)           | 설치·30분 실행·증분 수집·전송·복구          |
| [Collector의 에이전트 조작](collector.md#에이전트가-collector를-다루는-방법) | CLI 계약·안전한 sync 순서·Skill/MCP 제안 |
| [평가 기준](evaluation.md)          | 실행 모델·스킬 효과·근거 요구·규칙 수명주기 |
| [디자인 기준](DESIGN.md)            | 색상·타이포·간격·컴포넌트·화면 검증         |
| [실제 작업 기록](implementation.md) | 소요 시간·검증 결과·남은 연결 작업          |

## 이어서 작업하기

Codex는 [AGENTS.md](../AGENTS.md), Claude Code는 [CLAUDE.md](../CLAUDE.md)에서 같은 공통 지침을 읽는다. 이 문서의 현재 상태를 확인한 뒤 작업에 해당하는 상세 문서로 이동한다.

| 필요한 정보                   | 기준 문서·코드                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| 키 위치·사본·교체 영향        | [키 관리와 로컬 환경](atlas.md#키-관리와-로컬-환경), `.env.example`, `node scripts/check-environment.mjs` |
| Vercel·Supabase·예약 작업     | [배포와 운영 명령](atlas.md#배포와-운영-명령), [리소스 식별자](../ops/production.json)                    |
| 평가 기준·규칙 운영           | [모델 적합성·스킬 효과와 규칙 수명주기](evaluation.md)                                                    |
| Collector 구현·큰 이벤트 경계 | `apps/collector/src/core.ts`, [수집 정책](collector.md#근거를-보존하는-수집)                              |
| 에이전트의 Collector 조작 | [CLI 계약과 안전한 순서](collector.md#에이전트가-collector를-다루는-방법), 웹의 `/docs/collector.md`·`/llms.txt` |
| 공통 이벤트·마스킹·기본 규칙  | `packages/contracts/src/index.ts`                                                                         |
| 수신·저장                     | `apps/web/lib/ingest.ts`, `apps/web/lib/storage.ts`                                                       |
| 무료 후보·직렬 실행·분석      | `apps/web/lib/ai-routing.ts`, `apps/web/workflows/analysis.ts`                                            |
| 실제 완료·검증 범위           | [작업 기록](implementation.md), `ops/*verification*.json`, `ops/*smoke*.json`                             |

운영 배포의 정확한 버전·커밋·검증 시각은 [운영 상태](../ops/production.json)를 따른다. 0.4.0은 현재 Collector 설정 조회와 Docs 가독성을 개선했다. 0.3.0에는 Claude Code 수집, 접수 시작·완료, 기기 활동, 공통 평가 카탈로그, 문제·해결 중심 화면을 추가했다. 최근 개인 pilot은 선택한 4개 세션의 업로드와 로컬 cursor 완료까지 확인했으며, 분석은 4개 중 3개 완료된 진행 상태다.

먼저 `git status --short`로 기존 변경을 확인한다. 이전 모델 연결 조사에서 남은 미추적 `ops/openrouter-*.json`·`ops/zai-vision-*.json`은 현재 커밋에 포함되지 않았다. 자동 삭제·일괄 커밋하지 말고 출처와 내용을 확인한다.

## 현재 상태

2026-09-11 확인 기준이다. 운영 리소스·키 이름·DB migration·비공개 버킷은 13:43 KST에 다시 조회했다. 이후 17:19 KST에 최신 운영 배포·원격 경계·화면을 확인했다. 구현, 원격 검증, 배포 확인을 분리해 기록한다.

| 대상            | 확인한 상태                                                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel          | [운영 URL](https://agent-session-atlas.vercel.app) 공개 HTTP 200·Ready. 0.4.0 배포 `dpl_BgwyVtra95qbKZRsuAbiGYAD8gff`, source `f858f93`, 기본 함수 리전 `icn1`                                                                          |
| Supabase        | 서울 Free 운영 연결. DB TLS·`SELECT 1`, 비공개 `sessions` 버킷의 합성 JSON 저장·조회·삭제와 익명 접근 차단 검증                                                                                                                         |
| GitHub OAuth    | 실제 Edge 브라우저에서 Hyune-c 회원가입·로그인·개인 공간 진입 성공                                                                                                                                                                      |
| 기본 AI         | 비로그인을 포함한 Public Free tier가 설정된 서버 키의 6개 후보를 순서대로 사용. 공통 직렬 슬롯과 모델/제공자 범위 cooldown 적용                                                                                                         |
| 개인 BYOK       | OpenAI 호환 endpoint 설정·암호화 저장·연결 확인 UI와 SSRF 검증 코드 구현. 실제 사용자 키 연결은 원격 미검증                                                                                                                             |
| GitHub Actions  | [CI run 34606401527](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34606401527) 성공: 계약 22·Collector 18·웹 29, 총 69개 테스트와 타입 검사·빌드 통과. 압축 수신 원격 검증 9개와 인증·소유권·삭제 경계 검증 11개 통과 |
| Atlas·Collector | Collector 0.4.0이 설치·연결됐고 자동 전송은 `paused: true`. [GitHub Release tarball](https://github.com/agent-observatory/agent-session-atlas/releases/tag/collector-v0.4.0)은 132,863 bytes로 공개됐으며 npm은 아직 미게시             |

## 에이전트 인터페이스 경계

Collector를 자동화하는 에이전트의 정식 실행면은 **로컬 CLI**다. 웹의 `/docs/collector.md`와 `/llms.txt`는 같은 공유 문서에서 설치·명령·데이터 경계를 제공하는 읽기면이다. 한국어·영어 Markdown과 공개 경로는 [운영 검증](../ops/agent-docs-verification.json)을 통과했다.

| 표면 | 현재 구현 | 경계 |
| --- | --- | --- |
| 로컬 CLI | `setup`, `connect`, `inventory`, `configure`, `sync`, `status`, `doctor`, `pause`, `resume`, `update`, `uninstall` | 로컬 source·Outbox·Keychain을 다루는 유일한 지원 경로 |
| 구조화 출력 | `inventory`, `status`, `doctor` JSON | session count·bytes·project count와 상태만 출력. 범위·pending을 구분한 계획 출력은 후속 |
| 현재 설정 조회 | 연결된 기기에서 요청 → 상주 Collector가 로컬 설정·프로젝트 목록 응답 | 조회 전용. 미응답 시 `atlas-collector start` 안내; 확인 시각 표시 |
| 웹 문서 | `/docs/collector.md`, `/llms.txt` | 사람과 에이전트가 같은 canonical 내용을 찾는 읽기 경로 |
| Skill | 제안 | CLI와 문서를 참조해 inventory → 범위 확인 → sync 순서를 안내하는 얇은 절차 |
| MCP | 제안 | 원격 Atlas의 device·세션·분석 상태가 필요할 때만. 현재 MCP 서버나 tool은 없음 |

에이전트가 범위를 좁혀도 이미 만들어진 pending Outbox나 접수된 원격 세션은 자동 철회되지 않는다. 이 차이와 쓰기 권한은 [Collector 안전 절차](collector.md#에이전트가-collector를-다루는-방법)를 따른다.

## 설계 결정: 사람과 에이전트가 같은 제품을 사용한다

Atlas는 대시보드 사용자를 위한 별도 제품과 에이전트용 자동화 제품을 만들지 않는다. 사람은 웹에서, 에이전트는 문서와 로컬 CLI 또는 향후 MCP를 통해 **같은 Workspace·소유권·보관·평가 규칙**을 사용한다. 이 결정은 UI를 자동화하기 위한 것이 아니라, 세션 근거와 분석 결과의 의미가 호출 주체에 따라 달라지지 않게 하기 위한 것이다.

| 계층 | 책임 | 재구현하지 않는 것 |
| --- | --- | --- |
| 웹·원격 API | 로그인, Workspace·소유권, 수신·보관, 분석 요청, 평가·근거 규칙 | CLI·Skill·MCP에 별도 도메인 규칙을 복제하지 않음 |
| 로컬 CLI | PC의 세션 파일 발견, Outbox, Keychain token, `pause`·범위 설정·`sync` | 원격 세션 삭제·분석 권한을 로컬에서 추정하지 않음 |
| 문서 | 기능 발견, 명령 계약, 데이터·권한 경계, 안전한 절차 | 실행이나 권한 부여를 하지 않음 |
| 얇은 Skill | canonical 문서를 찾아 읽고 inspect → plan → execute → verify 순서를 안내 | 별도 상태·정책·비밀값을 보관하지 않음 |
| 원격 MCP adapter | 인증된 Atlas API를 tool 형식으로 노출해 세션·분석 상태를 읽고 원격 분석·삭제를 요청 | PC 파일, Keychain, 로컬 Collector 제어를 원격에서 직접 수행하지 않음 |
| plugin | Skill·MCP·문서 같은 배포 단위를 설치·발견하게 묶음 | 새 비즈니스 기능이나 새로운 권한 모델을 만들지 않음 |

에이전트 자동화의 목표 흐름은 다음과 같다. **inspect**는 상태·인벤토리·세션을 읽고, **plan**은 대상·범위·크기·기존 pending을 요약한다. **execute**는 확인된 쓰기만 수행하며, **verify**는 idempotency key, 서버 접수증, 분석 상태와 근거 ID로 결과를 확인한다. 자동화가 새 해석이나 더 넓은 범위를 만들지 않도록, 각 단계의 입력과 결과를 같은 API 계약에 남기는 것을 목표로 한다. 현재는 inventory/status와 수집 ACK를 제공하며, 별도의 plan 기록과 원격 MCP는 후속이다.

| 채택 순서 | 이유 | 상태 |
| --- | --- | --- |
| 1. local CLI + `/docs/collector.md` + `/llms.txt` | 로컬 디스크·Keychain 경계를 보존하면서 사람과 에이전트가 같은 명령 계약을 읽는다 | 현재 |
| 2. 모든 CLI의 안정된 JSON·plan 출력 | 에이전트가 텍스트 파싱 없이 범위·pending·결과를 판단한다 | 후속 |
| 3. 얇은 Skill | 문서와 CLI를 다시 쓰지 않고 안전한 작업 순서만 전달한다 | 제안 |
| 4. 원격 MCP adapter | 여러 도구가 원격 세션·분석 상태를 읽고 같은 API로 요청할 필요가 생길 때 도입한다 | 제안 |
| 5. plugin packaging | 배포·발견 경로를 하나로 제공해야 할 때만 묶는다 | 제안 |

이 구조는 개인 세션이나 키를 예시로 쓰지 않아도 설명할 수 있다. 블로그에서는 “로컬 권한은 CLI에 남기고, 원격 도메인 규칙은 한 API에 모으며, 문서·Skill·MCP는 그 경계를 다른 방식으로 발견·호출한다”는 결정과 위의 채택 순서를 사례의 중심으로 삼는다.

규격 참고: [Agent Skills](https://agentskills.io/specification) · [MCP 아키텍처](https://modelcontextprotocol.io/docs/learn/architecture). Skill은 지침·참고 자료를 묶고 MCP는 클라이언트와 서버 사이의 도구·문맥 교환을 정의한다.

## 제품의 핵심: 근거를 보존하는 수집과 증류

**가장 중요한 개발 과제는 Collector의 정교한 수집과 서버의 증류다.** 프롬프트·스킬·작업 지시가 실제 실행과 결과에 어떻게 이어졌는지 평가할 수 있어야 한다. 용량 절감만으로 성공을 판단하지 않는다.

여기서 증류는 모델 학습이 아니라 **원본 기록에서 분석 근거를 선별·구조화하고, 필요한 맥락을 유지하며 축약하는 과정**이다.

| 단계                                                | 핵심 책임                                                    | 현재 상태                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [Collector 정제](collector.md#근거를-보존하는-수집) | 원본 형식 해석·기계적 정규화·중복 구분·근거 연결·압축 전송   | Zstd 전송·이미지 metadata 분리 배포. 최근 4개 세션의 선택 업로드와 cursor 완료 확인              |
| [서버 증류](atlas.md#서버-증류와-분석-품질)         | 수신 검증·마스킹·결정적 근거 구성·세션 전체 평가             | 마스킹·지표·공통 규칙·근거 선택·구조화된 개선안 구현. 계층적 구간 증류와 전체 맥락 연결은 미구현 |
| 품질 검증                                           | 프롬프트·스킬 사용·실패 후 수정·결과의 연결과 근거 누락 평가 | 합성 데이터로 형식·기본 근거 검증. 정제 전후 분석 품질 비교는 미검증                             |

**다음 개발은 수집 계약과 Collector 정제 → 서버 구간별 증류 → 정제 전후 품질 검증 순으로 우선한다.** 모델 후보 확대나 화면 확장보다 앞선 과제다. 상세 구현·검증 기준은 위 문서에서 관리한다.

전송은 이벤트·턴을 묶어 압축하고, 압축 후 전송 한도나 해제 후 처리 한도를 넘을 때만 나눈다. 마스킹과 분석용 근거 선별·축약은 서버에서 맡아 자동 수집·수동 업로드·온디맨드 분석에 같은 정책을 적용한다. 압축 수신 원격 검증 9개와 인증·소유권·삭제 경계 검증 11개 통과이다.

## 핵심 결정

**선택한 프로젝트의 세션을 30분마다 동기화하고, 하루 한 번 또는 수동으로 분석한다.**  
Codex·Claude Code 어댑터를 제공한다. Hermes는 후속 대상이다. 통계는 코드로 계산하고 AI는 근거 해석을 맡는다.

| 항목           | 초안의 선택                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 수집           | 설치한 로컬 전송기가 30분마다 실행. 프로젝트 기본값 `all`, 허용·제외 목록 지원                                                      |
| 분석           | 원격에서 하루 1회 또는 수동 실행 → 같은 Workflow. 접수된 데이터는 PC를 꺼도 분석                                                    |
| 배포           | **Vercel 서울 + Supabase 서울 + 서버 무료 제공자 풀 (BYOK: OpenAI 호환 endpoint)**. 웹·API·분석은 Vercel, DB·비공개 파일은 Supabase |
| 언어·테마      | 한국어·다크 기본. 설정에서 한국어/English, 라이트/다크/시스템 선택                                                                  |
| 첫 사용        | GitHub 회원가입·로그인 → 수집기 연결 → 기존 Codex 기록 가져오기 → 즉시 분석·결과 조회                                               |
| 개발·배포 단위 | **모노레포 1개, 애플리케이션 2개**. Next.js는 Vercel 배포, 로컬 수집기는 npm 배포·`npx` 설치                                        |
| 비용           | **개인 비상업 MVP 월 $0 목표**. 무료 할당 안에서 보관량·호출량 제한                                                                 |
| 확장           | 개인 → 여러 에이전트 → 팀·다른 사용자의 파일 업로드 분석                                                                            |

## 전체 흐름

| 순서 | 주체           | 처리                                                                                 |
| ---- | -------------- | ------------------------------------------------------------------------------------ |
| 1    | Collector      | 컴퓨터당 스케줄러 하나가 30분마다 Codex 신규·변경 기록을 확인하고 프로젝트 정책 적용 |
| 2    | Collector      | 전송 본문을 Outbox에 확정하고 로컬 읽기 위치 저장                                    |
| 3    | Atlas 접수 API | 인증·검증·마스킹 설정 적용 후 Supabase Storage 저장과 Supabase DB 접수 확정          |
| 4    | Collector      | 서버 ACK 확인 후 접수증 저장·대기 파일 정리                                          |
| 5    | Atlas          | GitHub Actions의 일일 호출 또는 수동 요청으로 확정된 데이터 범위를 분석              |
| 6    | 대시보드       | 지표·근거·AI 설명·실제 모델 정보를 표시                                              |

브라우저는 Collector가 설치된 PC와 다른 기기에서도 접속할 수 있다. 웹 서비스는 Vercel에 배포하고 브라우저는 접속자의 기기에서 실행한다.
브라우저 수동 업로드는 Collector 설치 없이 Atlas의 수신·마스킹 경로를 사용한다. [전송·복구 상세](collector.md#30분-전송과-장애-복구) · [분석 상세](atlas.md#원격-분석-자동과-수동)

## 애플리케이션과 저장소 구성

**Next.js 앱과 로컬 수집기, 총 2개를 만든다. 하나의 org public 모노레포에서 함께 관리한다.**  
Storage·Workflow는 Next.js 앱이 사용하는 관리형 기능이며, 원격 일정은 GitHub Actions가 관리한다. 별도 서버 애플리케이션으로 배포하지 않는다.

![하나의 GitHub 모노레포에서 Next.js를 Vercel로 배포하고 로컬 수집기를 npm으로 배포한다. 사용자는 npx setup으로 수집기를 설치하고 OS 스케줄러가 설치된 버전을 30분마다 실행한다](assets/architecture-packaging.svg)

| 대상        | 직접 작성할 코드                               | 플랫폼에 맡기는 부분                     |
| ----------- | ---------------------------------------------- | ---------------------------------------- |
| Next.js     | 대시보드·인증·접수·마스킹·조회 API             | 웹 호스팅·Functions 실행·HTTPS           |
| 로컬 수집기 | 설치·인증·어댑터·JSON Outbox·재시도·OS 등록    | npm은 패키지 배포, 사용자 OS는 30분 기동 |
| Storage     | 서버 SDK로 저장·읽기·삭제, 접근 권한·보관 정책 | Private 저장소 생성·파일 보관            |
| 예약 작업   | GitHub Actions 일정 + 호출받을 API             | 시간당 유지관리·일일 분석 API 호출       |
| Workflow    | 분석 순서·각 단계·재시도·결과 저장 코드        | 실행 상태 보존·중단 후 재개·단계 실행    |
| Supabase    | SQL 스키마·마이그레이션·쿼리                   | PostgreSQL 서버·연결 관리                |

Storage는 **리소스 설정 + 사용 코드**, Actions 예약 작업은 **일정 설정 + API 코드**, Workflow는 **분석 코드**가 필요하다.  
Vercel이 실행 기반을 제공하며, 이 서비스의 분석 로직까지 만들어주지는 않는다.

```text
agent-session-atlas/             # 이 저장소의 구현 구조 제안
├── apps/
│   ├── web/                    # 유일한 Vercel 프로젝트, Root Directory
│   │   ├── app/api/            # ingest, analyses, jobs, device 연결
│   │   ├── workflows/          # 분석 흐름과 단계 함수
│   │   ├── lib/                # 마스킹·Supabase DB·Storage·AI 접근
│   │   ├── next.config.ts      # withWorkflow 통합
│   │   └── vercel.json         # 함수 리전·실행 설정
│   └── collector/              # npm에 공개할 CLI·설치·OS 스케줄러
├── packages/contracts/         # 공통 이벤트·배치·ACK 스키마와 버전
├── db/migrations/              # SQL 변경 이력
├── ops/                        # 환경별 비밀값 없는 리소스 설정
├── scripts/                    # 인프라 준비·배포·검증 스크립트
├── .github/workflows/          # CI·배포·npm 릴리스·원격 예약 작업
└── pnpm-workspace.yaml         # 공통 lockfile, 별도 앱 버전
```

공통 계약을 한 PR에서 수정할 수 있어 초기에는 1개 레포가 편하다. `pnpm workspace`부터 시작한다.  
공통 패키지는 CLI 배포물에 포함하고, 수집기 사용자가 레포를 clone하거나 pnpm을 설치할 필요는 없게 한다.

웹과 Collector는 각 `package.json`에서 독립적인 SemVer를 관리한다. 공통 lockfile을 쓰더라도 버전을 함께 올리지 않는다.

| 대상      | 릴리스 식별        | 배포                                                             |
| --------- | ------------------ | ---------------------------------------------------------------- |
| Atlas 웹  | `atlas-vX.Y.Z`     | main 변경은 검증 후 Vercel 배포. 정식 릴리스에 웹 버전 태그 부여 |
| Collector | `collector-vX.Y.Z` | Collector 버전 태그에서만 패키지 검사 후 npm 게시                |
| 공통 계약 | `schema_version`   | 앱 버전과 독립적으로 관리. CLI 배포물에 포함                     |

웹만 변경하면 Collector 버전은 유지한다. 현재는 초기 개발 단계이므로 계약 변경 시 서버·Collector·필요한 데이터 구조를 함께 전환한다. 구버전 지원이나 단계적 호환 배포는 요구하지 않는다. 계약 버전은 추적과 불일치 검출에 사용한다. 전환 시 기존 Outbox·체크포인트의 재생성 또는 이관 방법을 정하고 누락·중복을 검증한다.

레포 분리는 담당 팀·접근 권한·릴리스 운영이 달라질 때 검토한다. 공통 패키지는 별도 애플리케이션으로 세지 않는다.  
분리 시 웹은 이 저장소에 유지하고 수집기는 `agent-observatory/agent-session-collector`로 옮긴다.

## 공통 계약과 책임

| 계층           | 맡는 일                                        | 구현 제안                                                                                                                                 |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 로컬 전송기    | 30분마다 새 기록 발견·선택·보관·전송           | TypeScript CLI + JSON Outbox + SQLite                                                                                                     |
| 에이전트 조작 | 문서로 계약을 읽고 로컬 Collector를 안전하게 제어 | `/docs/collector.md`·`/llms.txt` + CLI. 향후 얇은 Skill, 원격 상태가 필요할 때만 MCP                                                       |
| Source Adapter | 에이전트별 기록을 공통 이벤트로 변환           | Codex·Claude Code 구현, Hermes 후속                                                                                                       |
| API            | 인증·JSON 수신·마스킹·멱등 접수·조회·수동 분석 | Next.js Route Handlers → Vercel Functions                                                                                                 |
| 분석           | 지표·규칙 분석, AI 요청·결과 검증              | Vercel Workflow가 Functions의 짧은 단계를 실행. [개선 후보 규칙](atlas.md#개선-후보-규칙의-확장)은 개별 모듈·등록 목록·설정으로 추가·제거 |
| Web            | 목록에서 세션 선택, 타임라인·개선안 조회       | Next.js + React. API와 같은 주소·프로젝트                                                                                                 |

공통 이벤트는 세션·턴·모델 요청·도구 실행·사용량이다.  
각 어댑터가 지원 범위를 알리고, 기록에 없는 값은 `0` 대신 `unknown`으로 표시한다.

`packages/contracts`는 두 앱이 공유하는 인터페이스 스키마다. TypeScript 타입·런타임 검증·계약 버전을 함께 관리하며 별도 서버로 배포하지 않는다.

## 데이터 경계

| 경계      | 지킬 것                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 사용자·팀 | 로그인 데이터에 Workspace·소유자 연결. 비로그인 분석은 방문자 접근 토큰·임시 보관 정책 적용. 팀 집계와 원문 열람 권한 분리                                                                                                                                                           |
| 업로드    | Collector는 Zstd, 브라우저 수동 업로드는 JSON을 사용하며 wire 본문은 각각 1 MiB까지 검사. 원본 파일의 JSONL 형식은 어댑터가 해석                                                                                                                                                     |
| 저장      | 서버에서 Workspace의 마스킹 설정을 적용한 JSON을 Storage에 저장 후 DB 등록. 기본 켜짐이며 Settings → Privacy에서 변경. 미등록 객체는 유예 후 정리. 공개 저장소에는 합성 fixture만 포함                                                                                               |
| 중복·재개 | 현재 배치는 `(owner, batch_id)`로 중복 제거. 로컬은 `configure`의 include/exclude/since/until과 `inventory` 집계를 사용하며, 삭제한 세션은 재접수 차단                                                                                                                               |
| 토큰·시간 | 누적·요청별 토큰, 부모·자식 세션, 병렬 실행 중복 집계 방지. 구독 청구액으로 표현하지 않음                                                                                                                                                                                            |
| 작업 복구 | Workflow 재실행을 전제로 작업 키·lease로 중복 분석 방지. AI 예산도 DB에서 원자적 예약. 외부 호출 중 트랜잭션 유지 금지                                                                                                                                                               |
| 재분석    | 원본과 파서·규칙·프롬프트 버전 보존. 규칙 결과와 AI 설명 상태 분리                                                                                                                                                                                                                   |
| 보관·삭제 | 원격 세션 파일·상세 이벤트·전체 분석 결과는 최초 접수부터 **최대 7일**, 간단한 결과 요약만 **최대 30일**. 요약에 원문·도구 출력·상세 근거를 남기지 않음. 재전송·재분석으로 만료 시각을 연장하지 않음. 혼합 배치에서 세션 삭제 시 나머지만 새 객체로 복사·참조 교체 후 이전 객체 삭제 |
| 백업      | Supabase Free는 자동 백업·PITR 미포함. 별도 DB export를 장기 보관하지 않음. 복원 후 서비스 재개 전에 삭제 기록·만료 정책 재적용                                                                                                                                                      |

## 구현 순서

초기 구축 순서는 아래와 같다. 구축 이후의 최우선 과제는 [근거를 보존하는 수집과 증류](#제품의-핵심-근거를-보존하는-수집과-증류)다.

| 단계          | 결과물                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1             | 공통 이벤트 계약 + Codex 어댑터 + 토큰·반복·오류 분석                                                                            |
| 2             | 한국어 대시보드·GitHub 회원가입/로그인·개인 Workspace·언어/테마/개인정보/BYOK 설정 + Supabase 연결 + Vercel 원격 배포            |
| 3             | 전체 세션 지금 분석·선택 세션·단일 세션 분석 + 일일 Workflow + 진행 상태·개별/종합 결과 + 무료 제공자 풀 설명·재시도 검증        |
| 4             | 기존 Codex 기록 최초 가져오기·npm 수집기 릴리스·npx setup·30분 전송·영속 Outbox. 깨끗한 macOS에서 설치·재부팅·업데이트·제거 확인 |
| 5             | 인프라·배포 스크립트와 CI. 오프라인·ACK 유실·마스킹 실패 복구를 포함한 원격 검증                                                 |
| 이후          | Hermes 어댑터 → 팀 → 다른 사용자의 업로드 분석                                                                                   |
| 개인정보 설정 | MVP에서 민감정보 마스킹 켜기·끄기 제공. 기본 켜짐이며 수동 업로드·Collector에 같은 설정 적용                                     |

_구현 예정 순서다. 실제 완료 상태는 [문서 안내](README.md#현재-상태)에서 확인한다._

## 참고 자료

| 자료                                                                                                                                                                                                                          | 반영 범위                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [요즘IT](https://yozm.wishket.com/magazine/detail/3938/) · [Uber 원문](https://www.uber.com/gb/en/blog/efficient-software-factory/)                                                                                           | 세션 기록에서 개선 후보를 찾는 방향. 우버의 16개 규칙·절감률·컨텍스트 그래프는 재현하지 않음 |
| [Codex OTel](https://learn.chatgpt.com/docs/config-file/config-advanced) · [Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)                                                                         | 내장 OTel의 본문 범위 차이. 원본 기록 전송을 기본으로 두고 OTel은 후속 보완                  |
| [Codex Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)                                                                                                                                             | 기존 인증을 이용한 개인 Runner 대안. 공유 서비스 이용 허가로 확대 해석하지 않음              |
| [OpenRouter 모델 목록](https://openrouter.ai/models) · [Free Router](https://openrouter.ai/docs/guides/routing/routers/free-router) · [FAQ](https://openrouter.ai/docs/faq)                                                   | 무료 모델 선택·호출 한도. 실제 품질·처리 완료 시간 보장은 제외                               |
| [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection) · [Provider Logging](https://openrouter.ai/docs/guides/privacy/provider-logging)                                                             | 가격 상한·데이터 정책. 무료 endpoint 적합성은 배포 전 검증                                   |
| [Vercel Git](https://vercel.com/docs/git) · [Hobby](https://vercel.com/docs/plans/hobby)                                                                                                                                      | org public 연동·개인 비상업 무료 운영. 회사 팀 운영은 무료 범위로 가정하지 않음              |
| [Functions](https://vercel.com/docs/functions/limitations) · [Actions 예약 실행](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)                                   | 함수 실행 시간·본문 크기·예약 실행 지연과 비활성화 조건                                      |
| [Workflow](https://vercel.com/docs/workflows) · [요금](https://vercel.com/docs/workflows/pricing) · [Queues 요금](https://vercel.com/docs/queues/pricing)                                                                     | 비동기 단계·재시도·실행 기록 보관. 내부 큐 사용량도 무료 예산에 포함                         |
| [Supabase Storage](https://supabase.com/docs/guides/storage) · [요금](https://supabase.com/pricing)                                                                                                                           | 비공개 저장·서버 업로드·1 GB 저장 제한에 맞춘 보관                                           |
| [Supabase Marketplace](https://vercel.com/marketplace/supabase) · [Supabase 요금](https://supabase.com/pricing)                                                                                                               | 관리 통합과 실제 DB 운영사 구분. 생성 화면의 Free 할당을 배포 전에 대조                      |
| [Vercel Monorepos](https://vercel.com/docs/monorepos) · [Storage API](https://supabase.com/docs/reference/javascript/v1/storage-createbucket)                                                                                 | 단일 레포의 웹 배포 경로·공통 패키지, Supabase Storage 생성·관리 자동화                      |
| [Actions 구성](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) · [Workflow Next.js 공식 예제](https://github.com/vercel/workflow/blob/main/docs/content/docs/v4/getting-started/next.mdx) | 일정 설정과 API 코드 구분, Workflow 코드를 Next.js에 통합·배포                               |
| [npx](https://docs.npmjs.com/cli/v11/commands/npx/) · [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)                                                                                                    | 패키지 실행·CI 게시. 영구 설치·기기 인증·OS 등록은 이 서비스가 별도로 구현                   |

SVG의 글자와 도형은 편집 가능한 원본이다. 공용 아이콘은 내부 벡터로 포함하고 [출처·라이선스](assets/icons/SOURCES.md)를 보존한다.  
한글 로컬 폰트를 우선하고 글자 크기·굵기 체계를 통일한다. 외부 웹폰트에는 의존하지 않는다.
