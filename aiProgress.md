# AI 작업 진행 기록

## 2026-09-29

- **11:08:33 (Asia/Seoul)** — 앞으로 수행하는 모든 작업을 날짜, 시간, 작업 내용과 함께 `aiProgress.md`에 기록하도록 작업 기록 규칙을 적용함.
- **11:12:31 (Asia/Seoul)** — 전체 API 점검을 시작하고 라우트, 컨트롤러, 미들웨어, 모델, 테스트 파일 목록을 수집함. 다음 단계에서 `API_PROC.md`에 API별 점검 결과와 RDK 입력정보를 정리할 예정.
- **11:13:04 (Asia/Seoul)** — 각 컨트롤러·라우터·모델·공통 미들웨어를 정독함. 인증, 소유권 검사, RDK 폴링, 파일 업로드, 인덱스 및 잠재적인 멱등성·보안·데이터 정합성 이슈를 점검 목록에 반영할 준비를 완료함.
- **11:15:47 (Asia/Seoul)** — `npm test` 7개 통과 및 `src` 전체 Node 문법 검사 통과. 실행 중인 백엔드를 기동해 health, JWT 보호, 로그인, 사용자, 식물, 통합 기록, 식물 상세, 로그, 이벤트, 급수 이력, 활동, 알림, 입력 검증 API를 비파괴 방식으로 점검함. 대부분 통과했으나 실시간 센서 프록시는 RDK 연결 timeout으로 `503`을 확인함.
- **11:19:00 (Asia/Seoul)** — `API_PROC.md`를 생성함. 전체 웹/RDK/Flask 연동 API, 요청·응답 계약, 인증·인가, 멱등성·검증·예외·인덱스 점검, RDK/백엔드/ESP32-CAM 주소와 운영자가 입력할 값, 테스트 결과, 우선순위별 보완 목록을 정리함. 추가 검증에서 `page=0`이 400이 아닌 200으로 기본값 처리되는 페이지네이션 결함과 `with-records`의 `streamingUrl` 누락을 확인함.
- **11:19:39 (Asia/Seoul)** — 비파괴 점검을 위해 임시 기동한 백엔드 프로세스를 종료함. 테스트 중 생성·수정·비밀번호 변경·신규 이벤트·추가 알림·추가 급수 명령은 실행하지 않았으며, 기존 데이터는 점검 목적으로 변경하지 않음.
- **11:36:46 (Asia/Seoul)** — 급수 관련 작업을 별도 브랜치로 분리하기 전 현재 브랜치와 미커밋 변경을 확인함. `main`은 `5ad4ba6` 기준이며, 미커밋 변경은 문서·진행 기록·식물 삭제 라우트/컨트롤러 보강임. 기존 main의 급수 계약을 삭제하지 않고 새 브랜치에서 보존·관리하는 방식으로 진행하기로 함.
- **11:37:13 (Asia/Seoul)** — `feature/watering-flow` 브랜치를 생성하고 현재 작업을 커밋함. 커밋 `23a1a84` (`chore: isolate watering workflow on feature branch`). `main`은 `5ad4ba6`에 그대로 보존되고, 현재 작업 위치는 새 브랜치임.
- **11:37:37 (Asia/Seoul)** — `feature/watering-flow`에서 `npm test` 7개 통과, `git diff --check` 통과, 작업 트리 clean을 확인함. 원격 push는 별도 요청이 없어 실행하지 않음.
- **11:38:34 (Asia/Seoul)** — `main` 브랜치로 전환함. `feature/watering-flow`는 그대로 보존하고, 이후 작업은 `main` 기준으로 진행함. `main`에는 아직 API 점검 문서가 없어 진행 기록을 복원함.

- 2026-09-29 11:44:16 +09:00 — main 브랜치 백엔드 안정성 개선 작업 시작: 사용자 프로필 PATCH, 센서 응답 계약, 스트림 URL, 식물 cascade 삭제, 성장 정보, 이미지/페이지네이션/알림 검증, RDK 인증 및 운영 엔드포인트를 점검·구현한다.
- 2026-09-29 11:51:30 +09:00 — 1차 구현 완료: `PATCH /api/web/users/me`, User.name, 센서 고정 응답·timeout·범위 검증, 식물별 streamingUrl·성장 계산값, 식물/이벤트 cascade 삭제, 영속 업로드 디렉터리·이미지 정리, 엄격한 페이지네이션, 알림 enum, 급수 Idempotency-Key, RDK API 키, CORS 다중 origin, rate limit, request ID·구조화 로그, MongoDB readiness를 반영함. `API_PROC.md`와 `docs/API_REFERENCE.md`를 최신화함.
- 2026-09-29 11:51:30 +09:00 — 검증 완료: `npm test` 11개 통과, `node --check` 전체 대상 통과, `git diff --check` 통과. 실장비 RDK 연결 여부는 별도 네트워크 점검이 필요함.
- 2026-09-29 11:52:46 +09:00 — RDK 샘플 게이트웨이에 운영 API 키 헤더와 `lux→rux` 호환을 추가하고 `python -m py_compile rdk/rdk_gateway.py` 및 `npm test` 11개를 재실행해 통과함.
