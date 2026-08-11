"""마진가드 약관 인제스트 서비스 (B 오너십).

파이프라인 계약 (Phase 1에서 구현):
  PDF 업로드 → 텍스트 확보 → Claude(claude-opus-5) 구조화 추출
  → 4중 방어 → ConditionCard(status=draft) 반환

텍스트 확보 경로는 Phase 1 스파이크에서 결정한다 — pypdf 추출 vs PDF를 그대로
document 블록으로 전달(base64). 약관의 비율·할인율은 대부분 표 안에 있고
pypdf는 표에서 깨지므로, 두 경로의 표 재현율을 비교한 뒤 고른다.

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
from fastapi import FastAPI, HTTPException, UploadFile

from .schemas import ConditionCard  # noqa: F401 — Phase 1에서 응답 모델로 사용

app = FastAPI(title="marginguard-ingest", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "ingest"}


@app.post("/ingest")
async def ingest(file: UploadFile) -> dict:
    """약관 PDF → ConditionCard(draft). Phase 1, B가 구현.

    구현 순서 권장:
      1일차: pypdf로 한투 약관 텍스트 추출 스파이크 (표 깨짐 여부를 기록으로 남길 것)
      2~5일차: Claude 구조화 추출 + 4중 방어
      5~6일차: 출력 vs data/golden/golden_cases.json 대조 (수작업 표 = AI의 채점 기준)

    파이프라인 불변 규약:
      JSON Schema 통과만으로는 수치 quote·좌표 순서·카드 내 해시 단일성을 보장할 수 없다.
      응답을 반환하거나 저장하기 전에 반드시 ConditionCard.model_validate를 거친다.
    """
    raise HTTPException(status_code=501, detail="Phase 1 구현 대상 — README의 B 매뉴얼 참조")
