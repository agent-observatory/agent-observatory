# 실제 작업 기록

**초기 앱 구현·배포·원격 검증과 당시 기록 작성까지 62분 45초 걸렸다.** 이후 변경은 아래 날짜별 기록을 따른다. 현재 상태는 [문서 안내](README.md#현재-상태)에서 확인한다.

- 시작: 2026-09-11 06:32:14 KST — 초기 scaffold 파일 `pnpm-workspace.yaml` 생성 시각.
- 종료: 2026-09-11 07:34:59 KST — 배포·검증·릴리스 후 기록 작성 시각.
- 이전 설계·인프라 준비 대화는 제외했다. 모델별 실제 토큰 사용량은 별도 집계하지 않았다.
- Astra가 통합·보안 경계·배포를 맡고, Luna가 Collector 보강·대시보드 보완·문서 정리를 맡았다.

| 항목 | 상태 | 확인한 내용 |
|---|---|---|
| 코드·빌드 | 로컬·CI 통과 | 공통 계약·웹·Collector 독립 0.1.0. 계약 6건·Collector 6건·웹 SSRF 1건, 총 13건 통과. 전체 빌드·타입 검사 통과 |
| 회원가입·로그인 | 실제 브라우저 검증 | GitHub OAuth로 Hyune-c 계정과 개인 공간 생성. 로그아웃·재로그인 후 기록·설정 유지 |
| 언어·테마 | 실제 브라우저 검증 | 한국어/English와 다크/라이트 전환·저장·복원 |
| 접수·마스킹 | 원격 합성 검증 | 업로드·중복 ACK·소유자별 목록·AI 입력 마스킹 확인 |
| 수동 분석 | 원격 합성 검증 | 단건 AI 분석 완료, 선택·전체 분석 완료와 기존 결과 재사용. 한국어 결과·지표·실제 모델 표시 확인. [검증 기록](../ops/remote-smoke.json) |
| 일일 분석 | 원격 완료 확인 | Actions 호출 후 2개 항목 완료. 그중 1개는 백오프 후 두 번째 시도에서 완료. 성공 뒤 고정 지연 없이 전역 동시 호출 1개 유지 |
| 보안·보관 | 원격 합성 검증 | 소유권·Origin·인증·변경 배치 충돌 등 8건, 만료 조회 차단·상세 7일 삭제·요약 30일 보존/삭제 등 5건 통과 |
| 로컬 Collector | 설치·연결 완료 | 전역 `atlas-collector`와 관리형 실행 파일 설치. LaunchAgent 하나·1,800초 간격. 일회용 코드로 계정 연결, 토큰은 macOS Keychain 저장 |
| Collector 전송 | 원격 합성 검증 | 합성 세션 2개. 첫 동기화 `sent: 2`, 두 번째 `sent: 0`. 중복 전송 방지 확인 |
| 개인 기록 | 미전송·자동 수집 중지 | 최초 가져오기 범위를 확인하도록 `paused: true`. 로컬 inventory는 74개 프로젝트·1,083개 세션·약 1.19 GB. 경로와 본문은 저장소에 기록하지 않음 |
| 운영 배포 | READY 확인 | [Atlas](https://agent-session-atlas.vercel.app), Next.js 16.3.4·Node 22·함수 `icn1`. 배포 `dpl_5gTEvkph4akNnxX1yinKyEJfwkKv`, 소스 `3a455ba` |
| GitHub Actions | 원격 검증 | [최종 CI](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34537442562), [유지관리](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34536852830), [일일 분석 기동](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34536855783), [Collector 패키징](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34536858875) 성공 |
| 독립 릴리스 | 공개 확인 | [Atlas 0.1.0](https://github.com/agent-observatory/agent-session-atlas/releases/tag/atlas-v0.1.0), [Collector 0.1.0](https://github.com/agent-observatory/agent-session-atlas/releases/tag/collector-v0.1.0). Collector tarball 설치 가능 |

## 사용 시작

[Atlas](https://agent-session-atlas.vercel.app)에서 GitHub로 로그인한다. 이 컴퓨터의 Collector는 이미 계정에 연결되어 있다.

```sh
atlas-collector inventory
# 필요하면 configure --include /path/to/project 또는 --since ISO_DATE로 범위를 줄인다.
atlas-collector sync
```

한 번의 동기화는 최대 20개 배치를 보낸다. 오래된 기록이 많으면 여러 번 실행해 남은 기록을 전송한다. 웹에서 **전체 세션 지금 분석** 또는 세션별 분석을 실행한다. 이후 30분 자동 동기화는 `atlas-collector resume`, 중지는 `atlas-collector pause`다.

## 남은 연결 작업과 검증 범위

| 항목 | 현재 상태 |
|---|---|
| npm 공개 게시 | `npm whoami`가 `ENEEDAUTH`. npm 인증이 필요하다. 현재 GitHub Release tarball과 로컬 설치는 사용 가능 |
| push 후 웹 자동 배포 | Vercel GitHub App에 이 저장소 접근을 허용하는 사용자 승인 대기. 현재 운영 서비스는 CLI로 배포 완료 |
| 자연 예약 실행 | 유지관리 자연 예약 성공을 추가 확인했다. 일일 분석은 수동 실행 성공, 자연 예약은 아직 미관찰 |
| BYOK | endpoint·키 암호화 저장·연결 확인 UI와 SSRF 검사 구현. 실제 개인 BYOK 키 호출은 미검증 |
| 분석 품질 | 합성 데이터의 결과 형식·근거·마스킹·복구를 검증했다. 실제 개인 기록의 장기 분석 품질은 아직 평가하지 않음 |

실제 세션 본문과 자격증명은 저장소에 넣지 않았다. 검증에는 합성 데이터를 사용했다.


## 2026-09-11 — 무료 모델 풀과 결과 출처

구현 파일 생성부터 최종 원격·화면 검증까지 약 17분 걸렸다(12:51:22~13:08 KST). 앞선 모델 조사와 이후 커밋·CI 대기는 제외했다. Astra가 라우팅·통합·원격 검증을 맡고 Terra 에이전트가 UI와 설계 문서를 보완했다.

| 항목 | 구현·검증 결과 |
|---|---|
| 무료 후보 | NVIDIA 3개, OpenRouter 2개, Z.ai 1개. 키가 설정된 후보만 고정 우선순위와 가용 상태로 선택 |
| 실패 복구 | 모델 오류는 해당 모델만 대기하고 다음 후보 사용. 계정 인증·공유 quota 오류는 제공자 전체를 대기. 같은 제공자 내 전환과 공유 한도 차단은 모의 응답 테스트 통과 |
| 호출 경계 | 서비스 전체 직렬 호출 1개 유지. 모두 대기하면 Workflow가 백오프 후 재개. BYOK는 지정 endpoint·모델·개인 키만 사용 |
| 결과 표시 | 무료 티어/BYOK·API 제공자·실제 응답 모델 표시. 요청 모델·upstream provider·자격증명 없는 시도 이력도 저장. 기존 Z.ai 설정과 과거 결과 호환 |
| 환경변수 | 로컬 NVIDIA·OpenRouter 키를 Vercel Production에 반영. 실제 값은 저장소·검증 보고서에 기록하지 않음 |
| 로컬 검증 | 계약 6·Collector 6·웹 14, 총 26개 테스트. 전체 타입 검사와 웹 빌드 통과. BYOK 격리·무료 가격 조건·근거 ID·오류 범위·이전 결과 표시 검증 |
| 실호출 | 로컬 Kimi timeout, Nex Pro·GLM Flash 성공. 초기 원격 Kimi 성공. 최종 원격은 Kimi timeout → Nex Pro HTTP 200으로 전환 후 합성 분석 완료 |
| 원격 전체 흐름 | 무료 후보 목록·업로드·중복 ACK·소유권·마스킹·분석·실제 모델·선택/전체 결과 재사용 통과. [검증 보고서](../ops/free-routing-remote-smoke.json) |
| 운영 배포 | `dpl_FxRmjGjonyCtt8TaMft9hWjxBTCp` Ready·Production·`icn1`. [Atlas](https://agent-session-atlas.vercel.app)에 최종 6개 후보 코드 배포 |
| 화면·그림 | 운영 Edge 설정에서 6개 후보와 다크/라이트 가독성 확인 후 기존 다크로 복원. 아키텍처 SVG XML 검사와 렌더링 확인 |
| 검증 범위 | DeepSeek·Nemotron·Nex Mini 개별 실호출, 실제 개인 기록의 분석 품질, 사용자 BYOK 실호출은 이번 검증에 포함하지 않음 |

원격 호출 성공은 장기 가용성이나 무료 quota 보장이 아니다. 후보를 늘려도 같은 제공자의 계정 한도는 공유한다.

## 2026-09-11 — 로컬 압축·저장량 측정

합성 파이프라인 검증 후 실제 로컬 기록을 격리된 Collector 상태로 측정했다. 실측 실행은 약 100초였으며 조사·스크립트 작성·문서 작성 시간은 제외했다. 원본·설치된 수집기 상태를 변경하지 않았고 임시 Outbox는 삭제했다. 실제 세션 업로드·AI 호출·운영 배포는 수행하지 않았다.

현재 수집 가능한 1,303개 배치의 마스킹 후 JSON 204.9 MB는 Zstd 3에서 49.3 MB, gzip 6에서 53.7 MB, LZ4 기본에서 77.0 MB였다. 모든 복원 결과가 원본 바이트와 일치했다. 큰 이벤트로 중단된 34개 파일과 미확정 원본 구간 656.4 MB를 절감량에서 분리했다. 지표·규칙·타임라인 결과 JSON은 별도 43.5 MB이며 AI 응답과 DB 물리 용량은 미측정이다.

Zstd 3을 우선 도입 후보로 정했으며 제품 압축 경로는 아직 미구현이다. [범위·방법·비교표](collector.md#로컬-압축-비교--2026-09-11) · [원문 없는 집계 보고서](../ops/compression-local.json)


## 2026-09-11 — 에이전트 인계와 운영 문서 정리

Claude Code의 `CLAUDE.md`가 `AGENTS.md`를 가져오도록 추가했다. 상세 운영 절차는 Atlas 문서로 모으고, 존재하지 않는 pnpm 별칭·인프라 스크립트 대신 실제 명령을 기록했다. 환경변수 점검 스크립트는 파일을 읽기만 하며 이름·존재·일치 여부만 출력한다.

운영 재조회에서 Vercel Ready·Production·`icn1`과 Git 미연결, Production 변수 이름, GitHub의 `SCHEDULER_SECRET`, Supabase DB migration 001~004·서울 pooler·비공개 JSON 버킷을 확인했다. 유지관리 자연 예약 성공도 현재 상태에 반영했다. 로컬 앱 키 사본은 일치했고 Collector는 일시 중지 상태였다. 키 원문 변경·회전, 배포, 실제 세션 업로드는 수행하지 않았다.

`ops/production.json`의 예전 단일 Z.ai·초기 배포 정보를 갱신했다. CLI 작업 디렉터리 배포와 나중에 기록한 커밋을 구분했다. Claude Code의 실제 새 세션 로딩은 아직 실행하지 않았으며, [공식 import 방식](https://code.claude.com/docs/en/memory#agentsmd)과 로컬 파일 경로를 확인했다.
