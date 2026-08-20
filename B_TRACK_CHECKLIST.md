## B 트랙 통합 작업 체크리스트

마지막 점검: 2026-08-17
현재 브랜치: `feat/b-ingest-two-pass`

이 문서는 다음 네 종류의 작업을 하나의 실행 순서로 관리한다.

- `[기존]`: 원래 진행하던 B 트랙 작업
- `[팀장]`: 팀장 요청 및 리뷰 후속
- `[게이트]`: [Issue #32](https://github.com/jaepaly/AI_Challenge/issues/32) 요구사항
- `[감지]`: 저장소·GitHub 전수 점검에서 새로 확인한 항목
- `[타팀]`: 다른 담당자가 처리하며 B는 상태와 연동만 확인하는 항목

작업 순서는 `P0 → P1 → P2 → P3 → P4/P5 → P6`이다. 원래 진행하던 [PR #47](https://github.com/jaepaly/AI_Challenge/pull/47)을 최상위로 둔다.

## 2026-08-17 GitHub 인입 점검

- [x] [Issue #32](https://github.com/jaepaly/AI_Challenge/issues/32)의 최신 댓글 확인
  - B 게이트 성공·미달·후속 순서를 [댓글 `5308116419`](https://github.com/jaepaly/AI_Challenge/issues/32#issuecomment-5308116419)로 등록함
  - 등록 이후 팀원의 새 답글은 현재 0건
- [x] [PR #47](https://github.com/jaepaly/AI_Challenge/pull/47)의 최신 멘션·댓글 확인
  - 마지막 직접 멘션은 2026-08-16 14:23의 팀장 댓글
  - 새 댓글은 없지만, 기존 요청 3건을 다음 유료 실행 전에 처리해야 함: 최신 `main` 동기화, 약관 재체크아웃, 스팬 프롬프트·텔레메트리 반영
- [x] `[직접 요청]` [PR #50](https://github.com/jaepaly/AI_Challenge/pull/50) 초기 리뷰
  - `HUI4537`과 `dsaedsae`가 requested reviewer로 지정됨
  - [변경 요청 리뷰 `4946574832`](https://github.com/jaepaly/AI_Challenge/pull/50#pullrequestreview-4946574832) 제출
  - 422 실패 경로 텔레메트리 미연결을 블로커로 확인
  - 규칙별 스팬 결과 보존과 페이지형 근거의 0값 오해 방지를 추가 권고
- [x] [PR #46](https://github.com/jaepaly/AI_Challenge/pull/46) 병합 확인: `b91d2f0`
- [x] [PR #49](https://github.com/jaepaly/AI_Challenge/pull/49) 병합 확인: `d129f10`
- [x] [PR #47](https://github.com/jaepaly/AI_Challenge/pull/47)에 최신 `main` 2커밋 로컬 반영
  - 현재 PR #47 HEAD: `fe70283`
  - 현재 `main` HEAD: `d129f10`
  - PR #46·#49를 일반 merge한 로컬 커밋: `0092464`
  - 원격 push 완료, force push 사용 안 함
  - GitHub CI·배포 모두 성공

## P0 — 현재 작업: PR #47 성공 카드 생성

- [x] `[기존·팀장]` 심사필 번호를 `2026-0265` 형식의 맨숫자로 정규화
- [x] `[기존·팀장]` 잘못 분류된 ratio rule을 조용히 삭제하던 로직 제거
- [x] `[기존·팀장]` 평가비율 88% 오분류 시 fail-closed 유지
- [x] `[기존·팀장]` 승인 상한·표준가 추정·도입가 추정·실청구 비용 분리
- [x] `[기존]` 최신 `main`의 PR #45·#48 변경을 일반 merge로 동기화
- [x] `[기존]` 구현 커밋·푸시 완료
- [x] `[기존]` PR #47 본문에 구현·검증 내용 반영
- [x] `[기존]` GitHub CI·배포 성공
- [x] `[기존]` `.env`와 API 키 설정을 값 노출 없이 확인
- [x] `[기존]` dry-run 실행: 네트워크 요청 0회
- [x] `[기존]` 현재 실행 예상 최대 비용 확인: 601.01원
- [x] `[기존]` 유료 실행 직전 Python 전체 테스트 결과 캡처: 55 passed, 1 warning
- [x] `[기존]` API 추가 비용 최대 650원 별도 승인
- [x] `[기존·게이트]` 한투 `POST /ingest` 4차 실제 실행 1회
- [x] `[게이트]` 유효한 `ConditionCard(draft)` 1건 생성
- [x] `[게이트]` `h=0.15` 골든 일치 확인
- [x] `[게이트]` 4중 방어 통과 확인
  - [x] 근거 좌표 완비
  - [x] JSON Schema + Pydantic
  - [x] 수치 범위
  - [x] 산식 혼입 거부
- [x] `[게이트]` 모든 `evidence.quote`가 한투 원문 좌표와 일치하는지 대조
- [x] `[게이트]` `review_no=2026-0265` 확인
- [x] `[게이트]` 소요 시간 기록: 1패스 25.10초, 2패스 43.02초, 전체 68.14초
- [x] `[기존]` 입력·출력·캐시 토큰과 비용 추정치를 결과 JSON에 기록
  - 표준가 기준 추정: 416.00원
  - 도입가 기준 추정: 277.33원
  - 콘솔 실청구액: 확인 전이므로 `null`
- [x] `[기존]` 성공 결과 JSON과 보존 중인 실패 결과 파일을 분리
- [x] `[기존]` 성공 결과를 한투 정본으로 다시 검증하는 회귀 테스트 추가
- [x] `[기존]` 전체 Python·Engine·Web·lint·build 재검증
  - 최종 통합 기준 Python 97 passed, 1 warning
  - Engine 77 passed
  - Web 64 passed
  - lint 통과
  - production build 통과
- [x] `[기존]` 결과 커밋·푸시: `afb2de7`
- [x] `[기존]` PR #47 본문을 4차 성공 결과와 60초 미충족 사실로 갱신
- [x] `[기존]` Issue #32 보고용 Markdown 초안 작성
- [x] `[기존]` PR #47 재검토 요청문 작성 및 최신 수정 코멘트에 반영
- [x] 사용자 승인 후 Issue #32 보고 댓글 등록
  - [댓글 `5308116419`](https://github.com/jaepaly/AI_Challenge/issues/32#issuecomment-5308116419)

## P1 — Issue #32 게이트 본체 마무리

### 60초 카드 판단

- [x] `[게이트]` 성공한 종단 실행의 실제 시간을 기준으로 60초 충족 여부 판정: 68.14초로 미충족
- [x] `[게이트]` `1패스 근거 선표시 → 2패스 카드 후완성` 방향 합의
  - 팀장·A·B가 선표시 방향에 동의
  - 단, 1,621자 근거를 화면에 올릴 수 없으므로 좁은 근거 확보가 구현 전제
- [x] `[게이트]` `cache_control: ephemeral 5m` 적용 확인
  - 1패스 cache write 43,456토큰
  - 이번 단발 실행 cache read 0토큰
- [x] `[감지]` 4차 성공 카드의 근거 스팬 문제 정량화
  - `ratio` 1,621자, `disposal` 115자, `execution` 1,621자
  - `ratio`와 `execution`이 같은 좌표를 사용해 `duplicate_spans=1`
  - `ratio` 스팬 안에 계약 범위 후보 `100%·105%·120%·140%`가 함께 있어 값-근거 결속이 불충분
- [x] `[직접 요청]` PR #50의 스팬 길이·중복 텔레메트리 검토 및 로컬 반영
  - PR #50 원본을 로컬 merge하고 리뷰 블로커를 직접 보완
  - 통합·보완 로컬 커밋: `899f647`
  - 목표 관측치: `max_length` 세 자리, `duplicate_spans=0`
- [x] `[기존·리뷰 후속]` 1패스 프롬프트에 최소 문장·행 인용 지시 추가
  - ratio는 비율 단독 최소 문장·행, disposal은 산정 기준과 할인율을 함께 포함
  - execution은 임계비율과 납부·처분 일정을 함께 포함한 최소 연속 구간으로 요청
  - 5차 실제 실행에서 `duplicate_spans=0`은 달성했으나 일정 근거에 `140%`가 없어 422로 거부됨
- [x] `[감지·리뷰 후속]` 역할별 citation 후보 제한과 값-근거 결속 검증
  - ratio는 유지비율 행 안의 단일 퍼센트에 결속하고 여러 값이 섞인 행은 제외
  - execution은 `140%` 유지비율 행과 일정 행을 함께 담은 조항 연속 구간만 허용
  - 2패스에는 역할별 목록만 전달하고 다른 역할 evidence를 바꿔 끼우면 거부
  - `day_counting`이 같은 evidence quote에 직접 없으면 422로 거부
  - 투자사례·가정·예시 블록은 역할 후보에서 제외
  - 현재 계약을 바꾸지 않고 조항 `[5252:5444]`의 192자 연속 구간을 사용
- [x] `[게이트]` 다음 유료 실행의 예상 비용·승인 상한 계산
  - 7차 실행 프롬프트 SHA-256: `1d96758fe43b515fe05ee629e48fbd2297f94892dd21b7e4bf50ccea6577da5e`
  - 네트워크 0회 dry-run 예상 최대 비용: 601.01원
  - 권장 승인 상한: 700원
- [x] `[게이트]` B 담당자 자가 승인으로 7차 한투 종단 실행 1회 진행
  - 승인 상한 700원, dry-run 예상 최대 비용 601.01원, 자동 재시도 0회
- [x] `[게이트]` 최신 프롬프트·근거 결속 경로로 7차 한투 종단 실행 1회 재측정
  - HTTP 422 fail-closed: 2패스의 빈 `broker` 문자열을 JSON Schema가 거부
  - 1패스 16.00초, 2패스 15.74초, 전체 31.78초
  - `duplicate_spans=0`, ratio 20자, discount 114자, execution 192자
  - ratio·discount와 execution threshold의 결속값은 각각 단일 퍼센트로 특정됨
  - 표준가 usage 환산 309.55원, 도입가 환산 206.37원, 콘솔 실청구액은 미확인
  - 결과는 `hankook_two_pass_attempt7_failed.json`에 보존하고 4차 성공 정본은 복원
- [x] `[게이트]` 빈 `broker` 생성 원인을 보완하고 비용 없는 적대 테스트로 고정
  - Pydantic `min_length=1` 미러 정렬은 팀의 PR #53으로 `main` 반영 완료
  - `broker`를 2패스 출력 스키마에서 제거하고 제출 파일명 허용 목록으로 서버가 결정·주입
  - 모델이 `broker`를 생성하거나 파일명에서 발행사 하나를 결정할 수 없으면 fail-closed
  - 융자/대주 상품 행과 ratio·execution 규칙이 어긋나면 fail-closed
  - `day_counting`이 quote에 직접 없으면 Pydantic에서도 거부
  - 실패 실행은 성공 정본 대신 다음 `_attemptN_failed.json`에 자동 분리
  - 예시 구간은 시작점뿐 아니라 스팬 겹침 전체를 검사하고 뒤 조항까지 번지지 않도록 경계 보완
  - 비용 없는 검증: Python 97 passed, Engine 77, Web 64, lint·build·compileall 통과
  - 최신 프롬프트 SHA-256: `c7b6effc566eabd1fc915be5f860a958d7c1e9add470f7f261553c872e15194e`
  - dry-run 네트워크 0회, 예상 최대 비용 601.01원
- [ ] `[게이트]` 최신 경로에서 HTTP 200·`h=0.15`·4중 방어를 함께 만족하는 성공 카드 재검증
- [x] `[게이트]` 5차 종단 실행 실패를 보존하고 원인 분리
  - HTTP 422 fail-closed, 51.21초, 추가 재시도 0회
  - `threshold_ratio=1.4`와 연결된 quote에 `140%`가 없어 Pydantic이 거부
  - 기존 성공 정본은 덮어쓰지 않고 `hankook_two_pass_attempt5_failed.json`에 별도 보존
- [x] `[게이트]` 6차 종단 실행에서 역할별 선차단·비용 절감 확인
  - Claude가 1,621자·1,289자 넓은 citation을 다시 반환해 HTTP 422
  - 1패스 16.92초 뒤 차단, 2패스 호출·토큰 0
  - 표준가 usage 환산 276.23원, 도입가 환산 184.15원, 자동 재시도 0회
  - 기존 성공 정본은 덮어쓰지 않고 `hankook_two_pass_attempt6_failed.json`에 보존
- [x] `[리뷰 후속]` 넓은 native citation 내부의 최소 원문 구간을 결정론적으로 복원
  - native citation 바깥 병합이나 문장 합성 없이 정확한 부분 문자열만 허용
  - 6차의 73자 execution 후보는 투자사례였음을 리뷰로 확인해 성공 판단을 철회
  - 6차 실제 좌표를 다시 재생해 ratio 13~80자, disposal 82~115자, 조항 execution 192자 복원
  - execution 전체에는 `105%·120%·140%`가 있지만 threshold는 140% 유지비율 행에만 결속
  - 부모 native citation `[4444:6065]` 좌표를 카드 계약이 아닌 텔레메트리에 기록
  - 부분 구간 좌표·quote·SHA 및 부모 citation 포함 관계를 테스트로 고정
  - 직접 할인율과 하한가가 함께 있으면 `prev_close_pct`를 우선하고 lower_limit 오분류 거부
- [x] `[게이트]` 성공·실패·캐시 조건을 Issue #32에 명시

### 실제 카드와 계기판 결합

- [x] `[타팀]` A의 `RiskResult` 조립 함수는 PR #33으로 `main`에 반영됨
- [x] `[게이트·독립 검증]` 4차 실제 한투 카드를 동결한 엔진 픽스처로 `assembleRiskResult` 경계 확인
  - 카드의 `h=0.15`·`status=draft`가 조립 경계까지 흐르는 것을 확인
  - 유지비율 `r`은 아직 카드 `ratio_rules`가 아니라 원장 `requiredRatio`를 사용
  - 부족액 30만원, 담보비율 135%, 처분 195주, 해소 4경로 재현
  - 벤치마크 재실행 결과와 엔진 회귀 기준의 직접 import 결합을 제거
  - Engine 전체 77 passed, TypeScript·Web build 통과
- [ ] `[리뷰 후속·타팀]` 랜딩에서 `ratio_rules`를 실제 소비하도록 결선
  - `symbol_group="전체"`를 명시적 와일드카드로 처리
  - 매칭 실패 시 기본값 1.4로 조용히 폴백하지 않고 fail-closed
- [ ] `[게이트]` 성공한 한투 카드를 D 랜딩에 전달
- [ ] `[게이트·타팀]` 스냅숏 카드가 아닌 인제스트 실제 카드로 화면이 서는지 확인
- [ ] `[게이트·타팀]` 부족액·담보비율·처분 수량·4경로가 정상 표시되는지 확인
- [ ] `[게이트]` 화면 결선 결과를 재현 방법과 함께 Issue #32에 기록

## P2 — PR #47 리뷰·병합 준비

- [x] `[감지·타팀]` [PR #46](https://github.com/jaepaly/AI_Challenge/pull/46)이 `main`에 병합됐는지 확인
- [x] `[감지·타팀]` [PR #49](https://github.com/jaepaly/AI_Challenge/pull/49)이 `main`에 병합됐는지 확인
- [x] `[감지]` 현재 작업트리 약관 바이트가 HEAD와 다른 스테일 상태인지 확인
  - 한투: 작업트리 blob `47245a0d…` / HEAD blob `3fec203c…`
  - 유진: 작업트리 blob `97f4c123…` / HEAD blob `f34921e0…`
- [x] `[감지]` 한투·유진 약관 파일을 저장소 정본으로 안전하게 재체크아웃
  - 삭제·복원 전 대상 경로와 HEAD blob을 다시 확인
  - 복원 후 `git hash-object <파일>`과 `git rev-parse HEAD:<파일>` 일치 확인 완료
  - `test_terms_worktree_bytes.py`: 3 passed
- [x] `[직접 요청]` PR #50 코드·테스트 초기 리뷰 및 변경 요청 제출
- [x] `[직접 요청]` PR #50 블로커 직접 보완 및 로컬 재검증
  - 422 실패 응답에 evidence 헤더가 실제로 남는 endpoint 테스트 추가
  - 성공 결과 JSON에 규칙별 `role·좌표·length` 보존
  - 페이지형 근거를 `coordinate_mode=page`와 별도 개수로 구분
- [x] `[직접 요청]` 로컬 보완 커밋 push 후 PR #50 상태·리뷰 정리
  - 보완 커밋 `899f647`을 PR #47 브랜치에 push
  - PR #50 원본 커밋과 보완 커밋이 PR #47에 포함되면서 GitHub상 병합 완료로 정리됨
- [x] `[감지]` PR #46·#49를 포함한 최신 `main`을 PR #47에 일반 merge
  - 로컬 merge commit `0092464`
- [x] `[감지]` `evidence`·`doc_version` 필수 계약과 PR #47 생산 카드 재대조
  - 최신 main 계약을 반영한 Pydantic 전체 검증에서 성공 카드 통과
  - 빈 `doc_version` 및 evidence 누락 거부 회귀 테스트 포함
- [x] `[기존]` 동기화·PR #50 반영 후 로컬 전체 테스트 재확인
  - Python 78 passed, 1 warning
  - Engine 77 passed
  - Web 64 passed
  - lint·production build·compileall·`git diff --check` 통과
- [x] `[기존]` push 후 GitHub CI·배포 재확인
  - `fe70283` 기준 GitHub CI run 137 성공
  - 배포 run 89 성공
- [ ] `[기존]` 팀원의 최신 커밋 재검토 확인
- [x] `[기존]` PR #47 리뷰 스레드 자체 점검
  - 미해결 인라인 review thread 0건
  - 기존 상위 댓글의 코드 블로커는 모두 반영됐고 프롬프트만 팀 합의 항목으로 분리
- [x] `[감지]` 성공 결과의 기계 검산 기록 보강
  - usage 토큰을 문자열 대신 JSON 정수로 기록
  - 저장된 카드에서 결정론적으로 역산한 역할별 evidence 스팬을 성공 JSON에 반영
  - API 추가 호출 0회, 카드·원문·프롬프트 변경 없음
- [ ] `[기존]` PR #47을 Draft에서 Ready for review로 전환
- [ ] `[기존]` 최소 1인 리뷰 승인 확보
- [ ] `[기존]` 병합 가능 상태 확인
- [ ] 팀 리뷰와 사용자 확인 전 임의로 병합하지 않기

## P3 — PR #43 PDF 경로 결정 후속

[PR #43](https://github.com/jaepaly/AI_Challenge/pull/43)은 PR #47 성공 카드 이후 진행한다. 추가 API 호출 없이 팀장이 생성한 8,192토큰 결과를 흡수한다.

- [ ] `[팀장]` 팀장이 생성한 8,192토큰 결과를 B 브랜치로 가져오기
- [ ] `[팀장]` 2,048토큰 결과를 `5건 모두 상한 도달한 절단 실행`으로 보존
- [ ] `[팀장]` 8,192토큰 결과를 정본 결과로 지정
- [ ] `[팀장]` `DEFAULT_MAX_TOKENS=8192`
- [ ] `[팀장]` `thinking: disabled`
- [ ] `[팀장]` 출력 상한 도달 시 경로 결정을 거부하는 가드 추가
- [ ] `[팀장]` 결정 레코드에 model·max tokens·thinking 조건 기록
- [ ] `[팀장]` 테스트에서 위 결정 조건까지 검증
- [ ] `[팀장]` PDF 원본 경로 재현율을 13/13으로 수정
- [ ] `[팀장]` 축자 일치를 PDF 9/13, pypdf 11/13으로 기록
- [ ] `[팀장]` `pypdf` 선택 이유를 `재현율 13/13 동률이며 축자 일치가 더 높음`으로 수정
- [ ] `[기존]` Python 전체 테스트
- [ ] `[기존]` 커밋·푸시
- [ ] `[기존]` PR #43 본문 갱신
- [ ] `[기존]` 팀장 재확인 요청문 초안 작성
- [ ] 사용자 승인 후에만 GitHub 코멘트 등록
- [ ] PR #43 Ready 전환 여부 결정

## P4 — 다른 담당자와 함께 닫아야 하는 항목

- [x] `[타팀]` PR #46 병합
  - `b91d2f0`으로 `main` 반영 완료
  - 경계 계약 `evidence`·`doc_version` 필수화 완료
- [x] `[타팀]` `(a)/(b) KIS 자격증명 정책`을 의도한 `(b)`로 기록
  - Issue #32 팀장 현황 댓글에서 배포본 4개 라우트 실측과 함께 닫힘
- [ ] `[타팀]` 실제 인제스트 카드의 랜딩 결선
- [ ] `[타팀]` `/api/build` 기준 무중단 헬스체크 설계
- [ ] `[타팀]` 9월 7일 제출 전 카드 재검증 및 `verified_at` 갱신
- [x] `[타팀]` 신선도 경계 단위 테스트 존재 확인
  - 9월 8일 30일째 계산 유지, 9월 9일 31일째 STALE 차단이 이미 테스트로 고정됨
  - 별도 9월 11일 케이스 추가보다 9월 7일 실제 재검증이 남은 작업
- [x] `[전원]` 로컬·전역 Git 이메일 값 확인
  - 로컬 전역 값: `smj1027328@gmail.com`
  - 팀장 전수 표에서 B 주소로 식별됨

## P5 — 이번 점검에서 감지한 로컬 관리 항목

- [x] `[감지]` `services/ingest/benchmarks/results/hankook_two_pass.json` 처리
  - 4차 성공 결과 정본으로 커밋
  - 한투 원문 재검증 테스트로 고정
  - 실제 제출 SHA와 LF 정규화 SHA를 분리해 Windows/Linux CI 재현 기준 기록
- [ ] `[감지]` `services/ingest/benchmarks/results/raw_pdf_batch_submission.json` 처리
  - 운영용 manifest
  - 근거 결과가 아니므로 커밋하지 않기
  - PR #43 브랜치의 ignore 규칙 반영 여부 확인
- [x] `[감지]` 현재 PR #47에서는 manifest를 추적하지 않고 제외 유지
- [x] `[감지]` 미추적 파일이 정리되기 전 `git add .` 사용 금지
- [x] `[감지]` pytest 임시 캐시 디렉터리 권한 경고 정리
  - 미추적 `services/ingest/pytest-cache-files-*` 29개만 경계 검증 후 삭제
  - 전체 검증은 `-p no:cacheprovider`로 실행해 재생성 없이 97 passed
- [x] `[감지]` PR #47 최신 수정 이후 팀원의 재검토 요청
  - [정정·재검토 요청 코멘트](https://github.com/jaepaly/AI_Challenge/pull/47#issuecomment-5308915996)
  - 팀 답변과 공식 승인은 대기하되, 비용 없는 준비 작업은 계속 진행

## P6 — 지금 작업하면 안 되는 항목

- [ ] `[타팀·보류]` [Issue #38](https://github.com/jaepaly/AI_Challenge/issues/38) 개행 정규화
  - 8월 17일 게이트 종료 이후
  - 열린 PR이 0~1건일 때만
  - 다른 변경과 섞지 않고 단독 커밋
  - `data/terms/**`의 바이트 신원 규칙 유지
- [ ] `[타팀]` [Issue #31](https://github.com/jaepaly/AI_Challenge/issues/31) C 트랙 KIS 운영 보완
- [ ] `[타팀]` [Issue #12](https://github.com/jaepaly/AI_Challenge/issues/12) A/C/D 엔진·KIS 규약
- [ ] `[타팀]` [Issue #6](https://github.com/jaepaly/AI_Challenge/issues/6) C 트랙 기존 보고 정리

## 실행·등록 원칙

- API 호출 전에는 예상 비용과 승인 상한을 제시하고 별도 승인을 받는다.
- GitHub 코멘트·리뷰·Ready 전환·병합은 사용자 확인 없이 수행하지 않는다.
- 공개된 PR 브랜치 동기화는 force rebase 대신 일반 merge를 우선한다.
- 결과 보고에는 주장만 적지 않고 실행 명령·검증 결과·원문 대조 방법을 함께 남긴다.
- 운영 manifest와 비밀정보는 커밋하지 않는다.
