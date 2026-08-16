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
