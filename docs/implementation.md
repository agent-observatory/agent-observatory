# 실제 작업 기록

설계와 구분해 실제 수행 결과만 기록한다. 마지막 갱신: 2026-09-11. 종료 시각은 아직 기록하지 않았다.

기준 시각은 대화 시작을 추정한 값이 아니다. 초기 scaffold 파일 `pnpm-workspace.yaml`의 birthtime인 **2026-09-11 06:32:14 +0900**을 로컬 구현 기준 시각으로 삼았다. 종료 시각과 총 경과 시간은 main의 최종 검증 뒤 기록한다.

| 항목 | 상태 | 확인한 내용 |
|---|---|---|
| 공통 계약·웹·Collector 코드 | 구현·로컬 검증 | pnpm workspace, 웹·Collector 독립 0.1.0, 공통 계약 패키지. rule isolation·`appliedRules` 버전 기록 포함. 계약 6건·Collector 6건·웹 SSRF 1건, 총 13건 통과 |
| 전체 빌드 | 로컬 검증 | `pnpm build` 통과 |
| 웹·인증 | 원격 검증 | 한국어 대시보드 배포. Edge에서 GitHub OAuth로 Hyune-c 회원가입·로그인·개인 공간 진입 성공 |
| 접수·중복 처리 | 원격 합성 검증 | `ops/remote-smoke.json` PASSED: guest upload → duplicate ACK → 한국어 AI 결과·지표·마스킹 확인, selected/all 분석 접수 확인 |
| AI 분석 | 원격 합성 검증 | 로그인한 합성 Collector 세션이 Z.ai 첫 시도에서 완료. `ops/remote-smoke.json`에 한국어 AI 결과·지표·마스킹 확인. 장기 품질·개인 기록은 검증하지 않음 |
| 로컬 Collector | 설치·로컬 검증 | `~/.agent-session-atlas/current/cli.js`, LaunchAgent 하나·1,800초 간격, 일회용 코드 연결·macOS Keychain 키 저장 확인. 부분 줄·ACK 유실·Outbox 복구·잘못된 source 건너뛰기 테스트 등 5건 통과 |
| 합성 Collector 전송 | 원격 검증 | 합성 fixture 2개 배치 업로드 후 두 번째 확인 시점에 개인 데이터 0건 확인 |
| 개인 자동 수집 | 중지 | 개인 기록 자동 전송은 일시 중지했고 업로드된 개인 레코드는 없음. 합성 Collector fixture 2개 배치 전송과 후속 개인 데이터 0건 확인 완료 |
| 로컬 inventory | 관찰 | 74개 프로젝트, 1,083개 세션, 약 1.19 GB. 경로와 본문은 저장소에 기록하지 않음 |
| 제품 운영 배포 | 원격 READY 확인 | https://agent-session-atlas.vercel.app · Next.js 16.3.4 · Node 22 · 함수 `icn1` · 확인 배포 `dpl_FVktq8tf5igf41phgRNh6v7cV3fS` |
| npm | 미게시 | `npm whoami`가 `ENEEDAUTH`. 검증용 `/tmp/agent-observatory-collector-0.1.0.tgz` 생성 완료 |
| 예약 작업 | 작성·설정 | 시간당 유지관리·일일 분석 YAML과 `SCHEDULER_SECRET` 설정 완료. GitHub push와 실제 schedule/dispatch 실행은 미검증 |

이 표는 구현, 로컬 검증, 원격 검증, 배포 확인을 별도 상태로 유지한다. 실제 세션 본문과 자격증명은 기록하지 않는다.
