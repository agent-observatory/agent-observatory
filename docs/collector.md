# Atlas Collector

![30분마다 새 기록을 JSON 대기 파일로 확정하고 Next.js에 전송한다. 서버가 마스킹 설정 적용 후 Storage 저장과 Supabase DB 접수를 확정한 ACK를 확인하면 로컬 파일을 삭제하고, 실패하면 보관 후 재시도한다. 원격 분석은 하루 한 번 또는 수동으로 별도 실행한다](assets/collector-delivery.svg)

[전체 흐름](README.md) · [Atlas](atlas.md) · [Collector](collector.md)

**Codex 기록을 수집해 Atlas로 보내는 TypeScript 기반 Node.js CLI.** Collector 0.1.0과 증분 수집·JSON Outbox·ACK 재시도·macOS launchd 경로가 구현되어 있다. npm 게시와 실제 개인 자동 수집은 아직 완료하지 않았다.

## 사용자 설치: npx setup

**Node.js 지원 LTS와 npm이 설치된 macOS부터 지원한다.** Windows·Linux 스케줄러는 후속으로 둔다.  
공개 npm 패키지는 아직 게시되지 않았으므로 아래 명령은 예정 공개 설치 경로다. 현재 검증은 로컬 tarball과 설치된 `~/.agent-session-atlas/current/cli.js`로 수행했다.

```sh
npx @agent-observatory/collector@0.1.0 setup
```

`npx`는 게시 후 패키지를 받아 실행하는 진입점이다. **영구 설치와 자동 실행 등록은 `setup`에 구현되어 있으며 로컬 설치에서 확인했다.**

| 단계 | setup이 하는 일 |
|---|---|
| 설치 | 배포 버전을 앱 전용 폴더에 설치. npm 임시 캐시와 분리하고 관리자 권한 없이 사용자 영역에 설치 |
| 계정 연결 | 브라우저 로그인 후 일회용 코드로 기기 연결. CLI에는 해당 Workspace 전송·접수 조회용 토큰만 발급 |
| 수집 설정 | 기본 `all`, 제외 프로젝트·목적지를 보여주고 설정 저장. 연결·설정 완료 후 자동 전송 시작 |
| 자동 기동 | `launchd` 사용자 LaunchAgent 하나에 1,800초 간격 등록. Node·설치 CLI의 절대 경로 사용 |
| 확인 | 시험 연결과 스케줄러 상태 확인. 대기 배치 수·최근 ACK·다음 재시도 시각 표시 |

최초 연결에서는 **기존 기록 가져오기**를 제공한다. 현재 CLI는 `configure --include/--exclude/--since/--until`로 프로젝트·기간을 선택하고, `inventory`로 선택 범위의 세션 수·바이트·프로젝트 수를 집계한다. 대화형 GUI 미리보기는 아직 제공하지 않는다. 로컬 접수 이력이 없으면 서버 접수 내역을 먼저 조회해 이미 보낸 범위를 제외하고, 진행 위치를 저장해 중단 후 이어간다. 가져오기 완료 후 웹에서 **지금 분석**으로 바로 분석할 수 있으며 이후에는 30분 증분 동기화로 이어진다.

30분마다 `npx …@latest`를 실행하지 않는다. **로컬에 설치된 고정 버전**을 실행해야 네트워크 장애에도 기동할 수 있다.  
MVP는 설치된 Node를 사용하며, Node 경로가 바뀌면 `doctor`로 감지하고 `setup` 재실행으로 등록을 복구한다.

| CLI 명령 제안 | 동작 |
|---|---|
| `status` / `doctor` | 전송 상태 조회 / 인증·Node 경로·스케줄러·디스크 진단 |
| `sync` | 즉시 한 번 전송. 원격 AI 분석은 대시보드에서 별도 기동 |
| `pause` / `resume` | 로컬 자동 전송 일시 중지·재개 |
| `update` | 새 버전 설치·검사 후 실행 경로 교체. 실패하면 기존 버전 유지, Outbox·설정 보존 |
| `uninstall` | 스케줄러·프로그램 제거. 미접수 기록·설정은 기본 보존하고 명시적 삭제에서만 제거 |

`setup` 재실행은 등록을 복구하며 중복 LaunchAgent를 만들지 않는다. 기기 토큰은 macOS Keychain에 보관한다.  
npm 계정·게시 권한은 운영자만 필요하다. 사용자는 공개 패키지 설치에 npm 로그인이 필요하지 않다.

## 첫 사용

현재 설치본은 계정 연결 후 자동 전송이 일시 중지된 상태다. `inventory`로 범위와 용량을 확인하고, 필요하면 `configure --include/--exclude/--since/--until`로 범위를 정한 뒤 `sync`를 직접 실행한다. 웹에서 **전체 세션 지금 분석**을 눌러 분석을 시작할 수 있다. `resume`을 실행하면 30분 주기 자동 전송을 다시 켠다.

