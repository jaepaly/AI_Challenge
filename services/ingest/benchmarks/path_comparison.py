"""§5-B-2 입력 경로별 핵심 표 사실 재현율 비교.

HTML 평탄화와 pypdf 텍스트 경로는 로컬에서 결정론적으로 측정한다.
PDF 원본 document 블록 경로는 Claude Code 구독 또는 Anthropic API가 있어야
실행할 수 있으므로, 이 모듈은 그 경로를 임의의 대체 파서로 가장하지 않는다.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path

from pypdf import __version__ as pypdf_version

from app.parsing import ParsedDocument, parse_html, parse_pdf_text


@dataclass(frozen=True)
class ReproductionFact:
    fact_id: str
    source_file: str
    expected_text: str


@dataclass(frozen=True)
class PathResult:
    path: str
    coordinate_kind: str
    documents: int
    recovered: int
    total: int
    rate: float
    missing_fact_ids: tuple[str, ...]
    delimiter_count: int
    delimiter_rows: int
    note: str


HTML_FACTS = (
    ReproductionFact(
        "kis-ratio-140",
        "한국투자_신용거래설명서_20260707.htm",
        "최저담보유지비율 140%",
    ),
    ReproductionFact(
        "kis-discount-15",
        "한국투자_신용거래설명서_20260707.htm",
        "전일종가(8,100원) 대비 15% 하락한 가격(6,890원)",
    ),
    ReproductionFact(
        "kis-required-195",
        "한국투자_신용거래설명서_20260707.htm",
        "195주 반대매매 필요",
    ),
    ReproductionFact(
        "eugene-ratio-140",
        "유진_반대매매안내_수집20260805.html",
        "신용담보유지비율이 140% 이상 되도록 산정",
    ),
    ReproductionFact(
        "eugene-lower-limit",
        "유진_반대매매안내_수집20260805.html",
        "반대매매수량 계산시 기준가격은 하한가로 계산",
    ),
    ReproductionFact(
        "eugene-voluntary-resolution",
        "유진_반대매매안내_수집20260805.html",
        "담보부족발생일(D), (D+1)일 일반매매를 통해 일부상환 방식으로 해소가능",
    ),
)


PDF_TEXT_FACTS = (
    ReproductionFact(
        "meritz-group-ratios",
        "메리츠_신용거래설명서_20250421.pdf",
        "신용거래융자기본형∙투자형A∙B군 140% C∙D군 150%",
    ),
    ReproductionFact(
        "meritz-discount-20",
        "메리츠_신용거래설명서_20250421.pdf",
        "전일 종가 대비 20% 할인/할증된 가격",
    ),
    ReproductionFact(
        "meritz-required-309",
        "메리츠_신용거래설명서_20250421.pdf",
        "309주 반대매매 필요",
    ),
    ReproductionFact(
        "samsung-grade-prices",
        "삼성_신용거래핵심설명서_20240822.pdf",
        "종목등급 S, A는 85%, B등급 이하는 80%",
    ),
    ReproductionFact(
        "samsung-second-stage",
        "삼성_신용거래핵심설명서_20240822.pdf",
        "시초가에 주문 체결 후 담보부족 미해소시 부족분 만큼 하한가 및 해소가능 수량으로 재계산",
    ),
    ReproductionFact(
        "samsung-required-972",
        "삼성_신용거래핵심설명서_20240822.pdf",
        "972주 반대매매 필요",
    ),
    ReproductionFact(
        "shinhan-unpaid-formula",
        "신한_신용거래설명서_20260330.pdf",
        "산식 : 미수금 / 해당종목 하한가",
    ),
    ReproductionFact(
        "shinhan-grade-discounts",
        "신한_신용거래설명서_20260330.pdf",
        "A, / B / C종목 : - 15%, D / E / Z 종목 : -20%",
    ),
    ReproductionFact(
        "shinhan-required-715",
        "신한_신용거래설명서_20260330.pdf",
        "715주가 임의처분 수량으로 산정",
    ),
    ReproductionFact(
        "mirae-discount-range",
        "미래에셋_신용거래설명서_20250324.pdf",
        "전일종가 대비 15%~30% 할인된 가격",
    ),
    ReproductionFact(
        "mirae-required-195",
        "미래에셋_신용거래설명서_20250324.pdf",
        "임의처분수량 : 195주",
    ),
    ReproductionFact(
        "kiwoom-unpaid-lower-limit",
        "키움_국내주식핵심설명서_20260612.pdf",
        "반대매매는 하한가를 기준으로 수량을 계산하여 시장가로 자동 매도 주문",
    ),
    ReproductionFact(
        "kiwoom-next-open",
        "키움_국내주식핵심설명서_20260612.pdf",
        "다음날 장개시 동시호가에 해당계좌에서 자동으로 매도 처리",
    ),
)


def _normalize_for_match(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", "", normalized)


def _score_documents(
    path_name: str,
    coordinate_kind: str,
    documents: dict[str, ParsedDocument],
    facts: tuple[ReproductionFact, ...],
    note: str,
) -> PathResult:
    normalized_documents = {
        filename: _normalize_for_match(document.units[0].text)
        for filename, document in documents.items()
    }
    missing = tuple(
        fact.fact_id
        for fact in facts
        if _normalize_for_match(fact.expected_text)
        not in normalized_documents[fact.source_file]
    )
    delimiter_rows = sum(
        1
        for document in documents.values()
        for line in document.units[0].text.splitlines()
        if "\t" in line
    )
    delimiter_count = sum(
        document.units[0].text.count("\t") for document in documents.values()
    )
    recovered = len(facts) - len(missing)
    return PathResult(
        path=path_name,
        coordinate_kind=coordinate_kind,
        documents=len(documents),
        recovered=recovered,
        total=len(facts),
        rate=recovered / len(facts),
        missing_fact_ids=missing,
        delimiter_count=delimiter_count,
        delimiter_rows=delimiter_rows,
        note=note,
    )


def compare_local_paths(repo_root: Path) -> dict[str, object]:
    terms_dir = repo_root / "data" / "terms"
    html_files = sorted({fact.source_file for fact in HTML_FACTS})
    pdf_files = sorted({fact.source_file for fact in PDF_TEXT_FACTS})
    html_documents = {filename: parse_html(terms_dir / filename) for filename in html_files}
    pdf_documents = {
        filename: parse_pdf_text(terms_dir / filename) for filename in pdf_files
    }

    html_result = _score_documents(
        "html_flatten",
        "char_location",
        html_documents,
        HTML_FACTS,
        "표 행은 개행, 셀은 탭으로 보존하고 평탄화 SHA-256으로 좌표를 고정한다.",
    )
    pdf_text_result = _score_documents(
        "pypdf_text",
        "char_location",
        pdf_documents,
        PDF_TEXT_FACTS,
        "핵심 사실은 측정하되 pypdf 출력에는 명시적인 셀 탭 경계가 없다.",
    )

    return {
        "environment": {
            "html_documents": len(html_documents),
            "pdf_documents": len(pdf_documents),
            "pypdf_version": pypdf_version,
        },
        "results": [asdict(html_result), asdict(pdf_text_result)],
        "raw_pdf_document": {
            "status": "not_run",
            "coordinate_kind": "page_location",
            "reason": "Claude Code 구독 중단 상태이며 유료 Anthropic API는 사용하지 않음",
        },
        "branch_decision": {
            "html": "html_flatten + char_location + flattened_sha256",
            "pdf": "pending: raw PDF document 경로 실행 전에는 pypdf와 최종 비교 불가",
        },
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    print(json.dumps(compare_local_paths(repo_root), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
