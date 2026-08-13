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

## 2026-08-11 실측 결과

`claude-sonnet-5` Message Batches API로 PDF 5건을 실행했다. 배치 제출 상태를
담은 `raw_pdf_batch_submission.json`은 재수집에만 필요한 운영 파일이므로 커밋하지
않고, 완료 결과인 `raw_pdf_document.json`만 재현 근거로 보존한다.

| 항목 | 결과 |
|---|---:|
| 승인 비용 상한 | 1,500원 |
| 실제 비용 | 880.2112원 |
| 공백 정규화 재현 | 8/13 |
| 축자 재현 | 6/13 |
| 입력 토큰 | 340,005 |
| 출력 토큰 | 10,240 |

같은 정본을 사용한 `pypdf_text` 경로는 공백 정규화 13/13, 축자 11/13이다.
따라서 이 예산·모델·문서당 출력 상한 조건에서는
`pypdf_text + char_location + flattened_sha256`를 PDF 기본 경로로 선택한다.
각 문서가 출력 상한 2,048 토큰을 모두 사용했으므로, 이 결과를 PDF document 입력
형태 자체의 절대적 한계로 일반화하지 않는다.
