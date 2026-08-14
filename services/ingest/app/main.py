"""마진가드 약관 인제스트 서비스 (B 오너십).

파이프라인 계약:
  HTML/PDF 업로드 → 결정론적 평탄화 → Claude Sonnet 5 native citations
  → citation 목록만 구조화하는 2패스 → 4중 방어
  → ConditionCard(status=draft) 반환

4중 방어 — 어느 하나라도 실패하면 카드 전체 거부:
  1) 근거 좌표: 모든 수치에 EvidenceSpan(문자 스팬+인용) 필수 — citations로 확보한다.
     ※ 입력 형태가 좌표 형태를 정한다: 추출 텍스트를 plain-text document로 넣으면
       char_location(start/end 문자 인덱스, 현 스키마와 일치), PDF 원본을 넣으면
       page_location(페이지 번호, 스키마 PR 필요). README 5-B-2 참조
     ※ citations는 structured outputs와 병용 불가(400) → 2패스로 확정:
       ①citations로 인용·좌표 확보 → ②구조화
  2) 스키마 검증: schemas/condition_card.schema.json (jsonschema) + Pydantic
  3) 수치 범위: r 1.0~2.0, h 0~0.35 — 범위 밖 = 추출 오류
  4) 오염 방어: PDF 본문에 지시문(프롬프트 인젝션)이 있어도 데이터로만 취급.
     LLM 출력에 산식·계산 결과가 섞이면 거부 — LLM은 읽고 인용만 하고, 계산은
     packages/engine(결정론)만 한다.

실행: uvicorn app.main:app --reload --port 8000
"""
import os
from pathlib import Path
from typing import Annotated

import anthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from .two_pass import DEFAULT_MODEL, IngestPipelineError, TwoPassIngestService

app = FastAPI(title="marginguard-ingest", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "ingest"}


def get_ingest_service(request: Request) -> TwoPassIngestService:
    """프로세스마다 Anthropic HTTP 클라이언트를 하나만 재사용한다."""

    service = getattr(request.app.state, "ingest_service", None)
    if service is not None:
        return service

    repo_root = Path(__file__).resolve().parents[3]
    load_dotenv(repo_root / ".env", override=False)
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Anthropic API 키가 설정되지 않았습니다")
    service = TwoPassIngestService(
        anthropic.AsyncAnthropic(api_key=api_key, max_retries=0),
        model=os.getenv("ANTHROPIC_INGEST_MODEL", "").strip() or DEFAULT_MODEL,
    )
    request.app.state.ingest_service = service
    return service


@app.post("/ingest")
async def ingest(
    file: UploadFile,
    service: Annotated[TwoPassIngestService, Depends(get_ingest_service)],
) -> JSONResponse:
    """약관 HTML/PDF → 검증된 ConditionCard(draft). 불완전하면 전체 거부한다.

    구현 순서 권장:
      1일차: pypdf로 한투 약관 텍스트 추출 스파이크 (표 깨짐 여부를 기록으로 남길 것)
      2~5일차: Claude 구조화 추출 + 4중 방어
      5~6일차: 출력 vs data/golden/golden_cases.json 대조 (수작업 표 = AI의 채점 기준)

    파이프라인 불변 규약:
      JSON Schema 통과만으로는 수치 quote·좌표 순서·카드 내 해시 단일성을 보장할 수 없다.
      응답을 반환하거나 저장하기 전에 반드시 ConditionCard.model_validate를 거친다.
    """
    try:
        result = await service.ingest(
            filename=file.filename or "upload",
            data=await file.read(),
        )
    except IngestPipelineError as error:
        headers: dict[str, str] = {}
        if error.timing is not None:
            headers.update(
                {
                    "X-Ingest-Parse-Ms": f"{error.timing.parse_ms:.1f}",
                    "X-Ingest-Pass1-Ms": f"{error.timing.pass1_ms:.1f}",
                    "X-Ingest-Pass2-Ms": f"{error.timing.pass2_ms:.1f}",
                    "X-Ingest-Total-Ms": f"{error.timing.total_ms:.1f}",
                }
            )
        if error.usage is not None:
            headers.update(
                {
                    "X-Ingest-Pass1-Input-Tokens": str(
                        error.usage.pass1_input_tokens
                    ),
                    "X-Ingest-Pass1-Output-Tokens": str(
                        error.usage.pass1_output_tokens
                    ),
                    "X-Ingest-Pass1-Cache-Write-Tokens": str(
                        error.usage.pass1_cache_creation_input_tokens
                    ),
                    "X-Ingest-Pass1-Cache-Read-Tokens": str(
                        error.usage.pass1_cache_read_input_tokens
                    ),
                    "X-Ingest-Pass2-Input-Tokens": str(
                        error.usage.pass2_input_tokens
                    ),
                    "X-Ingest-Pass2-Output-Tokens": str(
                        error.usage.pass2_output_tokens
                    ),
                }
            )
        raise HTTPException(status_code=422, detail=str(error), headers=headers) from error
    except anthropic.APIError as error:
        raise HTTPException(status_code=502, detail="Anthropic 인제스트 호출에 실패했습니다") from error

    timing = result.timing
    usage = result.usage
    return JSONResponse(
        content=result.card.model_dump(mode="json", exclude_none=True),
        headers={
            "X-Ingest-Model": service.model,
            "X-Ingest-Parse-Ms": f"{timing.parse_ms:.1f}",
            "X-Ingest-Pass1-Ms": f"{timing.pass1_ms:.1f}",
            "X-Ingest-Pass2-Ms": f"{timing.pass2_ms:.1f}",
            "X-Ingest-Total-Ms": f"{timing.total_ms:.1f}",
            "X-Ingest-Pass1-Input-Tokens": str(usage.pass1_input_tokens),
            "X-Ingest-Pass1-Output-Tokens": str(usage.pass1_output_tokens),
            "X-Ingest-Pass1-Cache-Write-Tokens": str(
                usage.pass1_cache_creation_input_tokens
            ),
            "X-Ingest-Pass1-Cache-Read-Tokens": str(
                usage.pass1_cache_read_input_tokens
            ),
            "X-Ingest-Pass2-Input-Tokens": str(usage.pass2_input_tokens),
            "X-Ingest-Pass2-Output-Tokens": str(usage.pass2_output_tokens),
        },
    )