## 수집과 전송

**로컬 전송기는 기록의 전송만 맡고, 분석은 원격에서 실행한다.**
컴퓨터당 OS 스케줄러 하나가 수집기를 30분마다 실행한다. macOS는 `launchd`를 사용한다.
Codex 기록 저장소에서 신규·변경 기록을 찾고 작업 경로로 프로젝트를 분류한다. 프로젝트마다 스케줄러를 등록하지 않는다.

본문·도구 입출력을 확보하기 위해 세션 파일을 읽는 방식을 기본으로 한다.
내장 OTel은 에이전트별 내용·잘림 범위가 달라 후속 보완 경로로 둔다.

```yaml
# 이 서비스의 로컬 전송기 설정 제안
sources:
  codex: { enabled: true, home: "~/.codex" }
  claude_code: { enabled: false } # 후속 어댑터
  hermes: { enabled: false }

collection:
  projects:
    mode: all # all | allowlist
    include: []
    exclude: ["~/work/company/**"]

upload:
  mode: automatic # automatic | manual
  interval_minutes: 30
  workspace: personal
  format: json
  max_request_bytes: 1048576 # 직렬화한 HTTP 본문 1 MiB
  compression: none
  outbox_dir: "~/.agent-session-atlas/outbox"
  max_pending_mb: 1024
  retry_backoff_minutes: [5, 10, 20, 40, 60]

analysis:
  schedule: daily # 원격 하루 1회. 대시보드 수동 실행도 제공
  external_ai: true
```

| 선택 범위 | 규칙 |
|---|---|
| 프로젝트 | `exclude` 우선. 정규화한 경로로 비교하고 경로 미상은 자동 전송 제외 |
| 자동·수동 전송 | 기본은 설정 범위의 새 기록 자동 전송. `manual`은 선택 시점까지의 기록만 대기열에 등록 |
| 본문 | 사용자·에이전트 메시지와 기록에 남은 도구 입출력. 인증 파일·소스 전체·첨부 바이너리는 수집 제외 |
| 마스킹 | **Next.js 서버에서 기본 `enabled: true`**. Atlas의 Settings → Privacy에서 켜기·끄기. 서버가 인증된 Workspace의 설정을 읽어 새 접수에 적용하며, Collector 요청값으로 해제할 수 없음 |
| 설정 변경 | 실제 전송 직전 정책을 다시 검사. 제외된 미전송 기록은 차단하며, 이미 서버에 보낸 기록은 별도 삭제 |
| 목적지 | 대기 파일에 Workspace·계정·기기·정책 버전을 고정. 설정을 바꿔도 기존 파일의 목적지는 바뀌지 않음 |

프로젝트 경로는 전송 대상을 고르는 기준이며, 붙여넣은 내용까지 개인 데이터라고 판별하지는 않는다.
브라우저 파일 업로드도 같은 서버 수신·마스킹 경로를 사용한다.
로컬 대기 파일과 HTTPS 요청에는 원본 본문이 포함된다. 마스킹이 켜져 있으면 치환 후 Storage·DB에 저장하고, 꺼져 있으면 치환 없이 저장한다. 두 경우 모두 본문을 서버 로그·Workflow 실행 기록에 남기지 않는다.

## 30분 전송과 장애 복구


임시 파일은 OS가 청소하는 `/tmp`가 아닌 **앱 전용 영속 폴더**에 둔다.
MVP는 압축하지 않은 **일반 JSON의 `events` 배열**을 사용하고, 같은 목적지의 새 기록을 한 배치로 묶는다.

```text
~/.agent-session-atlas/
├── state.sqlite              # 읽기 위치·배치 상태·재시도 시각·접수증
└── outbox/
    ├── .staging/<id>.json     # 작성 중: 전송 금지
    └── ready/<id>.json        # 확정 파일: 재시작 후에도 전송 가능
```

각 JSON 파일은 `manifest`와 `payload`를 포함한다.
`manifest`에는 목적지·원본 파일 구간·전송 본문 SHA-256, `payload`에는 고정 `batch_id`와 `events`를 둔다.


