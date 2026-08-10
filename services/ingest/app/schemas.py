"""ConditionCard v2 — Pydantic 미러.

정본은 schemas/condition_card.schema.json (LLM 출력의 최종 검증기).
이 파일과 packages/engine/src/types.ts를 JSON Schema와 동기화하는 책임은 B에게 있다.
변경은 PR + 팀 전원 승인.
"""
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PageEvidenceSpan(BaseModel):
    """PDF 원본 citations의 1-indexed 페이지 좌표."""

    model_config = ConfigDict(extra="forbid")

    source_format: Literal["pdf"]
    page: int = Field(ge=1)
    end_page: Optional[int] = Field(default=None, ge=1)
    quote: str = Field(min_length=1)


class CharacterEvidenceSpan(BaseModel):
    """평탄화된 text/html citations의 문자 오프셋 좌표."""

    model_config = ConfigDict(extra="forbid")

    source_format: Literal["text", "html"]
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    quote: str = Field(min_length=1)


EvidenceSpan = Annotated[
    Union[PageEvidenceSpan, CharacterEvidenceSpan],
    Field(discriminator="source_format"),
]


class RatioRule(BaseModel):
    product_type: str
    collateral_type: str
    symbol_group: str
    # 실측 편차 105~170% — 범위 밖이면 추출 오류로 간주
    ratio: float = Field(ge=1.0, le=2.0)
    evidence: EvidenceSpan


class DisposalPriceRule(BaseModel):
    trigger: str
    symbol_group: str
    discount_basis: Literal["prev_close_pct", "lower_limit"]
    discount_rate: Optional[float] = Field(default=None, ge=0.0, le=0.35)
    source_confidence: Literal["explicit", "inferred_from_formula"]
    evidence: EvidenceSpan


class ExecutionScheduleRule(BaseModel):
    threshold_ratio: float = Field(ge=1.0, le=2.0)
    day_counting: str
    evidence: EvidenceSpan


class DocVersion(BaseModel):
    review_no: Optional[str] = None  # 심사필 번호 (우선)
    content_sha256: Optional[str] = None  # 번호 없는 회사(미래에셋·유진)의 폴백
    revised_at: Optional[str] = None


class ConditionCard(BaseModel):
    broker: str
    ratio_rules: list[RatioRule] = Field(min_length=1)
    account_aggregation: Literal["max", "weighted_average"]
    disposal_price_rules: list[DisposalPriceRule] = Field(min_length=1)
    execution_schedule: list[ExecutionScheduleRule] = Field(min_length=1)
    ratio_source: Literal["clause", "website_notice", "hts_only"]
    doc_version: DocVersion
    contract_vintage: Optional[str] = None
    # 인제스트 직후는 반드시 draft. verified 승격은 사람 검수를 거친 뒤에만.
    status: Literal["verified", "draft"] = "draft"
    verified_at: Optional[str] = None  # 신선도 게이트(30일) 기준일 = 검증일

    @model_validator(mode="after")
    def require_one_coordinate_kind(self):
        evidence_spans = [
            *(rule.evidence for rule in self.ratio_rules),
            *(rule.evidence for rule in self.disposal_price_rules),
            *(rule.evidence for rule in self.execution_schedule),
        ]
        coordinate_kinds = {
            "page" if isinstance(evidence, PageEvidenceSpan) else "character"
            for evidence in evidence_spans
        }
        if len(coordinate_kinds) != 1:
            raise ValueError("한 ConditionCard 안에서는 근거 좌표 형식을 하나로 통일해야 합니다")
        return self
