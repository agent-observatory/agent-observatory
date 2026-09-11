@AGENTS.md

# Claude Code에서 이어서 작업하기

이전 대화를 전제로 하지 않는다. 시작할 때 다음 문서를 읽는다.

1. `docs/README.md` — 현재 상태·최우선 과제·코드 위치.
2. `docs/operations.md`의 **키 관리와 로컬 환경**, **배포와 운영 명령** — 키 위치·운영 리소스·검증 절차.
3. `docs/sessions/README.md`와 `docs/sessions/evaluation.md` — Sessions 설계와 평가 기준.
4. `docs/collector.md` — 수집 계약·중단 경계·압축 실측.
5. `docs/implementation.md` — 실제 작업·검증 기록. 오래된 기록을 현재 상태로 해석하지 않는다.

키 점검은 `node scripts/check-environment.mjs`로 시작한다. 값은 출력하지 않는다. 인프라 식별자는 `ops/production.json`, 변수 이름은 `.env.example`을 따른다.

현재 기능을 바꾸기 전에 관련 코드와 `git status --short`를 확인한다. 이 저장소의 운영 명령은 저장소 루트에서 실행한다. 문서·코드·로컬 검증·운영 배포를 구분해 보고한다.