| 순서 | 처리·완료 기준 |
|---|---|
| 1. 기동·복구 | OS 파일 잠금으로 동시 실행 방지. 이전 실행이 진행 중이면 종료. 만료된 전송 lease와 대기 파일부터 복구 |
| 2. 새 기록 읽기 | 파일별 읽기 위치 이후의 **완성된 JSONL 줄**만 읽음. 쓰는 중인 마지막 줄은 다음 실행까지 대기 |
| 3. 대기 파일 확정 | JSON 작성 → 파일 동기화 → 같은 파일시스템의 `ready`로 atomic rename → 부모 디렉터리 동기화. 로컬에서는 마스킹하지 않음 |
| 4. 읽기 위치 저장 | 파일 확정 후 SQLite 트랜잭션으로 배치 등록·읽기 위치 갱신. 서버 전송 성공 여부와 분리 |
| 5. 전송 | 재시도 시각이 지난 배치부터 처리. 실제 전송 본문을 1 MiB 이하로 제한하고 Next.js API에 JSON POST |
| 6. 서버 접수 | 인증·크기·원본 해시 확인 → Workspace 마스킹 설정 적용 → Supabase Storage 저장 → Supabase DB 배치 접수·세션 변경 COMMIT → ACK |
| 7. 로컬 정리 | ACK의 `batch_id`·`received_sha256`을 확인하고 SQLite에 접수증 저장. 그다음 대기 파일 삭제. 에이전트 원본은 유지 |

**ACK는 서버의 보관·접수가 끝났다는 뜻이다. 분석 완료를 기다리지 않는다.**
변경이 없고 재시도할 배치도 없으면 네트워크 호출 없이 종료한다. 실행당 작업량을 제한하고 나머지는 다음 기동에서 처리한다.

| 장애·경계 상황 | 처리 |
|---|---|
| 오프라인·timeout·5xx | 파일 유지. Workflow AI 요청은 총 최대 5회·최대 72시간 동안 재시도하며, 대기 간격은 300 → 1,800 → 7,200 → 21,600초에 jitter를 더한다. 네트워크 예외도 같은 정책을 적용한다. Collector 전송은 파일을 보존하고 다음 30분 기동에서 확인 |
| 429 | `Retry-After`와 자체 backoff 중 늦은 시각 적용. 서버가 막혀도 새 기록은 로컬 여유 공간까지 보관 |
| 401·403 / 잘못된 배치 | 자격증명 오류는 목적지 전송 중지, 스키마 오류·동일 ID의 다른 해시는 해당 배치 격리. 파일 보관·사용자 조치 후 재개 |
| 서버 처리 중 통신 단절 | 같은 ID로 접수 상태를 먼저 조회. 미접수면 동일 JSON 재전송. 진행 중이면 대기하고, Storage만 남았으면 서버가 이어서 접수 |
| 서버 COMMIT 후 ACK 유실 | 같은 ID·해시로 다시 접수하면 기존 접수증 반환. 서버에 이벤트·분석 대상을 중복 등록하지 않음 |
| 파일 확정 후 SQLite 기록 전 종료 | 시작 시 `ready` JSON의 manifest를 대조해 미등록 배치·읽기 위치 복구. 확정 파일은 수정하지 않고 같은 ID로 전송 |
| 미완성 파일·파일 유실 | `.staging`은 미전송 상태로 재생성. 등록된 대기 파일이 사라졌으면 읽기 위치를 되돌려 원본 재수집, 원본도 없으면 누락 표시 |
| 원본 교체·잘림 | 파일 식별자·내용 변경을 감지해 새 generation 부여. 기존 cursor를 새 파일에 적용하지 않음 |
| 절전·재부팅 / 디스크 가득 참 | 복귀 후 읽기 위치에서 재개. 대기 용량 상한이면 새 수집을 멈추고 알림. 미접수 파일은 나이·실패 횟수만으로 삭제하지 않음 |

서버는 원본 해시(`received_sha256`)와 설정 적용 후 저장 해시(`stored_sha256`)·마스킹 적용 여부·정책 버전을 구분해 보존한다. 접수된 배치의 재시도에는 기존 접수증을 반환하며 설정 변경으로 재저장하지 않는다.
마스킹이 켜진 상태에서 처리에 실패하면 ACK 없이 실패 처리하며 원문 저장으로 우회하지 않는다. 설정 조회 실패·누락도 해제된 것으로 해석하지 않는다.

`batch_id`는 처음 만들 때 고정하고 재시도에서도 유지한다. 현재 서버의 배치 유일 키는 `(owner, batch_id)`이며, 기기·workspace 확장은 설계 범위다.
이벤트에도 출처 ID 또는 `(device, file_generation, byte_offset)`을 부여해 재수집·배치 재구성 시 중복을 제거한다.

읽기 위치는 **로컬에 안전하게 복사한 지점**, 접수증은 **서버에 안전하게 접수된 지점**이다.
전송 상태는 `pending → sending → acknowledged`, 실패하면 `pending`, 조치가 필요하면 `blocked`로 관리한다.

[Atlas 분석](atlas.md#원격-분석-자동과-수동) · [공통 계약](README.md#공통-계약과-책임) · [참고 자료](README.md#참고-자료)
