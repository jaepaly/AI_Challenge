## PDF 원본 document 비교 결과

`raw_pdf_document.json`은 아래 명령의 실제 API 실행이 5개 PDF 모두 성공했을 때만
생성한다. 기본 실행은 네트워크 요청이 없는 dry-run이다.

```powershell
cd services/ingest
python -m benchmarks.raw_pdf_comparison
python -m benchmarks.raw_pdf_comparison --execute --approve-max-krw <승인한도>
```

- API 키는 저장소 루트 `.env`의 `ANTHROPIC_API_KEY`에서만 읽는다.
- 실행 전에 dry-run의 `estimated_max_cost_krw`와 콘솔 잔액·자동 충전 해제를 확인한다.
- 문서당 요청은 1회이며 자동 재시도하지 않는다.
- 결과의 `usage`와 citations를 PR 및 #7의 비교 근거로 사용한다.

## 5개 PDF Batch 비교

서로 다른 PDF 5건은 prompt cache를 공유하지 못하므로, 전체 비교는 캐시 대신
Message Batches API의 50% 할인을 사용한다. 기본 실행은 네트워크 요청이 없는
dry-run이며, 제출과 결과 수집을 분리한다.

```powershell
cd services/ingest
python -m benchmarks.raw_pdf_batch_comparison
python -m benchmarks.raw_pdf_batch_comparison submit --approve-max-krw 1500
python -m benchmarks.raw_pdf_batch_comparison collect
```

- 제출 manifest는 `raw_pdf_batch_submission.json`에 저장한다.
- 배치가 끝나기 전 `collect`는 `pending`만 출력하고 결과 파일을 만들지 않는다.
- 5건이 모두 성공하고 `page_location` citations가 있을 때만
  `raw_pdf_document.json`을 완성한다.

## 실제 실행 2건과 절단 판정

`raw_pdf_document.json`은 2026-08-11 Message Batches 실행을 보존한다. 다섯 문서가
모두 `output_tokens=2048`로 상한에 닿았으므로 경로 재현율이 아니라 **절단 실행
사료**다. 당시 native `stop_reason`을 저장하지 않았기 때문에 각 문서의
`stop_reason=max_tokens`는 출력 토큰이 상한과 같다는 사실에서 추론했으며,
`stop_reason_source`에 그 출처를 함께 기록했다. 이후 실행기는 native
`stop_reason`과 `output_limit_reached`를 직접 저장한다.

| 실행 | 운송 | 상한 | 포화 | 공백 정규화 | 축자 | 비용 |
|---|---|---:|---:|---:|---:|---:|
| B 2026-08-11 | Message Batches | 2,048 | **5/5** | 8/13 | 6/13 | 880.2112원 |
| D 2026-08-13 | 동기 Messages | 8,192 | **0/5** | 13/13 | 9/13 | 승인 상한 3,000원 |

8,192 비절단 실행의 전체 결과는 고정 커밋
[`2048910`](https://github.com/jaepaly/AI_Challenge/blob/20489104b87d045673b666bdd26cc0c80dd3d90d/services/ingest/benchmarks/results/raw_pdf_document.json)에 있고,
현재 브랜치에는 결정 조건과 문서별 출력 토큰을
`raw_pdf_document_8192_summary.json`으로 보존한다. 최대 출력은 신한 6,059토큰으로
다섯 문서 모두 8,192보다 작다.

## §5-B-2 경로 결정

같은 정본을 사용한 결과는 다음과 같다.

| 경로 | 공백 정규화 | 축자 | 좌표 |
|---|---:|---:|---|
| `pypdf_text` | 13/13 | **11/13** | `char_location + flattened_sha256` |
| PDF document 8,192 | 13/13 | 9/13 | native `page_location` |

PDF document 경로를 “재현율이 낮다”고 판단하지 않는다. 비절단 실행에서는 두 경로가
13/13으로 같다. 기본 경로는 다음 근거로
`pypdf_text + char_location + flattened_sha256`를 선택한다.

- 재현율 동률에서 축자 일치가 11/13 대 9/13으로 높다.
- 원본 PDF API 입력은 #28 실측에서 pypdf 텍스트 입력보다 2.13배 비싸며,
  pypdf 평탄화는 로컬에서 결정론적으로 수행된다.
- 문자 좌표와 평탄화 SHA-256이 현행 `EvidenceSpan` 검증 계약과 직접 맞는다.

모델·출력 상한·thinking·transport가 달라지면 동일한 결정으로 일반화하지 않는다.

## 한투 2패스 종단 결과

`hankook_two_pass.json`은 2026-08-16 실제 `POST /ingest` 성공 결과다.

- 승인 상한: 650원
- 예상 최대 비용: 601.01원
- 표준가 기준 사용량 추정: 416.00원
- 도입가 기준 사용량 추정: 277.33원
- 콘솔 실청구액: 확인 전이므로 `null`
- 카드: `ConditionCard(draft)`
- 4중 방어: 4/4 통과
- 골든: `h=0.15` 일치
- 전체 시간: 68.14초로 60초 마일스톤 미충족

실제 API에 제출한 Windows 작업트리 바이트의 `document_sha256`은 `10e3f5ce…`다.
GitHub Linux 체크아웃은 같은 HTML을 LF로 보관해 원시 SHA가 `02209799…`로
달라진다. 결과에는 둘을 혼동하지 않도록 다음을 함께 기록한다.

- `document_sha256_scope: submitted_bytes` — 실제 제출 바이트 감사 기록
- `document_lf_sha256: 02209799…` — CRLF/LF 차이를 제거한 교차 플랫폼 비교값

원문 파일이나 실제 제출 SHA를 사후 변경하지 않는다. 카드 재현성은 플랫폼에
독립적인 `flattened_sha256`과 evidence 좌표·quote 대조로 다시 확인한다.

`test_hankook_two_pass.py`가 결과의 문서·프롬프트 해시와 카드를 한투 정본으로
다시 검증한다. `hankook_two_pass_attempt*_failed.json`은 성공 전 실패 원인을
보존하는 별도 기록이다.

토큰 사용량은 재검산할 때 별도 형변환이 필요 없도록 JSON 정수로 기록한다.
`evidence_spans`는 저장된 카드에서 결정론적으로 다시 계산한 역할별 좌표·길이와
중복 개수이며, 원 API 응답이나 카드 값을 사후 변경한 것이 아니다.
