"""ConditionCard v2 — Pydantic 미러.

정본은 schemas/condition_card.schema.json (LLM 출력의 최종 검증기).
이 파일과 packages/engine/src/types.ts를 JSON Schema와 동기화하는 책임은 B에게 있다.
변경은 PR + 팀 전원 승인.
"""
import re
import unicodedata
from decimal import Decimal
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
    flattened_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    quote: str = Field(min_length=1)


EvidenceSpan = Annotated[
    Union[PageEvidenceSpan, CharacterEvidenceSpan],
    Field(discriminator="source_format"),
]

_DISPOSAL_CONTEXT_TERMS = ("처분", "반대매매", "기준가", "하락", "할인")


def _format_decimal(value: Decimal) -> str:
    formatted = format(value.normalize(), "f")
    return formatted.rstrip("0").rstrip(".") if "." in formatted else formatted


def _normalized_quote(quote: str) -> str:
    """전각 문자를 반각으로 바꾸고 숫자 안의 천 단위 쉼표를 제거한다."""

    normalized = unicodedata.normalize("NFKC", quote)
    normalized = re.sub(r"(?<=\d),(?=\d)", "", normalized)

    def trim_decimal_zeros(match: re.Match[str]) -> str:
        return match.group(0).rstrip("0").rstrip(".")

    return re.sub(r"(?<![\d.])\d+\.\d+(?![\d.])", trim_decimal_zeros, normalized)


def _contains_percent(quote: str, candidate: str) -> bool:
    """다른 숫자의 일부가 아닌 퍼센트 표기만 수치 근거로 인정한다."""

    pattern = re.compile(rf"(?<![\d.]){re.escape(candidate)}\s*%")
    return pattern.search(quote) is not None


def _percent_candidates(value: float, *, include_complement: bool = False) -> set[str]:
    decimal_value = Decimal(str(value))
    candidates = {_format_decimal(decimal_value * 100)}
    if include_complement:
        candidates.add(_format_decimal((Decimal("1") - decimal_value) * 100))
    return candidates


def _has_disposal_context(quote: str) -> bool:
    return any(term in quote for term in _DISPOSAL_CONTEXT_TERMS)


def _validate_numeric_quote(
    *,
    field_name: str,
    value: float,
    evidence: EvidenceSpan,
    include_complement: bool = False,
) -> None:
    quote = _normalized_quote(evidence.quote)
    direct_candidate = _format_decimal(Decimal(str(value)) * 100)
    if _contains_percent(quote, direct_candidate):
        return

    candidates = _percent_candidates(value, include_complement=include_complement)
    complement_candidates = candidates - {direct_candidate}
    has_contextual_complement = include_complement and _has_disposal_context(quote) and any(
        _contains_percent(quote, candidate) for candidate in complement_candidates
    )
    if has_contextual_complement:
        return

    expected = ", ".join(f"{candidate}%" for candidate in sorted(candidates))
    context_requirement = (
        "; 여집합 후보는 처분 문맥어가 함께 있어야 합니다"
        if include_complement
        else ""
    )
    raise ValueError(
        f"{field_name}의 evidence.quote에 퍼센트 표기({expected})가 "
        f"숫자 경계와 단위에 맞게 포함되어야 합니다{context_requirement}"
    )


class RatioRule(BaseModel):
    product_type: str
    collateral_type: str
    symbol_group: str
    # 실측 편차 105~170% — 범위 밖이면 추출 오류로 간주
    ratio: float = Field(ge=1.0, le=2.0)
    evidence: EvidenceSpan

    @model_validator(mode="after")
    def require_ratio_in_quote(self):
        _validate_numeric_quote(field_name="ratio", value=self.ratio, evidence=self.evidence)
        return self


class DisposalPriceRule(BaseModel):
    trigger: str
    symbol_group: str
    discount_basis: Literal["prev_close_pct", "lower_limit"]
    discount_rate: Optional[float] = Field(default=None, ge=0.0, le=0.35)
    source_confidence: Literal["explicit", "inferred_from_formula"]
    evidence: EvidenceSpan

    @model_validator(mode="after")
    def require_discount_rate_in_quote(self):
        if self.discount_rate is not None:
            _validate_numeric_quote(
                field_name="discount_rate",
                value=self.discount_rate,
                evidence=self.evidence,
                include_complement=True,
            )
        return self


class ExecutionScheduleRule(BaseModel):
    threshold_ratio: float = Field(ge=1.0, le=2.0)
    day_counting: str
    evidence: EvidenceSpan

    @model_validator(mode="after")
    def require_threshold_ratio_in_quote(self):
        _validate_numeric_quote(
            field_name="threshold_ratio",
            value=self.threshold_ratio,
            evidence=self.evidence,
        )
        return self


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
        if coordinate_kinds == {"character"}:
            flattened_hashes = {
                evidence.flattened_sha256
                for evidence in evidence_spans
                if isinstance(evidence, CharacterEvidenceSpan)
            }
            if len(flattened_hashes) != 1:
                raise ValueError(
                    "문자 좌표를 쓰는 한 ConditionCard 안에서는 flattened_sha256이 같아야 합니다"
                )
        return self
