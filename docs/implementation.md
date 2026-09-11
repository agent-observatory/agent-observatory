# 실제 작업 기록

**초기 앱 구현·배포·원격 검증과 당시 기록 작성까지 62분 45초 걸렸다.** 이후 변경은 아래 날짜별 기록을 따른다. 현재 상태는 [문서 안내](README.md#현재-상태)에서 확인한다.

- 시작: 2026-09-11 06:32:14 KST — 초기 scaffold 파일 `pnpm-workspace.yaml` 생성 시각.
- 종료: 2026-09-11 07:34:59 KST — 배포·검증·릴리스 후 기록 작성 시각.
- 이전 설계·인프라 준비 대화는 제외했다. 모델별 실제 토큰 사용량은 별도 집계하지 않았다.
- Astra가 통합·보안 경계·배포를 맡고, Luna가 Collector 보강·대시보드 보완·문서 정리를 맡았다.

| 항목            | 상태                  | 확인한 내용                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 코드·빌드       | 로컬·CI 통과          | 공통 계약·웹·Collector 독립 0.1.0. 계약 6건·Collector 6건·웹 SSRF 1건, 총 13건 통과. 전체 빌드·타입 검사 통과                                                                                                                                                                                                                                                                                                |
| 회원가입·로그인 | 실제 브라우저 검증    | GitHub OAuth로 Hyune-c 계정과 개인 공간 생성. 로그아웃·재로그인 후 기록·설정 유지                                                                                                                                                                                                                                                                                                                            |
| 언어·테마       | 실제 브라우저 검증    | 한국어/English와 다크/라이트 전환·저장·복원                                                                                                                                                                                                                                                                                                                                                                  |
| 접수·마스킹     | 원격 합성 검증        | 업로드·중복 ACK·소유자별 목록·AI 입력 마스킹 확인                                                                                                                                                                                                                                                                                                                                                            |
| 수동 분석       | 원격 합성 검증        | 단건 AI 분석 완료, 선택·전체 분석 완료와 기존 결과 재사용. 한국어 결과·지표·실제 모델 표시 확인. [검증 기록](../ops/remote-smoke.json)                                                                                                                                                                                                                                                                       |
| 일일 분석       | 원격 완료 확인        | Actions 호출 후 2개 항목 완료. 그중 1개는 백오프 후 두 번째 시도에서 완료. 성공 뒤 고정 지연 없이 전역 동시 호출 1개 유지                                                                                                                                                                                                                                                                                    |
| 보안·보관       | 원격 합성 검증        | 소유권·Origin·인증·변경 배치 충돌 등 8건, 만료 조회 차단·상세 7일 삭제·요약 30일 보존/삭제 등 5건 통과                                                                                                                                                                                                                                                                                                       |
| 로컬 Collector  | 설치·연결 완료        | 전역 `atlas-collector`와 관리형 실행 파일 설치. LaunchAgent 하나·1,800초 간격. 일회용 코드로 계정 연결, 토큰은 macOS Keychain 저장                                                                                                                                                                                                                                                                           |
| Collector 전송  | 원격 합성 검증        | 합성 세션 2개. 첫 동기화 `sent: 2`, 두 번째 `sent: 0`. 중복 전송 방지 확인                                                                                                                                                                                                                                                                                                                                   |
| 개인 기록       | 미전송·자동 수집 중지 | 최초 가져오기 범위를 확인하도록 `paused: true`. 로컬 inventory는 74개 프로젝트·1,083개 세션·약 1.19 GB. 경로와 본문은 저장소에 기록하지 않음                                                                                                                                                                                                                                                                 |
| 운영 배포       | READY 확인            | [Atlas](https://agent-session-atlas.vercel.app), Next.js 16.3.4·Node 22·함수 `icn1`. 배포 `dpl_5gTEvkph4akNnxX1yinKyEJfwkKv`, 소스 `3a455ba`                                                                                                                                                                                                                                                                 |
| GitHub Actions  | 원격 검증             | [최종 CI](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34537442562), [유지관리](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34536852830), [일일 분석 기동](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34536855783), [Collector 패키징](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34536858875) 성공 |
| 독립 릴리스     | 공개 확인             | [Atlas 0.1.0](https://github.com/agent-observatory/agent-session-atlas/releases/tag/atlas-v0.1.0), [Collector 0.1.0](https://github.com/agent-observatory/agent-session-atlas/releases/tag/collector-v0.1.0). Collector tarball 설치 가능                                                                                                                                                                    |

## 사용 시작

[Atlas](https://agent-session-atlas.vercel.app)에서 GitHub로 로그인한다. 이 컴퓨터의 Collector는 이미 계정에 연결되어 있다.

```sh
atlas-collector inventory
# 필요하면 configure --include /path/to/project 또는 --since ISO_DATE로 범위를 줄인다.
atlas-collector sync
```

한 번의 동기화는 최대 20개 배치를 보낸다. 오래된 기록이 많으면 여러 번 실행해 남은 기록을 전송한다. 웹에서 **전체 세션 지금 분석** 또는 세션별 분석을 실행한다. 이후 30분 자동 동기화는 `atlas-collector resume`, 중지는 `atlas-collector pause`다.

## 남은 연결 작업과 검증 범위

| 항목                 | 현재 상태                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| npm 공개 게시        | `npm whoami`가 `ENEEDAUTH`. npm 인증이 필요하다. 현재 GitHub Release tarball과 로컬 설치는 사용 가능      |
| push 후 웹 자동 배포 | Vercel GitHub App에 이 저장소 접근을 허용하는 사용자 승인 대기. 현재 운영 서비스는 CLI로 배포 완료        |
| 자연 예약 실행       | 유지관리 자연 예약 성공을 추가 확인했다. 일일 분석은 수동 실행 성공, 자연 예약은 아직 미관찰              |
| BYOK                 | endpoint·키 암호화 저장·연결 확인 UI와 SSRF 검사 구현. 실제 개인 BYOK 키 호출은 미검증                    |
| 분석 품질            | 합성 데이터의 결과 형식·근거·마스킹·복구를 검증했다. 실제 개인 기록의 장기 분석 품질은 아직 평가하지 않음 |

실제 세션 본문과 자격증명은 저장소에 넣지 않았다. 검증에는 합성 데이터를 사용했다.

## 2026-09-11 — 무료 모델 풀과 결과 출처

구현 파일 생성부터 최종 원격·화면 검증까지 약 17분 걸렸다(12:51:22~13:08 KST). 앞선 모델 조사와 이후 커밋·CI 대기는 제외했다. Astra가 라우팅·통합·원격 검증을 맡고 Terra 에이전트가 UI와 설계 문서를 보완했다.

| 항목           | 구현·검증 결과                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 무료 후보      | NVIDIA 3개, OpenRouter 2개, Z.ai 1개. 키가 설정된 후보만 고정 우선순위와 가용 상태로 선택                                                                     |
| 실패 복구      | 모델 오류는 해당 모델만 대기하고 다음 후보 사용. 계정 인증·공유 quota 오류는 제공자 전체를 대기. 같은 제공자 내 전환과 공유 한도 차단은 모의 응답 테스트 통과 |
| 호출 경계      | 서비스 전체 직렬 호출 1개 유지. 모두 대기하면 Workflow가 백오프 후 재개. BYOK는 지정 endpoint·모델·개인 키만 사용                                             |
| 결과 표시      | 무료 티어/BYOK·API 제공자·실제 응답 모델 표시. 요청 모델·upstream provider·자격증명 없는 시도 이력도 저장. 기존 Z.ai 설정과 과거 결과 호환                    |
| 환경변수       | 로컬 NVIDIA·OpenRouter 키를 Vercel Production에 반영. 실제 값은 저장소·검증 보고서에 기록하지 않음                                                            |
| 로컬 검증      | 계약 6·Collector 6·웹 14, 총 26개 테스트. 전체 타입 검사와 웹 빌드 통과. BYOK 격리·무료 가격 조건·근거 ID·오류 범위·이전 결과 표시 검증                       |
| 실호출         | 로컬 Kimi timeout, Nex Pro·GLM Flash 성공. 초기 원격 Kimi 성공. 최종 원격은 Kimi timeout → Nex Pro HTTP 200으로 전환 후 합성 분석 완료                        |
| 원격 전체 흐름 | 무료 후보 목록·업로드·중복 ACK·소유권·마스킹·분석·실제 모델·선택/전체 결과 재사용 통과. [검증 보고서](../ops/free-routing-remote-smoke.json)                  |
| 운영 배포      | `dpl_FxRmjGjonyCtt8TaMft9hWjxBTCp` Ready·Production·`icn1`. [Atlas](https://agent-session-atlas.vercel.app)에 최종 6개 후보 코드 배포                         |
| 화면·그림      | 운영 Edge 설정에서 6개 후보와 다크/라이트 가독성 확인 후 기존 다크로 복원. 아키텍처 SVG XML 검사와 렌더링 확인                                                |
| 검증 범위      | DeepSeek·Nemotron·Nex Mini 개별 실호출, 실제 개인 기록의 분석 품질, 사용자 BYOK 실호출은 이번 검증에 포함하지 않음                                            |

원격 호출 성공은 장기 가용성이나 무료 quota 보장이 아니다. 후보를 늘려도 같은 제공자의 계정 한도는 공유한다.

## 2026-09-11 — 로컬 압축·저장량 측정

합성 파이프라인 검증 후 실제 로컬 기록을 격리된 Collector 상태로 측정했다. 실측 실행은 약 100초였으며 조사·스크립트 작성·문서 작성 시간은 제외했다. 원본·설치된 수집기 상태를 변경하지 않았고 임시 Outbox는 삭제했다. 실제 세션 업로드·AI 호출·운영 배포는 수행하지 않았다.

현재 수집 가능한 1,303개 배치의 마스킹 후 JSON 204.9 MB는 Zstd 3에서 49.3 MB, gzip 6에서 53.7 MB, LZ4 기본에서 77.0 MB였다. 모든 복원 결과가 원본 바이트와 일치했다. 큰 이벤트로 중단된 34개 파일과 미확정 원본 구간 656.4 MB를 절감량에서 분리했다. 지표·규칙·타임라인 결과 JSON은 별도 43.5 MB이며 AI 응답과 DB 물리 용량은 미측정이다.

Zstd 3을 우선 도입 후보로 정했으며 제품 압축 경로는 아직 미구현이다. [범위·방법·비교표](collector.md#로컬-압축-비교--2026-09-11) · [원문 없는 집계 보고서](../ops/compression-local.json)

## 2026-09-11 — 에이전트 인계와 운영 문서 정리

Claude Code의 `CLAUDE.md`가 `AGENTS.md`를 가져오도록 추가했다. 상세 운영 절차는 Atlas 문서로 모으고, 존재하지 않는 pnpm 별칭·인프라 스크립트 대신 실제 명령을 기록했다. 환경변수 점검 스크립트는 파일을 읽기만 하며 이름·존재·일치 여부만 출력한다.

운영 재조회에서 Vercel Ready·Production·`icn1`과 Git 미연결, Production 변수 이름, GitHub의 `SCHEDULER_SECRET`, Supabase DB migration 001~004·서울 pooler·비공개 JSON 버킷을 확인했다. 유지관리 자연 예약 성공도 현재 상태에 반영했다. 로컬 앱 키 사본은 일치했고 Collector는 일시 중지 상태였다. 키 원문 변경·회전, 배포, 실제 세션 업로드는 수행하지 않았다.

`ops/production.json`의 예전 단일 Z.ai·초기 배포 정보를 갱신했다. CLI 작업 디렉터리 배포와 나중에 기록한 커밋을 구분했다. Claude Code의 실제 새 세션 로딩은 아직 실행하지 않았으며, [공식 import 방식](https://code.claude.com/docs/en/memory#agentsmd)과 로컬 파일 경로를 확인했다.

## 2026-09-11 — 압축 수집 실증과 화면 개편

14:20 KST부터 압축 접수·개인 표본 전송·디자인 개편·운영 검증을 진행했다. 15:26 KST 기준 약 66분이며 무료 모델 백오프 대기와 이후 최종 결과 확인은 별도다. Astra가 통합·운영 검증을 맡고 Sol 에이전트가 압축 수집·UI·문서를 나누어 구현했다.

| 항목             | 실제 결과                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 압축             | Collector 전송과 서버 저장 모두 Zstd 3. 압축 요청 1 MiB·해제 배치 8 MiB·분석 해제 합계 40 MiB 제한                                                                                                                 |
| 이미지           | 사용자 선택에 따라 본문은 로컬에 두고 위치·형식·크기·해상도·해시만 전송. 서버에서도 이미지 본문 제거와 텍스트 마스킹 후 저장                                                                                       |
| 개인 표본 업로드 | 최근 일주일 중 메인 세션 4개·3,717개 이벤트·15개 배치 접수 완료. 이미지 참조 251개·고유 해시 237개. 원본 경로·본문은 보고서에서 제외                                                                               |
| 실전송·저장      | 정상 요청 합계 2,107,290 B. 재시도 포함 17회·2,428,355 B 전송. 서버 파일 2,106,796 B, 해제 후 마스킹 JSON 9,257,325 B. DB 물리 용량과 별개                                                                         |
| 복구 수정        | 앞선 배치의 재시도 대기 중 같은 파일의 뒤 배치를 보내던 문제 수정. 다른 파일 진행은 허용하며 선행 ACK 순서 유지. 재개 후 15개 배치 모두 ACK 확인                                                                   |
| 실제 분석        | 15:21 KST 기준 4개 중 2개 완료·2개 처리 대기. OpenRouter Nex Mini와 NVIDIA Nemotron 사용. 결과 JSON 합계 380,548 B는 완료된 2개만의 값                                                                             |
| 품질 표본 검토   | 완료된 2개 결과의 제안 8개 모두 제공된 근거 ID 참조. 6개는 근거가 충분하고 2개는 간접·약한 근거. 키워드 오류 지표를 실제 실패 횟수로 과해석한 사례를 발견해 UI에 제한 표시. 계층적 증류·오탐 분류는 남은 개선 과제 |
| 화면             | 네이비·의미별 색상, 다크·라이트, 통일된 설정 폭·명령 복사·접근성 있는 선택 메뉴. 공개 Free tier 후보 6개와 인증 변경 재조회                                                                                        |
| 페이지           | `/sessions`, `/analyses`, `/settings` 분리. 새로고침·직접 접근·뒤로 가기와 기존 세션 링크 유지                                                                                                                     |
| 메뉴·출처        | Agent Observatory 한 줄, 리전·버전은 제품 이름 아래, 계정은 별도 구간. SVG 메뉴 아이콘. 분석 모델·비용은 결과 상단에 한 번만 표시                                                                                  |
| 로컬·원격 검증   | 계약 13·Collector 9·웹 17 테스트. 웹 빌드·타입 검사 통과. 압축 접수 8개·인증 소유권 경계 9개 원격 검증 통과. 합성 화면으로 복사·키보드·모바일·테마·페이지 이동·출처 중복 확인                                      |
| Collector 배포   | 0.2.0 로컬 설치·계정 연결 유지, 자동 동기화 일시 중지. GitHub Release tarball 공개. npm 게시 미완료                                                                                                                |

현재 운영 배포는 [운영 상태](../ops/production.json), 접수·저장 검증은 [표본 보고서](../ops/personal-pilot-storage.json), 화면 검증은 [UI 보고서](../ops/ui-verification.json)에 기록한다. 디자인 결정은 [DESIGN.md](DESIGN.md)에 모았다. 실제 표본의 남은 분석은 기존 Workflow가 제공자 백오프를 지켜 이어간다. 완료 전 전체 분석 성공으로 표시하지 않는다.

### 15:40 KST 추가 검증

화면 개편 시작부터 약 80분이 지났다. 운영 배포 `dpl_pnGVARhpCfLEh5r5ZKBJHzX4jjud`는 소스 `3fff3b5`·Ready·Production·`icn1`으로 확인했다. [CI 34570714079](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34570714079)는 계약 13·Collector 9·웹 21, 총 43개 테스트와 빌드를 통과했다.

- 서버 페이지네이션, URL에 남는 검색·페이지·개수, 계정 전체 집계 유지, 타임존 선택과 초 단위 timestamp를 추가했다.
- 합성 계정 27개 세션으로 페이지 크기·동일 시각 정렬·전체 검색·범위 초과·계정 격리를 운영 API에서 확인했다. 합성 Auth.js 세션으로 타임존 저장·복원·잘못된 값 거부를 확인했으며 GitHub OAuth 절차 자체는 재실행하지 않았다. [API 검증](../ops/session-browser-api-verification.json) · [합성 UI 검증](../ops/pagination-ui-verification.json)
- 상세 용량·배치 수는 DB 파일 집계, 나머지 메트릭은 현재 revision의 완료 결과에서 읽는다. 상세 조회 때 원본 Storage를 다시 다운로드하지 않는다. 미집계는 `—`다.
- 분석의 순서 대기·재시도 대기·실제 요청 중을 구분하고 요청 이력에 시각·모델·오류를 표시했다.
- 15:39 KST에는 개인 표본 3/4 분석 완료·1개 대기였고, 완료된 3개 결과 JSON은 합계 733,639 B였다. 539개 이벤트 세션은 7회 시도 후 Nex Mini로 완료되어 백오프 복구를 확인했다. 나머지 결과 확인은 기존 Workflow와 후속 검증이 이어간다.
- [평가 기준](sessions/evaluation.md)에 모델 적합성과 스킬 버전 효과, 관측·추론 구분, 규칙 검토·폐기 기준과 필요한 수집 보강을 기록했다. 이 고급 평가 기준의 구현은 아직 아니다.
- Collector는 Codex 예약 기능에 의존하지 않는 macOS LaunchAgent임을 문서에 명시했다. 현재 Codex JSONL만 지원하며 Claude Code 어댑터와 웹 기기 상태 조회는 미구현이다.

## 2026-09-11 — 행동 중심 분석과 접수·인증 개선

16:17 KST부터 진행했다. Astra가 서버 통합·검증·배포를 맡고 Terra 에이전트가 화면, Collector 어댑터, 평가 카탈로그와 합성 검증을 나눠 구현했다. 종료 시각과 배포 결과는 검증 후 아래에 기록한다.

| 항목        | 변경                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 분석 화면   | 문제·즉시 할 일·검증 기준을 먼저 표시. 근거 ID·해시는 상세창, 원시 JSON은 추가 펼치기. 에이전트 작업 지시 복사                                 |
| 디자인      | 코발트 강조, 표·제목·탐색·버튼의 위계 보강. 결정은 DESIGN.md                                             |
| 로그인 전환 | 공통 AccountProvider와 서버 초기 계정 조회. 확인 중 비로그인 버튼을 그리지 않고 페이지 이동 시 계정 유지                                       |
| 접수 시각   | 최초·마지막 배치·snapshot 완료를 구분. 새 배치는 완료를 비우고 오래된 완료 요청은 409. 목록의 타임존 이름 제거                                 |
| Collector   | 0.3.0, Codex·Claude Code, 관측 모델·구조화 도구 상태, 모든 텍스트·도구 블록, 이미지 metadata-only. launchd 로그인 즉시 실행과 paused heartbeat |
| 평가        | 하나의 TypeScript 카탈로그에서 결정적 평가·의미 기반 rubric·문서를 사용. CI 문서 드리프트 검사                                                 |
| 품질 경계   | 오류 키워드 대신 구조화된 실패. 부족한 모델·스킬·완료 근거는 보류. 규칙별 인용 anchor·출력 필수 필드 검증. 실패 진단 코드 저장                 |
| 운영        | 접수·기기 필드 마이그레이션 적용. Supabase security advisor의 warn/error 결과 없음                                                             |

원격 배포와 로컬 Collector 설치는 코드 빌드와 별도로 확인한다. 실제 개인 표본 4개 중 미완료 1개는 기존 Workflow에서 무료 제공자 백오프를 유지하며 처리 중이다. 새 평가 계약의 실세션 정확도, 계층적 증류, 개선안의 자동 적용·전후 추적은 완료로 표시하지 않는다.

0.3.0 운영 확인은 16:53 KST에 마쳤다. 이 단계는 16:17~16:53 KST, 약 36분 걸렸다. Astra가 통합·근거 경계·운영 검증을 맡고 Terra 에이전트가 UI·Collector adapter·평가 카탈로그를 나눠 구현했다. 앞선 연구·개인 표본 분석의 백오프 대기는 제외했다.

| 최종 확인 | 결과 |
| --- | --- |
| 소스·CI | `460f5ae`, [CI 34576287779](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34576287779) 성공. 계약 22·Collector 14·웹 29, 총 65개 테스트·타입 검사·빌드 통과 |
| 운영 배포 | `dpl_DKrtwL2qD8cDJvGnYjftPLd8oN7c` Ready·Production·`icn1`. 배포 이후 조회 구간에서 runtime error 없음 |
| 원격 API | 접수·source·heartbeat·인증 SSR 8그룹, 압축·마스킹·snapshot 완료 9그룹, 인증·소유권 9그룹, 페이지·메트릭·타임존 3그룹 통과 |
| 화면 | 운영 빌드에 합성 API fixture를 연결해 인증 깜빡임·근거 팝업·포커스 복원·작업 복사·다크/라이트·390px 모바일 검증. 실제 서명된 합성 계정의 SSR은 별도 검증 |
| Collector | [0.3.0 GitHub Release](https://github.com/agent-observatory/agent-session-atlas/releases/tag/collector-v0.3.0), 132,274 B. 로컬 설치·launchd `RunAtLoad`/1,800초·운영 paused heartbeat 확인. npm 미게시 |
| 개인 표본 | 이미 ACK된 4개 snapshot의 완료를 서버에 확정. 새 수집·파일 업로드·AI 호출 없이 완료 시각만 기록. 분석은 3/4 완료, 1개는 기존 무료 제공자 백오프 대기 |

[화면 검증](../ops/actionable-review-ui-verification.json) · [수집 생명주기](../ops/collector-lifecycle-verification.json) · [설치 검증](../ops/collector-install-verification.json) · [운영 상태](../ops/production.json)

## 2026-09-11 — 목록·설정 정리와 에이전트 사용 경계

페이지네이션을 빈 상태 뒤의 목록 마지막 영역에 배치하고, 가입 안내를 전용 강조색·테두리로 구분했다. 기기 타임존은 실제 IANA 이름을 함께 표시하고 Appearance는 Dark/Light/System으로 표기한다. Collector 설치·프로젝트/기간/소스 설정·보관 위치는 `/docs`로 옮겼다. `/docs/collector.md`와 `/llms.txt`를 추가하고 웹·Markdown을 동일한 TypeScript 내용에서 생성한다. 설정은 연결된 기기 관리와 가이드 링크를 제공한다.

세션 목록에 행별·선택 삭제와 확인창을 추가했다. 일부 실패는 실패한 세션의 선택을 유지한다. 삭제된 세션과 분석은 즉시 숨기고 파일은 예약 정리한다. 동일 세션의 재접수를 막는 행은 원래 상세 만료 시각까지만 유지한다. 프로젝트 제외는 새 수집에만 적용되며, 기존 Outbox와 업로드를 취소하지 않는다는 제한을 가이드에 명시했다.

에이전트 사용을 제품 아키텍처의 일부로 기록했다. 현재 CLI·문서, 제안 단계의 Skill·원격 MCP·플러그인 역할과 도입 이유를 [설계 결정](README.md#설계-결정-사람과-에이전트가-같은-제품을-사용한다)에 정리했다. 원격 MCP가 PC의 pause/configure/sync를 수행하는 것으로 표현하지 않는다. 실제 원격 검증·배포 정보는 작업 완료 시 운영 상태와 보고서에 갱신한다.

17:19 KST에 운영 확인을 완료했다. 최종 커밋·배포·원격 검증은 17:15~17:19 KST 약 4분이며, 앞선 구현·화면 조정 시간은 제외했다. Astra가 통합·웹 가이드·배포를, Terra 에이전트가 삭제 기능과 아키텍처 문서를 나눠 맡았다.

- 배포: `557bedc` → `dpl_5fPbfvSjrQTGMoJmU6gtyqvKaMnW`, Ready·Production·`icn1`. `.vercelignore`를 루트 문서에만 적용해 앱 `/docs`가 제외되는 문제를 수정했다.
- [CI 34578479987](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34578479987): 테스트 65개·타입 검사·빌드 통과.
- [운영 화면](../ops/pagination-docs-ui-verification.json): 빈 상태·20행·마지막 페이지·모바일 페이지네이션, 안내 강조, 기기 타임존, Appearance, 문서 경로·복사, 삭제 취소·부분 실패·재시도 통과. 합성 API fixture를 사용했다.
- [문서 엔드포인트](../ops/agent-docs-verification.json): 공개 한국어·영어 Markdown이 웹 공유 원본과 일치하고 `/docs`·`/llms.txt` HTTP 200 확인.
- [삭제·소유권](../ops/boundary-verification.json): 실제 운영 API에서 11개 경계 검증 통과. 개인 세션 대신 합성 세션만 사용했다.
- [보관 검증](../ops/retention-verification.json): 실제 DELETE와 조회 API, 합성 소유자에 한정한 SQL·Storage 정리 시뮬레이션 통과. 운영 유지관리 함수 전체를 재실행한 검증은 아니다.
- 아키텍처 SVG XML·실제 렌더링 확인. 기존 프로젝트 설정·개인 세션의 삭제는 실행하지 않았다.

## 2026-09-11 · 현재 Collector 조회와 Docs 정리

- 평가 원칙과 코드에서 생성한 규칙을 `sessions/evaluation.md`로 통합했다. 생성기는 주석 경계 안의 카탈로그만 갱신하며, 기존 설명 보존과 drift 검사를 확인했다.
- 연결된 기기에서 조회 요청을 보내면 Collector가 그때 로컬 설정·대상 프로젝트와 Outbox 집계를 읽는다. 자동 전송과 독립된 상주 프로세스가 10초마다 조회 요청을 확인한다. 무응답에는 `atlas-collector start`를 안내한다.
- `start`/`stop`은 두 LaunchAgent를 제어하고 pause 설정을 유지한다. 기존 기기 토큰·설정·Outbox는 보존한다. 조회 응답은 허용한 필드만 포함하며, 요청 60초·응답 열람 5분 만료와 소유권/기기 인증을 적용했다.
- 설치 안내를 전역 CLI 설치와 `atlas-collector ...`로 통일했다. Collector 0.4.0 tarball은 132,863 bytes다. npm registry 게시는 하지 않았다.
- `/docs`에 읽기 폭을 제한한 본문, 데스크톱 목차, 단계·명령·안내문 위계를 적용했다. 디자인 기준을 `DESIGN.md`에 기록했다. 삭제 대화상자에서 내부 파일 정리 설명을 제거했다.
- 로컬 검증: Collector 18개·웹 29개·공통 계약 22개 검사와 타입 검사, 웹 빌드 통과. 합성 기기로 오프라인·소유권·기기 격리·응답 재사용·만료/삭제·폐기된 토큰 등 API 11개 경계를 확인했다.
- 운영 API 11개 검사 통과. 설치한 0.4.0 Collector가 새 요청을 받아 실제 로컬 설정과 범위를 응답하는 것까지 확인했다. 이 확인은 DB에 검사 요청을 넣어 응답 프로세스를 검증했으며, 브라우저 인증은 별도의 합성 계정으로 검사했다. 원본 세션을 추가 업로드하지 않았고 `paused: true`를 유지했다. `stop`/`start`도 실제 등록 해제·재등록을 확인했다.
- 운영 화면에 합성 API 응답을 연결해 현재 설정·오프라인 안내·재조회 시 이전 결과 제거, 다크·라이트 모바일과 Docs 명령 복사를 검사했다. 사용자 로그인 쿠키나 개인 화면 캡처는 사용하지 않았다. 브라우저 예외는 없었다. 기록: `ops/device-inspection-verification.json`, `ops/device-docs-ui-verification.json`, `ops/collector-live-inspection-verification.json`.
- 첫 구현 배포 `dpl_H7pGh9bqf3MV4P3EkqPPmY7CiD6D`가 Production Ready이며 런타임은 `icn1`이다. CI 34580654612에서 전체 69개 검사·타입 검사·빌드를 통과했다. 최종 표시 보완 배포 `dpl_3HAMUThGfhip5yCh1dwAiBDSH1pr`도 Ready이며, source `88192e6`의 CI 34580933584도 성공했다. 한국어·영어 공개 Markdown과 공유 문서 원본이 일치하는 것을 확인했다.
- 소요 시간: 웹 현재 조회·CLI·Docs 작업은 2026-09-11 17:32경부터 17:49경까지 약 17분. 에이전트 병렬 작업과 원격 검증을 포함한 경과 시간이며, 앞선 평가 문서 통합은 제외했다.

## 2026-09-11 · 사용자 관점 Overview

- README와 공개 사용 가이드 첫머리에 영어 Overview를 추가했다. 코딩 세션 → Collector → Atlas → Review & apply → 다음 세션의 순환만 표현한다. 기존 인프라 아키텍처는 유지한다.
- 데스크톱과 모바일은 같은 주요 흐름을 각 화면 폭에 맞게 배치한다. SVG의 text·tspan을 유지하고, 기존 Tabler 사용자 아이콘의 라이선스를 보존했다. 생성 스크립트가 문서용·웹용 사본을 함께 만들며 CI에서 일치 여부를 검사한다.
- SVG XML 검사와 브라우저 렌더링, 웹 빌드·타입 검사를 확인했다. 공개 Markdown에도 같은 Overview 이미지를 연결했다. 운영 `/docs`에서 데스크톱·모바일, 다크·라이트 표시와 가로 넘침 없음·브라우저 예외 없음을 확인했다. [화면 검증 기록](../ops/overview-ui-verification.json)을 남겼다.
- source `f858f93`을 배포한 `dpl_BgwyVtra95qbKZRsuAbiGYAD8gff`는 Production Ready·`icn1`이다. [CI 34606401527](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34606401527)도 성공했다.

## 2026-09-11 · Collector npm 최초 게시 준비

- npm `choi8608` 로그인·이메일 인증과 `agent-observatory` 조직 Owner 권한을 확인했다. 계정 2FA는 아직 비활성이다.
- Collector 0.4.1에 npm 메타데이터·영어 설치 안내·MIT 및 번들 Zod 라이선스를 포함했다. 테스트 18개·타입 검사·빌드·게시 dry-run 통과. tarball은 135.7 kB, 파일 5개다.
- `collector-release.yml`을 GitHub Release 발행 → 태그/버전 검사 → 테스트/패키징 → tarball 첨부 → OIDC npm 게시로 변경했다. Trusted Publisher는 아직 연결 전이다.
- 실제 첫 npm 게시에서 2FA 요구로 E403을 받았다. 패키지 게시·자동 게시 검증은 완료되지 않았다. 사용자 계정의 2FA 설정 후 검증한 tarball부터 재시도한다. 로컬 Collector 설치와 전송 상태는 변경하지 않았다.
- 준비·검증·게시 시도는 22:55~22:57 KST, 약 2분이었다.

### npm 게시 완료

- 계정 2FA 활성화·브라우저 인증 후 0.4.1 최초 게시에 성공했다. npm Trusted Publisher를 CLI로 연결했으며 장기 npm 토큰은 만들지 않았다.
- Collector 0.4.2 GitHub Release에서 [자동 게시 run 34607507564](https://github.com/agent-observatory/agent-session-atlas/actions/runs/34607507564)가 29초 만에 성공했다. 테스트·타입 검사·패키징·Release 첨부·OIDC npm 게시를 모두 실제 실행했다. 배포물·provenance는 `ops/npm-release-verification.json`에 기록한다.
- README와 웹·Markdown 사용 가이드를 npm 전역 설치 명령으로 통일했다. 로컬 기존 설치본 0.4.0과 pause 상태는 유지한다.

- npm에서 패키지명·버전으로 별도 임시 prefix에 설치하고 합성 설정의 `doctor`가 0.4.2·미연결·paused·대기 배치 0을 반환하는 것을 확인했다. 기존 설치본과 개인 세션은 건드리지 않았다.
- 사용 가이드 배포 `dpl_CNHgzYWwnX7qMjiKRNYWnrBZefvs`는 Production Ready·`icn1`, source `a84c378`이다. 공개 웹 가이드와 한국어·영어 Markdown에서 npm 설치 명령과 이전 tarball 명령 제거를 확인했다. CI 34607609886도 성공했다.
- 전체 npm 연결은 22:55~23:02 KST 약 7분으로, 사용자 2FA·브라우저 인증 대기와 자동 게시·웹 배포 검증을 포함한다.

## 2026-09-12 · Overview 실행 영역과 공식 아이콘

- LOCAL에 코딩 세션·Collector, REMOTE에 Atlas 분석·결과를 그룹으로 구분했다. 결과 검토와 개선 적용은 로컬 세션으로 돌아오는 사용자 행동으로 표시한다.
- 직접 그린 기능 아이콘을 Tabler Icons v3.34.1 공식 SVG로 교체했다. 아이콘 원본·MIT 라이선스·출처를 저장소에 보존하며 외부 이미지 요청 없이 그림 안에 포함한다.
- 데스크톱·모바일 SVG 렌더링과 생성기 사본 일치, XML을 검사했다.

- 운영 배포 `dpl_gYumT4XpeDVC11CDoyRYJe9V9KKp` Ready·icn1 확인. `/docs`의 데스크톱·모바일 및 다크·라이트에서 이미지 로드·가로 넘침 없음·브라우저 예외 없음을 확인했다. 기록: `ops/overview-ui-verification.json`.

## 2026-09-12 · Agent Observatory 포털 전환

- GitHub 저장소를 `agent-observatory/agent-observatory`, 기존 Vercel 프로젝트를 `agent-observatory`로 바꿨다. 프로젝트 ID·DB·Storage·환경변수는 유지했다. 운영 주소는 `https://agent-session-atlas.vercel.app`을 유지해 OAuth callback과 설치된 Collector 연결을 보존했다. 현재 작업 디렉터리 이름도 유지했다.
- 웹 0.5.0의 상단에서 Wiki와 Sessions를 구분한다. 기본 주소는 `/wiki`, 세션 메뉴는 Sessions 영역의 사이드바에 둔다. Wiki는 빈 화면만 제공하며 지식 수집·생성·검색은 후속 설계다. `?session=`·`?connect=` 진입은 세션 화면으로 보낸다.
- 언어·테마·시간대·연결 기기는 `/settings`, 마스킹·AI Provider·모델은 `/sessions/settings`에 둔다. 공통 설정 저장에서도 세션 설정을 보존하고, 공통 AccountProvider로 화면 전환 중 인증 상태를 유지한다.
- 문서를 `docs/sessions/`와 `docs/wiki/`로 구분했다. 전체 구조·디자인·Collector·운영 및 키 관리는 공통 문서에 남기고 상대 링크와 평가 문서 생성 경로를 함께 옮겼다.
- npm Trusted Publisher를 새 저장소로 연결하고 이전 저장소의 권한을 제거했다. Collector 0.4.3의 [Release 자동 게시](https://github.com/agent-observatory/agent-observatory/actions/runs/34643650693), npm 버전·provenance 및 별도 임시 경로의 설치·doctor 실행을 확인했다. 기존 로컬 Collector 설치본과 pause 상태는 유지했다.
- 초기 UI 구현, UI 재검토·브라우저 검증, 문서 이전은 에이전트에 나눠 맡겼다. 통합 검토에서 헤더/사이드바 구분과 공통 설정 저장 누락을 수정했다.
- 최종 방향: 기존 Sessions와 Collector는 참고 구현으로 남긴다. 다음 Wiki 설계에 맞춰 수집 모델·계약·구현을 다시 정하며 하위 호환성은 제약으로 두지 않는다.
- 최종 source `40040ed`의 [CI 34644344734](https://github.com/agent-observatory/agent-observatory/actions/runs/34644344734)에서 69개 테스트·타입 검사·빌드를 통과했다. 문서 상대 링크, 평가 문서 생성 위치, Overview 사본과 렌더링을 확인했다.
- 운영 배포 `dpl_A3jRwe4oQY22rchrPP9Ksxjhwj2r`는 `agent-observatory` 프로젝트의 Production Ready·`icn1`이다. 기존 canonical URL이 이 배포를 가리키는 것을 확인했다.
- 운영 서버의 임시 합성 계정으로 여섯 경로의 직접 진입·새로고침, 메뉴 전환 중 비로그인 버튼 깜빡임 없음, 설정 저장과 마스킹 값 보존, 공통 설정의 연결 기기 표시, 세션 조회와 루트 진입을 확인했다. 검사 계정은 삭제했다. GitHub OAuth 동의 절차와 전체 기존 Sessions 분석 파이프라인은 다시 실행하지 않았다. 기록: `ops/portal-ui-verification.json`, `ops/portal-remote-verification.json`.
- 소요 시간은 이름 변경·병렬 구현·문서 이전·npm 및 웹 배포·검증까지 약 20분이다. 05:29 KST에 운영 검증을 마쳤으며, 앞선 Wiki 방향 논의는 제외한다.
