"""Anthropic PDF document 블록 경로의 근거 재현율 비교.

기본 실행은 비용 계획만 출력하는 dry-run이다. 실제 API 호출은 ``--execute``와
``--approve-max-krw``를 함께 줬을 때만 가능하며, 키는 저장소 루트 ``.env``에서만
읽는다. 프롬프트에는 골든 문구를 넣지 않고, 응답의 page_location citations에
포함된 cited_text만 기존 고정 사실과 대조한다.
"""

from __future__ import annotations

import argparse
import base64
from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

from dotenv import dotenv_values

from benchmarks.path_comparison import PDF_TEXT_FACTS, _normalize_for_match


DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_MAX_TOKENS = 2048
DEFAULT_INPUT_USD_PER_MTOK = 3.0
DEFAULT_OUTPUT_USD_PER_MTOK = 15.0
DEFAULT_KRW_PER_USD = 1500.0
CACHE_WRITE_MULTIPLIER = 1.25

# PR #28에서 count_tokens로 측정한 현재 저장소 PDF 정본의 원본 document 입력 토큰.
RAW_PDF_INPUT_TOKENS = {
    "신한_신용거래설명서_20260330.pdf": 87_441,
    "메리츠_신용거래설명서_20250421.pdf": 77_948,
    "미래에셋_신용거래설명서_20250324.pdf": 68_488,
    "삼성_신용거래핵심설명서_20240822.pdf": 54_484,
    "키움_국내주식핵심설명서_20260612.pdf": 50_252,
}

EXTRACTION_PROMPT = """이 문서는 증권사의 신용거래·반대매매 약관 또는 핵심설명서입니다.
다음 범주의 원문 근거를 가능한 한 빠짐없이 찾아 각각 별도 항목으로 답하세요.

- 담보유지비율과 종목군별 비율
- 담보부족 시 임의처분·반대매매의 기준가격, 할인율, 하한가 규칙
- 실행 시점과 미해소 시 다음 단계
- 문서에 제시된 반대매매 수량 계산 예시와 결과

반드시 모든 항목에 citations를 붙이세요. 문서에 없는 값은 추론하지 말고,
산식 계산이나 요약값을 새로 만들지 마세요. 표에 있는 값도 행·열 관계가 드러나게
인용하세요."""


def _facts_by_file() -> dict[str, list[Any]]:
    grouped: dict[str, list[Any]] = defaultdict(list)
    for fact in PDF_TEXT_FACTS:
        grouped[fact.source_file].append(fact)
    return dict(grouped)


def _selected_files(limit: int | None = None) -> list[str]:
    filenames = sorted(_facts_by_file())
    return filenames if limit is None else filenames[:limit]


def estimate_max_cost_krw(
    filenames: Iterable[str],
    *,
    max_tokens: int,
    input_usd_per_mtok: float = DEFAULT_INPUT_USD_PER_MTOK,
    output_usd_per_mtok: float = DEFAULT_OUTPUT_USD_PER_MTOK,
    krw_per_usd: float = DEFAULT_KRW_PER_USD,
) -> float:
    selected = list(filenames)
    input_tokens = sum(RAW_PDF_INPUT_TOKENS[name] for name in selected)
    input_usd = input_tokens / 1_000_000 * input_usd_per_mtok * CACHE_WRITE_MULTIPLIER
    output_usd = len(selected) * max_tokens / 1_000_000 * output_usd_per_mtok
    return round((input_usd + output_usd) * krw_per_usd, 2)


def build_document_message(
    pdf_path: Path, *, use_cache_control: bool = True
) -> list[dict[str, Any]]:
    encoded = base64.standard_b64encode(pdf_path.read_bytes()).decode("ascii")
    document: dict[str, Any] = {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": encoded,
        },
        "title": pdf_path.name,
        "citations": {"enabled": True},
    }
    if use_cache_control:
        document["cache_control"] = {"type": "ephemeral"}
    return [
        document,
        {"type": "text", "text": EXTRACTION_PROMPT},
    ]


def _to_mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    raise TypeError(f"지원하지 않는 Anthropic 응답 타입: {type(value).__name__}")


def extract_page_citations(message: Any) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    content = message.get("content", []) if isinstance(message, Mapping) else getattr(message, "content", [])
    for block_value in content:
        block = _to_mapping(block_value)
        if block.get("type") != "text":
            continue
        for citation_value in block.get("citations") or []:
            citation = dict(_to_mapping(citation_value))
            if citation.get("type") != "page_location":
                raise ValueError("PDF 원본 응답에는 page_location citation만 허용됩니다")
            citations.append(
                {
                    "cited_text": citation["cited_text"],
                    "start_page_number": citation["start_page_number"],
                    "end_page_number": citation["end_page_number"],
                    "document_index": citation.get("document_index", 0),
                    "document_title": citation.get("document_title"),
                }
            )
    return citations


def _usage_dict(message: Any) -> dict[str, int]:
    usage_value = message.get("usage", {}) if isinstance(message, Mapping) else getattr(message, "usage", {})
    usage = _to_mapping(usage_value) if usage_value else {}
    keys = (
        "input_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "output_tokens",
    )
    return {key: int(usage.get(key, 0) or 0) for key in keys}


