# Operations and key management

[Portal](README.md) · [Sessions](sessions/README.md) · [Collector](collector.md)

This document records shared deployment, environment, and release procedures. It does not define the Sessions product design.

## 배포: Vercel 중심으로 통합

**GitHub org public 저장소를 본인의 Vercel Hobby에 연결한다.**  
Supabase 서울 프로젝트의 DB·비공개 Storage를 사용하고, Vercel 함수도 서울 `icn1`로 고정한다. GitHub Actions와 외부 AI API의 실행 위치는 별도다.

GitHub OAuth Homepage URL은 `https://agent-session-atlas.vercel.app`, callback은 `https://agent-session-atlas.vercel.app/api/auth/callback/github`로 등록한다.
GitHub OAuth callback, 세션·기기·설정·분석 API, Workflow 시작 경로는 저장소에 구현되어 있다. 0.3.0은 source `557bedc`로 Vercel Ready 배포 `dpl_5fPbfvSjrQTGMoJmU6gtyqvKaMnW`를 확인했다. GitHub Actions [CI run 34578479987](https://github.com/agent-observatory/agent-observatory/actions/runs/34578479987)는 계약 22·Collector 14·웹 29, 총 65개 테스트와 타입 검사·빌드를 통과했다. 2026-09-11 재확인 시 Vercel 프로젝트의 Git link는 없었다.

| 구성요소       | 어디에 배포하나                       | 무료 범위·설계 선택                                                                                                          |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Web · API      | Vercel 서울 `icn1`의 Next.js 프로젝트 | `*.vercel.app`·HTTPS. 별도 VM·도메인 구매 불필요                                                                             |
| 분석 실행      | Vercel Workflow + Functions           | 함수 최대 300초(Fluid Compute). 단계마다 240초 안에 종료·진행 위치 저장                                                      |
| 원본 파일      | **Supabase 비공개 Storage**, 서울     | 무료 저장 1 GB. 공개 버킷 사용 금지                                                                                          |
| PostgreSQL     | **Supabase Free**, 서울               | DB 500 MB. 일반 API 요청 횟수 무제한. 7일간 활동 부족 시 프로젝트 일시 중지 가능                                             |
| AI             | 서버 무료 6개 후보 / OpenAI 호환 BYOK | 설정된 서버 키가 있는 무료 후보만 순서대로 사용. 공통 직렬 슬롯과 cooldown을 적용하며, 제공자 계정 한도 증가는 가정하지 않음 |
| 원격 예약 작업 | GitHub Actions                        | 시간당 DB 확인·만료 정리, 일일 분석 기동. Vercel은 인증된 API·Workflow 실행을 담당                                           |
| 로그인         | 앱 내부 인증 + GitHub OAuth           | 첫 로그인에서 계정·개인 Workspace 생성. 수집기는 폐기 가능한 전송 토큰 사용                                                  |

2026-09-11 공식 문서 확인 기준이다. **Hobby는 개인 비상업 용도**이며 회사 업무·팀 서비스는 플랜을 재검토한다.  
무료 할당은 무기한 가동 보장이 아니다. 한도를 넘으면 기능이 중단될 수 있고 유료 전환은 별도 결정한다.

### 운영 리소스와 연결 상태

**운영 URL에는 0.3.0이 배포됐다.** 식별자·확인 시각은 [ops/production.json](../ops/production.json)에서 관리한다. 다른 환경을 다룬다면 먼저 대상을 확인한다.

| 대상         | 현재 구성                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub       | `agent-observatory/agent-observatory`, 기본 브랜치 `main`                                                                                                  |
| Vercel       | 프로젝트 `agent-observatory`, scope `dans-projects-155a19b3`, Root Directory `apps/web`, Node `22.x`, 함수 `icn1`                                          |
| 웹 주소      | [운영 앱](https://agent-session-atlas.vercel.app) · [Vercel 설정](https://vercel.com/dans-projects-155a19b3/agent-observatory/settings). OAuth·Collector 호환을 위해 canonical URL은 유지한다.                    |
| Supabase     | 프로젝트 `dgmecutgijgegtmrsygo`, 서울 `ap-northeast-2`, Free. [관리 화면](https://supabase.com/dashboard/project/dgmecutgijgegtmrsygo)                       |
| DB·파일      | PostgreSQL `atlas` 스키마와 비공개 `sessions` 버킷. 로그인은 Supabase Auth가 아닌 Auth.js + GitHub OAuth                                                     |
| 파일 제약    | `application/octet-stream` `.json.zst`를 저장하고 compressed body 1 MiB·decoded batch 8 MiB를 적용. 압축 수신 원격 검증 9개와 인증·소유권·삭제 경계 검증 11개 통과 |
| DB 이력      | `001`~`004`와 `20260911072537_session_receipts_devices.sql` 적용 확인. 적용 기록은 `atlas.migrations`                                                                                          |
| Git 연동     | Vercel Git link 없음. main push는 Actions CI를 실행하지만 웹 배포를 자동으로 만들지 않음                                                                     |
| 최근 앱 변경 | source `557bedc`의 0.3.0 배포 `dpl_5fPbfvSjrQTGMoJmU6gtyqvKaMnW`                                                                                             |

### 키 관리와 로컬 환경

**변수 이름은 [.env.example](../.env.example), 실제 값은 Git에서 제외된 로컬 파일과 서비스 환경변수에 둔다.** 다음 표는 이 컴퓨터에서 확인한 역할이며, 새 컴퓨터에 파일이 자동 복원되는 것은 아니다.

| 위치                       | 역할·주의점                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 루트 `.env.local`          | 사용자가 입력한 GitHub OAuth·무료 AI 키와 앱 secret. DB 연결값은 현재 이 파일에 없음                                                            |
| `apps/web/.env.local`      | Next.js가 읽는 앱 환경. DB·Storage·OAuth·AI·앱 secret을 포함. 현재 운영 DB를 가리키므로 격리된 테스트 환경으로 간주하지 않음                    |
| 루트 `.env.remote.local`   | 운영 환경 pull에서 확보한 DB·Storage 연결값. 운영 스크립트 입력                                                                                 |
| 루트 `.env.supabase.local` | Supabase 연결 당시 확보한 환경 사본. 현재 앱/운영 스크립트가 자동으로 읽는 파일은 아님                                                          |
| Vercel Production          | 배포된 앱의 실제 환경. 로컬 파일 수정만으로 바뀌지 않으며, 환경변수 변경 후 새 배포가 필요                                                      |
| GitHub Actions Secrets     | 현재 `SCHEDULER_SECRET`만 등록. 웹·DB·AI 키를 모두 복제하지 않음. `NPM_TOKEN`은 아직 없음                                                       |
| Vercel CLI 로그인          | `vercel login`으로 관리. 현재 Mac의 로그인 세션을 재사용하므로 별도 `VERCEL_TOKEN` 입력은 필요 없음. 인증 파일을 문서·출력·커밋에 복사하지 않음 |
| Collector 기기 토큰        | macOS Keychain. `~/.agent-session-atlas/config.json`은 설정, `state.sqlite`는 읽기 위치·접수 상태. 앱 서비스 키와 별개                          |

키 원문을 열거하는 대신 저장소 루트에서 다음을 실행한다. 이름·존재·로컬 사본 일치 여부·암호화 키 형식만 출력하며, 키의 유효성이나 원격 값 일치까지 보장하지 않는다.

```sh
node scripts/check-environment.mjs
vercel env ls production
gh secret list
```

| 변수                                                  | 쓰임·변경 시 영향                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`                | GitHub OAuth 앱 인증. [OAuth Apps](https://github.com/settings/developers)에서 기존 앱 관리. callback은 이 문서 상단 주소 유지                   |
| `AUTH_SECRET`                                         | 로그인·방문자 인증 서명. 교체 시 기존 인증이 무효화될 수 있으므로 단순 설정 복구에서 재생성하지 않음                                             |
| `BYOK_ENCRYPTION_KEY`                                 | 32바이트 hex AES-256-GCM 키. 잃거나 임의 교체하면 DB에 저장한 사용자 BYOK를 복호화할 수 없음. 새 키 발급과 기존 암호문 이전을 별도 작업으로 설계 |
| `POSTGRES_URL`                                        | 서버·마이그레이션 DB 연결. 비밀번호를 포함하므로 URL 전체 출력 금지                                                                              |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`           | 비공개 파일 접근. service role 키는 서버 전용이며 `NEXT_PUBLIC_`로 복사하지 않음                                                                 |
| `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `ZAI_API_KEY` | 서비스 무료 후보용 키. 설정된 제공자만 사용하며 사용자 BYOK 키와 혼용하지 않음                                                                   |
| `SCHEDULER_SECRET`                                    | Vercel 예약 API와 Actions의 공통 Bearer 값. 변경 시 양쪽을 맞추고 앱을 재배포한 뒤 호출 확인                                                     |
| `APP_URL`                                             | OAuth·Origin 검증 기준 주소. 운영은 고정 `https://agent-session-atlas.vercel.app`                                                                |

현재 `.env.local`에 남은 빈 `VERCEL_TOKEN`과 `ZAI_MAX_CONCURRENCY`는 앱이 사용하지 않는다. 전역 직렬 호출은 코드·DB lease에서 제어하며, `VERCEL_OIDC_TOKEN`은 CLI 배포 인증을 대신하는 장기 키가 아니다. 이들을 채워야 앱이 작동한다고 오해하지 않는다.

`migrate.mjs`·`configure-production.mjs`·`verify-retention.mjs`는 루트 `.env.remote.local` → `.env.local`을 명시적으로 읽는다. `process.loadEnvFile`은 이미 설정된 환경변수를 덮어쓰지 않으므로 shell 값과 먼저 읽은 파일을 주의한다. Next.js와 standalone 스크립트의 로딩 경로가 같다고 가정하지 않는다.

**기존 파일에 `vercel env pull --yes`를 실행하지 않는다.** 새로 확보해야 한다면 별도 Git 제외 파일 `.env.vercel-pull.local`에 받고, 필요한 이름만 기존 사본과 비교해 병합한다. Sensitive 변수는 원문을 다시 읽을 수 없으므로 pull에 없다고 기존 값을 빈 값으로 덮어쓰지 않는다. [.env pull](https://vercel.com/docs/cli/env) · [Sensitive 변수](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

한 키를 변경할 때는 대상을 지정해 Vercel에 갱신하고, 해당 값을 사용하는 로컬 사본만 함께 맞춘다. 값은 대화·셸 명령 인자에 직접 쓰지 않고 대화형 입력이나 프로세스 stdin으로 전달한다. `configure-production.mjs`는 프로젝트 설정과 여러 키를 `--force`로 덮어쓰므로 평소 재개·확인용으로 실행하지 않는다.

### 배포와 운영 명령

**아래 명령은 저장소 루트에서 실행한다.** Vercel의 Root Directory 설정이 `apps/web`를 선택하므로 CLI 실행 위치까지 무작정 `apps/web`로 바꾸지 않는다. 현재 로컬 도구는 Node 22·pnpm 9.12.1·Vercel CLI 50.0.1이며 새 환경에서는 설치 버전을 확인한다.

새 clone에서 `.vercel/project.json`이 없을 때만 기존 프로젝트에 연결한다. CLI 로그인이 없다면 `vercel login`, GitHub CLI 인증이 없다면 `gh auth login`을 사용한다.

```sh
vercel link --yes --project agent-observatory --scope dans-projects-155a19b3
vercel project inspect agent-observatory
node scripts/check-environment.mjs
pnpm install --frozen-lockfile
```

| 작업                  | 실제 명령·영향                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 코드 검증             | `pnpm test`, `pnpm build`, `pnpm typecheck`                                                                                                               |
| 웹 운영 배포          | 검증 후 `vercel --prod --yes --scope dans-projects-155a19b3`. 현재 작업 디렉터리를 업로드하므로 커밋·미커밋 범위를 먼저 확인                              |
| 배포 상태             | `vercel inspect https://agent-session-atlas.vercel.app`. Ready·Production·alias·`icn1`을 확인하고 배포 ID를 기록                                          |
| DB migration          | SQL 변경 시에만 `node scripts/migrate.mjs`. 실제 원격 DB를 변경하며 `atlas.migrations`에 없는 파일을 트랜잭션으로 적용                                    |
| 프로젝트·키 일괄 설정 | `node scripts/configure-production.mjs`. 초기 구성용 변경 스크립트. 기존 로컬 Vercel 인증 파일 경로에 의존하므로 다른 OS에서 그대로 실행하지 않음         |
| 원격 기능 smoke       | `ATLAS_SMOKE_REPORT=ops/free-routing-remote-smoke.json node scripts/smoke-remote.mjs`. 합성 업로드·AI 호출·단건/선택/전체 분석을 실행하며 quota를 사용    |
| 인증·소유권 경계      | `node scripts/verify-boundaries.mjs`. 합성 원격 변경 포함                                                                                                 |
| 보관 정책             | `node scripts/verify-retention.mjs`. 합성 데이터 생성·삭제와 실제 유지관리 API 호출 포함. 만료된 운영 데이터 정리도 실행될 수 있음                        |
| 제공자 연결           | `pnpm exec tsx scripts/verify-free-providers.ts`. 로컬 키로 외부 합성 호출, 호출량 사용                                                                   |
| 압축 비교             | `pnpm exec tsx scripts/benchmark-compression.ts --synthetic`. 실제 기록을 읽는 실행은 [Collector 측정 절차](collector.md#로컬-압축-비교--2026-09-11) 참고 |
| CI 확인               | `gh run list --workflow ci.yml`, `gh run view <run-id>`. CLI 배포와 별도 확인                                                                             |
| 앱 rollback           | 검증된 이전 배포를 지정해 `vercel rollback <deployment-url-or-id>`. DB·환경변수 변경을 자동으로 되돌리지는 않음                                           |

`pnpm infra:*`, `pnpm db:migrate`, `pnpm deploy:*`, `pnpm smoke:remote` 별칭과 `scripts/infra.ts`는 구현되어 있지 않다. 위 실제 명령을 사용한다.

DB 인증서 검증은 앱 `apps/web/lib/certs/supabase.crt`, 운영 스크립트 `ops/certs/supabase-prod-ca-2021.crt`를 사용한다. `rejectUnauthorized: true`를 유지하고 인증 오류를 우회하기 위해 TLS 검증을 끄지 않는다. 현재 연결 코드는 `POSTGRES_URL`과 `prepare: false`를 사용한다. SQL 변경은 새 계약·앱·Collector와 함께 적용하고 검증한다. 초기 개발 단계에서는 이전 버전과의 호환성을 유지하지 않는다.

Preview 환경은 아직 별도 DB·Storage·OAuth·키가 준비되지 않았다. 운영 자격증명을 그대로 복사해 Preview 검증을 구성하지 않는다. [환경변수 변경](https://vercel.com/docs/environment-variables)은 새 배포에 반영되므로 env 수정 성공과 운영 반영 성공을 구분한다.

### GitHub Actions와 Collector 릴리스

| 작업             | 파일·일정(UTC)                                    | 재확인한 상태                                                                                                                            |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CI               | `ci.yml`, main push·PR                            | 테스트·빌드·타입 검사. 웹 배포 단계 없음                                                                                                 |
| 유지관리         | `maintenance.yml`, `17 * * * *`                   | [자연 예약 성공](https://github.com/agent-observatory/agent-observatory/actions/runs/34549506560) 확인. 정시 실행 보장은 아님          |
| 일일 분석        | `analysis-daily.yml`, `37 18 * * *`               | KST 다음 날 03:37. [수동 실행 성공](https://github.com/agent-observatory/agent-observatory/actions/runs/34536855783), 자연 예약 미관찰 |
| Collector 릴리스 | `collector-release.yml`, `collector-v*` GitHub Release 발행·태그 지정 수동 | 테스트·패키징 → Release tarball 첨부 → npm OIDC 게시. npm Trusted Publisher 연결 필요                                                                    |

`gh workflow run maintenance.yml`은 만료 정리를, `gh workflow run analysis-daily.yml`은 분석 기동을 실제 실행한다. 단순 상태 조회로 사용하지 않는다. Actions는 `SCHEDULER_SECRET`으로 고정 API만 호출하고, DB·AI 키는 Vercel에 둔다. 접수 `202`와 Workflow 분석 완료는 별개다.

웹·Collector는 각각 `observatory-vX.Y.Z`, `collector-vX.Y.Z`로 버전을 관리한다. 기존 `atlas-v*` 태그는 과거 릴리스 기록으로 유지한다. Collector GitHub Release를 발행하면 workflow가 tarball을 첨부하고 npm에 게시한다. GitHub Release 생성과 npm 게시 완료는 별도 상태이므로 Actions 결과와 레지스트리를 각각 확인한다.

### 무료 운영 범위

| 항목      | MVP에서 적용할 상한                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 원본      | 마스킹 설정을 적용한 `.json.zst` 세션 파일은 최초 접수부터 **최대 7일** 보관 후 삭제. 마스킹 여부·로그인 여부와 무관하게 같은 최대 기간 적용. 전체 파일 **700 MB**에서 새 전송 중지하고 로컬 대기. 실제 compressed stored bytes로 제한                                              |
| 크기 예산 | 하루 신규 기록 총 40 MB 가정 시 7일 약 280 MB. 세션 전체 재전송 없이 추가분만 전송                                                                                                                                                                                                  |
| 파일 요청 | 30분마다 목적지별 변경분 전송. Collector compressed wire와 브라우저 JSON wire는 **1 MiB**, decoded batch는 **8 MiB**, JSONL 한 줄은 **64 MiB**, 세션 분석은 decoded 합계 **40 MiB**, 작업당 세션은 **2,000개**, 배치 이벤트는 **1,000개**까지다. 초과 source는 자르지 않고 격리한다 |
| DB        | 지표·메타데이터·근거 위치 위주. 전체 도구 출력은 비공개 Storage에 두고 DB 350 MB에서 신규 입력 제한                                                                                                                                                                                 |
| 함수      | Hobby 4 CPU-hours·360 GB-hours/월. 대기에도 메모리 시간이 잡히므로 긴 대기는 Workflow로 넘김                                                                                                                                                                                        |
| Workflow  | 월 50,000 events·기록 1 GB, 내부 Queues 월 100만 operations 무료 범위까지 함께 확인                                                                                                                                                                                                 |
| 상세 결과 | 상세 이벤트·세션별 지표·전체 분석 결과·근거는 **최대 7일** 보관·제공                                                                                                                                                                                                                |
| 결과 요약 | 짧은 결론과 집계 지표만 **최대 30일** 보관·제공. 원문·도구 출력·상세 근거·전체 AI 응답은 포함하지 않음                                                                                                                                                                              |
| 관측      | 분석 Workflow 시작 시 `experimental_retention: 0`을 사용해 실행 기록을 즉시 정리. 제품 결과는 Supabase DB에 저장하되 세션 보관 정책을 적용. 로그에 세션 내용·분석 결과를 복제하지 않음                                                                                              |

Supabase의 500 MB 제한은 DB 용량이며, 세션 본문 파일은 별도 비공개 Storage에 저장한다. 무료 비캐시 전송량은 월 5 GB이며 DB·Storage 사용량을 함께 확인한다. [요금](https://supabase.com/pricing)
원격 데이터의 보관 기준은 최초 접수 시각이다. 상세 데이터·세션 메타데이터·배치 접수증·전체 분석 결과는 이 시각부터 7일, 결과 요약은 30일에 만료한다. 유지관리 작업은 7일이 지난 상세 데이터와 오래된 Storage 객체를 정리하고, 1시간 넘은 orphan Storage 객체를 DB와 대조해 정리한다. DB 사용량이 350 MiB에 도달하면 새 입력을 막는다. 중복 전송·재분석·혼합 배치 재작성으로 만료 시각을 연장하지 않는다. 여러 기록을 묶은 결과는 포함된 기록 중 가장 이른 만료 시각을 따른다.
만료된 데이터는 삭제하며 조회·검색·다운로드·재분석에서도 제공하지 않는다. 7일이 지나면 간단한 결과 요약만 볼 수 있고, 30일이 지나면 요약도 삭제한다. 비로그인·로그인 모두 같은 최대 기간을 적용한다.
보관 기간 연장은 향후 유료 플랜이나 사내 운영 환경에서 다룬다. 현재 MVP에는 기간 연장 설정을 제공하지 않는다.
계정·인증·설정과 계정 자격증명은 세션·분석 이력과 구분해 보관하며, 세션 데이터의 7일·30일 보관 정책에 포함하지 않는다. 재전송 방지용 접수 정보는 배치 접수증 정리 시 함께 삭제되며, 모든 접수증이 삭제된 뒤 같은 원본을 보내면 새 import로 처리한다. 같은 기존 레코드의 재전송·재분석은 TTL을 연장하지 않는다. 로컬 에이전트 원본과 미접수 Outbox의 삭제 정책은 [Collector](collector.md#30분-전송과-장애-복구)를 따른다.

재시도·분할·목록 조회·세션 삭제를 위한 객체 재작성도 요청량에 포함한다. 무료 한도 부족 시 대기·주기 조정·플랜 변경 중 선택한다.
같은 계정의 다른 프로젝트 사용량과 Preview도 예산에 포함한다. 함수·Storage 전송량은 무료 사용량 화면에서 함께 확인한다.  
상한의 80%에서 화면에 알리고, 한도에 닿기 전에 새 입력·AI 재시도를 멈춘다.

### 비동기 실행과 배포 완료 조건

| 단계      | 구현·확인할 내용                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 업로드    | Collector는 Zstd body, 브라우저는 JSON body로 Next.js에 전송한다. 서버가 이미지 data URL을 제거하고 Workspace 마스킹을 적용한 뒤 `.json.zst`를 서버 자격증명으로 Supabase Storage에 저장 |
| 접수      | 설정을 적용한 객체 저장 후 배치·세션 변경 정보를 Supabase DB에 COMMIT하고 ACK. 분석은 Actions·수동 API가 별도 등록                                                                       |
| 규칙 분석 | 확정한 배치 목록의 `.json.zst`를 해제해 전체 지표·규칙을 계산하고, 결정적 근거 선택 결과를 저장. decoded 합계 40 MiB를 제한                                                              |
| AI 설명   | 근거만 읽어 호출·검증·저장. 120초 요청 timeout, 지연은 Workflow sleep 후 재개. 브라우저 종료와 무관                                                                                      |
| 운영 배포 | org public 연결 → Supabase DB·Supabase Storage 생성 → 환경변수 설정 → 마이그레이션 → Vercel 운영 배포. DB와 함수는 같은 리전 우선                                                        |
| 배포 검증 | 30분 전송·수동/일일 분석·조회·삭제 확인. 서버 장애와 ACK 유실 후 재전송해도 중복 없는지 검증                                                                                             |
| 재배포    | PR Preview는 합성 데이터·별도 DB/Storage. 운영 자격증명을 전달하지 않고 CI 통과 후 main 병합                                                                                             |
| 복구      | 앱·Collector·DB를 같은 계약 기준으로 복구. 필요한 임시 DB export도 비밀값·7일/30일 보관 정책을 지키며 앱 rollback과 DB 복원을 별도로 검증                                                |

Functions의 **4.5 MB 본문 제한** 안에서 동작하도록, Collector compressed body와 브라우저 JSON body를 각각 **1 MiB** 이하로 제한한다.
큰 입력은 이벤트 경계로 배치를 나누며, 단일 이벤트도 초과하면 조용히 자르지 않고 격리·표시한다.  
Workflow에는 ID·진행 위치만 넘기고, 파일 내용이나 전체 모델 응답을 실행 기록에 중복 저장하지 않는다.

[데이터 경계](README.md#데이터-경계) · [참고 자료](README.md#참고-자료)

DB CA 출처: [Supabase 공식 인증서](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). [Workflow 리전·버전 제약](https://vercel.com/docs/workflows#version-and-migration).

## Collector npm publishing

2026-09-11 기준 패키지는 `@agent-observatory/collector`, npm 조직은 `agent-observatory`다. 최초 게시는 조직 게시 권한이 있는 계정으로 `npm login` 후 검증한 tarball을 게시한다. 이후 npm 패키지 설정의 Trusted Publisher를 다음과 같이 연결한다.

| 항목 | 값 |
| --- | --- |
| Provider | GitHub Actions |
| Organization | `agent-observatory` |
| Repository | `agent-observatory` |
| Workflow filename | `collector-release.yml` |
| Environment | 비움 |
| Allowed actions | 직접 `npm publish` 허용 |

워크플로는 Node 24·npm 11.5.1 이상과 `id-token: write`를 사용한다. 장기 `NPM_TOKEN`은 사용하지 않는다. Collector 버전과 일치하는 `collector-vX.Y.Z` GitHub Release를 발행하면 실행하며 웹의 `observatory-v*` 또는 기존 `atlas-v*` 릴리스는 제외한다. 사전 릴리스는 npm `next`, 정식 릴리스는 `latest`로 게시한다. 동일 npm 버전은 덮어쓸 수 없으므로 실패 재시도 전에 게시 여부를 확인한다. Release와 npm의 성공 여부를 각각 확인한다.

[공식 Trusted Publishing 안내](https://docs.npmjs.com/trusted-publishers/)
