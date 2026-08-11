"""PDF 원본 5건을 Message Batches API로 비교하는 비용 제한 실행기.

서로 다른 PDF는 prompt cache를 공유하지 못하므로 이 경로에서는 cache_control을
사용하지 않고 Batch 50% 할인만 적용한다. 제출과 결과 수집을 분리하며, 실제
네트워크 작업은 명시적인 ``submit`` 또는 ``collect`` 하위 명령에서만 수행한다.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

from dotenv import dotenv_values

from benchmarks.raw_pdf_comparison import (
    DEFAULT_INPUT_USD_PER_MTOK,
    DEFAULT_KRW_PER_USD,
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODEL,
    DEFAULT_OUTPUT_USD_PER_MTOK,
    EXTRACTION_PROMPT,
    RAW_PDF_INPUT_TOKENS,
    _score_document,
    _selected_files,
    _usage_dict,
    build_document_message,
    extract_page_citations,
)


BATCH_DISCOUNT_MULTIPLIER = 0.5
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.1
DEFAULT_APPROVAL_CEILING_KRW = 1500.0


def estimate_batch_max_cost_krw(
    filenames: Iterable[str],
    *,
    max_tokens: int,
    input_usd_per_mtok: float = DEFAULT_INPUT_USD_PER_MTOK,
    output_usd_per_mtok: float = DEFAULT_OUTPUT_USD_PER_MTOK,
    krw_per_usd: float = DEFAULT_KRW_PER_USD,
) -> float:
    selected = list(filenames)
    input_tokens = sum(RAW_PDF_INPUT_TOKENS[name] for name in selected)
    input_usd = input_tokens / 1_000_000 * input_usd_per_mtok
    output_usd = len(selected) * max_tokens / 1_000_000 * output_usd_per_mtok
    return round(
        (input_usd + output_usd)
        * BATCH_DISCOUNT_MULTIPLIER
        * krw_per_usd,
        2,
    )


def actual_batch_cost_krw(
    usage: Mapping[str, int],
    *,
    input_usd_per_mtok: float = DEFAULT_INPUT_USD_PER_MTOK,
    output_usd_per_mtok: float = DEFAULT_OUTPUT_USD_PER_MTOK,
    krw_per_usd: float = DEFAULT_KRW_PER_USD,
) -> float:
    input_equivalent = (
        usage.get("input_tokens", 0)
        + usage.get("cache_creation_input_tokens", 0) * CACHE_WRITE_MULTIPLIER
        + usage.get("cache_read_input_tokens", 0) * CACHE_READ_MULTIPLIER
    )
    standard_usd = (
        input_equivalent / 1_000_000 * input_usd_per_mtok
        + usage.get("output_tokens", 0) / 1_000_000 * output_usd_per_mtok
    )
    return round(standard_usd * BATCH_DISCOUNT_MULTIPLIER * krw_per_usd, 4)


def build_batch_requests(
    repo_root: Path,
    *,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    limit: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    terms_dir = repo_root / "data" / "terms"
    requests: list[dict[str, Any]] = []
    custom_id_to_filename: dict[str, str] = {}
    for index, filename in enumerate(_selected_files(limit), start=1):
        custom_id = f"pdf-{index:02d}"
        custom_id_to_filename[custom_id] = filename
        requests.append(
            {
                "custom_id": custom_id,
                "params": {
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": 0,
                    "messages": [
                        {
                            "role": "user",
                            "content": build_document_message(
                                terms_dir / filename,
                                use_cache_control=False,
                            ),
                        }
                    ],
                },
            }
        )
    return requests, custom_id_to_filename


def build_batch_dry_run_plan(
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
        "transport": "message_batches",
        "network_requests": 0,
        "model": model,
        "max_tokens_per_document": max_tokens,
        "cache_control": "disabled_distinct_documents",
        "batch_discount": BATCH_DISCOUNT_MULTIPLIER,
        "prompt_sha256": sha256(EXTRACTION_PROMPT.encode("utf-8")).hexdigest(),
        "documents": documents,
        "estimated_max_cost_krw": estimate_batch_max_cost_krw(
            filenames, max_tokens=max_tokens
        ),
        "approval_ceiling_krw": DEFAULT_APPROVAL_CEILING_KRW,
    }


def submit_batch(
    repo_root: Path,
    *,
    client: Any,
    approved_max_krw: float,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    limit: int | None = None,
) -> dict[str, Any]:
    filenames = _selected_files(limit)
    estimated_max = estimate_batch_max_cost_krw(filenames, max_tokens=max_tokens)
    if approved_max_krw < estimated_max:
        raise ValueError(
            f"승인 한도 {approved_max_krw:.2f}원이 Batch 예상 최대 "
            f"{estimated_max:.2f}원보다 작습니다"
        )
    requests, custom_id_to_filename = build_batch_requests(
        repo_root,
        model=model,
        max_tokens=max_tokens,
        limit=limit,
    )
    batch = client.messages.batches.create(requests=requests, timeout=120.0)
    terms_dir = repo_root / "data" / "terms"
    return {
        "status": "submitted",
        "transport": "message_batches",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "batch_id": batch.id,
        "processing_status": batch.processing_status,
        "model": model,
        "max_tokens_per_document": max_tokens,
        "cache_control": "disabled_distinct_documents",
        "batch_discount": BATCH_DISCOUNT_MULTIPLIER,
        "approved_max_cost_krw": approved_max_krw,
        "estimated_max_cost_krw": estimated_max,
        "prompt_sha256": sha256(EXTRACTION_PROMPT.encode("utf-8")).hexdigest(),
        "custom_id_to_filename": custom_id_to_filename,
        "document_sha256": {
            filename: sha256((terms_dir / filename).read_bytes()).hexdigest()
            for filename in filenames
        },
    }


def _result_mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    raise TypeError(f"지원하지 않는 Batch 결과 타입: {type(value).__name__}")


def collect_batch(
    repo_root: Path,
    *,
    client: Any,
    submission: Mapping[str, Any],
) -> dict[str, Any]:
    batch_id = str(submission["batch_id"])
    batch = client.messages.batches.retrieve(batch_id, timeout=60.0)
    if batch.processing_status != "ended":
        counts = _result_mapping(batch.request_counts)
        return {
            "status": "pending",
            "batch_id": batch_id,
            "processing_status": batch.processing_status,
            "request_counts": dict(counts),
        }

    custom_id_to_filename = dict(submission["custom_id_to_filename"])
    document_results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    total_usage: defaultdict[str, int] = defaultdict(int)
    for individual_value in client.messages.batches.results(batch_id, timeout=120.0):
        individual = _result_mapping(individual_value)
        custom_id = str(individual["custom_id"])
        result = _result_mapping(individual["result"])
        filename = custom_id_to_filename.get(custom_id)
        if filename is None:
            raise ValueError(f"제출 manifest에 없는 custom_id: {custom_id}")
        if result.get("type") != "succeeded":
            failures.append(
                {
                    "custom_id": custom_id,
                    "filename": filename,
                    "result_type": str(result.get("type")),
                }
            )
            continue
        message = result["message"]
        citations = extract_page_citations(message)
        if not citations:
            failures.append(
                {
                    "custom_id": custom_id,
                    "filename": filename,
                    "result_type": "missing_page_location_citations",
                }
            )
            continue
        scored = _score_document(filename, citations)
        scored["document_sha256"] = submission["document_sha256"][filename]
        usage = _usage_dict(message)
        scored["usage"] = usage
        document_results.append(scored)
        for key, value in usage.items():
            total_usage[key] += value

    expected_count = len(custom_id_to_filename)
    if len(document_results) != expected_count or failures:
        return {
            "status": "failed",
            "batch_id": batch_id,
            "expected_documents": expected_count,
            "completed_documents": len(document_results),
            "failures": failures,
            "usage": dict(total_usage),
            "actual_cost_krw": actual_batch_cost_krw(total_usage),
        }

    document_results.sort(key=lambda item: item["filename"])
    recovered = sum(item["recovered"] for item in document_results)
    verbatim_recovered = sum(item["verbatim_recovered"] for item in document_results)
    total = sum(item["total"] for item in document_results)
    usage = dict(total_usage)
    return {
        "status": "completed",
        "transport": "message_batches",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "batch_id": batch_id,
        "model": submission["model"],
        "max_tokens_per_document": submission["max_tokens_per_document"],
        "cache_control": submission["cache_control"],
        "batch_discount": submission["batch_discount"],
        "prompt_sha256": submission["prompt_sha256"],
        "approved_max_cost_krw": submission["approved_max_cost_krw"],
        "estimated_max_cost_krw": submission["estimated_max_cost_krw"],
        "actual_cost_krw": actual_batch_cost_krw(usage),
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
        "usage": usage,
    }


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _load_key(repo_root: Path) -> str:
    api_key = dotenv_values(repo_root / ".env").get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("저장소 루트 .env에 ANTHROPIC_API_KEY를 설정해야 합니다")
    return api_key


def _client(repo_root: Path) -> Any:
    import anthropic

    return anthropic.Anthropic(api_key=_load_key(repo_root), max_retries=0)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    subparsers = parser.add_subparsers(dest="command")
    submit = subparsers.add_parser("submit")
    submit.add_argument("--approve-max-krw", type=float, required=True)
    submit.add_argument("--manifest", type=Path)
    collect = subparsers.add_parser("collect")
    collect.add_argument("--manifest", type=Path)
    collect.add_argument("--output", type=Path)
    return parser


def main() -> None:
    args = _parser().parse_args()
    repo_root = Path(__file__).resolve().parents[3]
    results_dir = (
        repo_root / "services" / "ingest" / "benchmarks" / "results"
    )
    manifest_path = getattr(args, "manifest", None) or (
        results_dir / "raw_pdf_batch_submission.json"
    )

    if args.command is None:
        print(
            json.dumps(
                build_batch_dry_run_plan(
                    repo_root,
                    model=args.model,
                    max_tokens=args.max_tokens,
                ),
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    import anthropic

    client = _client(repo_root)
    try:
        if args.command == "submit":
            result = submit_batch(
                repo_root,
                client=client,
                approved_max_krw=args.approve_max_krw,
                model=args.model,
                max_tokens=args.max_tokens,
            )
            _write_json(manifest_path, result)
        else:
            submission = json.loads(manifest_path.read_text(encoding="utf-8"))
            result = collect_batch(
                repo_root,
                client=client,
                submission=submission,
            )
            if result["status"] in {"completed", "failed"}:
                output = args.output or (results_dir / "raw_pdf_document.json")
                _write_json(output, result)
    except anthropic.AnthropicError as error:
        status = getattr(error, "status_code", None)
        suffix = f" (HTTP {status})" if status is not None else ""
        raise SystemExit(
            f"Anthropic Batch API 호출 실패: {type(error).__name__}{suffix}"
        ) from None
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