def _score_document(filename: str, citations: list[dict[str, Any]]) -> dict[str, Any]:
    facts = _facts_by_file()[filename]
    cited_text = "\n".join(citation["cited_text"] for citation in citations)
    normalized_cited_text = _normalize_for_match(cited_text)
    normalized_missing = [
        fact.fact_id
        for fact in facts
        if _normalize_for_match(fact.expected_text) not in normalized_cited_text
    ]
    verbatim_missing = [
        fact.fact_id for fact in facts if fact.expected_text not in cited_text
    ]
    return {
        "filename": filename,
        "cited_text_sha256": sha256(cited_text.encode("utf-8")).hexdigest(),
        "citations": citations,
        "recovered": len(facts) - len(normalized_missing),
        "total": len(facts),
        "missing_fact_ids": normalized_missing,
        "verbatim_recovered": len(facts) - len(verbatim_missing),
        "verbatim_missing_fact_ids": verbatim_missing,
    }


def build_dry_run_plan(
    repo_root: Path,
    *,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    limit: int | None = None,
) -> dict[str, Any]:
    filenames = _selected_files(limit)
    terms_dir = repo_root / "data" / "terms"
    documents = []
    for filename in filenames:
        path = terms_dir / filename
        documents.append(
            {
                "filename": filename,
                "bytes": path.stat().st_size,
                "sha256": sha256(path.read_bytes()).hexdigest(),
                "measured_input_tokens": RAW_PDF_INPUT_TOKENS[filename],
            }
        )
    return {
        "status": "dry_run",
        "network_requests": 0,
        "model": model,
        "max_tokens_per_document": max_tokens,
        "cache_control": "ephemeral_5m",
        "prompt_sha256": sha256(EXTRACTION_PROMPT.encode("utf-8")).hexdigest(),
        "documents": documents,
        "estimated_max_cost_krw": estimate_max_cost_krw(
            filenames, max_tokens=max_tokens
        ),
        "execution_requirements": [
            "저장소 루트 .env의 ANTHROPIC_API_KEY",
            "--execute",
            "--approve-max-krw가 estimated_max_cost_krw 이상",
        ],
    }


def run_comparison(
    repo_root: Path,
    *,
    client: Any,
    approved_max_krw: float,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    limit: int | None = None,
) -> dict[str, Any]:
    filenames = _selected_files(limit)
    estimated_max = estimate_max_cost_krw(filenames, max_tokens=max_tokens)
    if approved_max_krw < estimated_max:
        raise ValueError(
            f"승인 한도 {approved_max_krw:.2f}원이 예상 최대 {estimated_max:.2f}원보다 작습니다"
        )

    terms_dir = repo_root / "data" / "terms"
    document_results: list[dict[str, Any]] = []
    total_usage = defaultdict(int)
    for filename in filenames:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=0,
            messages=[
                {
                    "role": "user",
                    "content": build_document_message(terms_dir / filename),
                }
            ],
            timeout=120.0,
        )
        citations = extract_page_citations(response)
        if not citations:
            raise ValueError(f"{filename}: page_location citation이 한 건도 없습니다")
        scored = _score_document(filename, citations)
        scored["document_sha256"] = sha256(
            (terms_dir / filename).read_bytes()
        ).hexdigest()
        usage = _usage_dict(response)
        scored["usage"] = usage
        document_results.append(scored)
        for key, value in usage.items():
            total_usage[key] += value

    recovered = sum(item["recovered"] for item in document_results)
    verbatim_recovered = sum(item["verbatim_recovered"] for item in document_results)
    total = sum(item["total"] for item in document_results)
    return {
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "max_tokens_per_document": max_tokens,
        "cache_control": "ephemeral_5m",
        "prompt_sha256": sha256(EXTRACTION_PROMPT.encode("utf-8")).hexdigest(),
        "approved_max_cost_krw": approved_max_krw,
        "estimated_max_cost_krw": estimated_max,
        "documents": document_results,
        "recovered": recovered,
        "total": total,
        "rate": recovered / total,
        "verbatim_recovered": verbatim_recovered,
        "verbatim_rate": verbatim_recovered / total,
        "missing_fact_ids": [
            fact_id
            for item in document_results
            for fact_id in item["missing_fact_ids"]
        ],
        "usage": dict(total_usage),
    }


def _write_result(path: Path, result: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="실제 Anthropic API 호출")
    parser.add_argument("--approve-max-krw", type=float)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    parser.add_argument("--max-documents", type=int, choices=range(1, 6))
    parser.add_argument(
        "--output",
        type=Path,
        help="완료 결과 JSON 경로. 기본값은 benchmarks/results/raw_pdf_document.json",
    )
    return parser


def main() -> None:
    args = _parser().parse_args()
    repo_root = Path(__file__).resolve().parents[3]
    plan = build_dry_run_plan(
        repo_root,
        model=args.model,
        max_tokens=args.max_tokens,
        limit=args.max_documents,
    )
    if not args.execute:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return

    if args.approve_max_krw is None:
        raise SystemExit("--execute에는 --approve-max-krw가 필수입니다")

    # 셸 환경이나 명령줄에서 키를 받지 않는다. 저장소 루트 .env만 단일 출처로 쓴다.
    api_key = dotenv_values(repo_root / ".env").get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("저장소 루트 .env에 ANTHROPIC_API_KEY를 설정해야 합니다")

    import anthropic

    # SDK 기본 재시도(2회)도 비용을 만들 수 있으므로 비교 실행에서는 명시적으로 끈다.
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    try:
        result = run_comparison(
            repo_root,
            client=client,
            approved_max_krw=args.approve_max_krw,
            model=args.model,
            max_tokens=args.max_tokens,
            limit=args.max_documents,
        )
    except anthropic.AnthropicError as error:
        status = getattr(error, "status_code", None)
        suffix = f" (HTTP {status})" if status is not None else ""
        raise SystemExit(f"Anthropic API 호출 실패: {type(error).__name__}{suffix}") from None

    output = args.output or (
        repo_root
        / "services"
        / "ingest"
        / "benchmarks"
        / "results"
        / "raw_pdf_document.json"
    )
    _write_result(output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
