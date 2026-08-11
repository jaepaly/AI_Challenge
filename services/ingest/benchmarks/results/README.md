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
