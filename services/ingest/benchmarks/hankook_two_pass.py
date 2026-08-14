"""한투 약관의 POST /ingest 2패스 종단 게이트 실행기.

기본 실행은 네트워크 요청 0회의 dry-run이다. 실제 호출은 ``--execute``와
``--approve-max-krw``를 함께 지정하고, 승인액이 보수적 예상 상한 이상일 때만
가능하다. 키는 저장소 루트 ``.env``에서만 읽는다.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Mapping

import anthropic
from dotenv import dotenv_values
import httpx
from jsonschema import Draft7Validator

from app.main import app, get_ingest_service
from app.parsing import ParsedDocument, parse_document
from app.schemas import CharacterEvidenceSpan, ConditionCard
from app.two_pass import (
    DEFAULT_MODEL,
    PASS1_MAX_TOKENS,
    PASS2_MAX_TOKENS,
    TwoPassIngestService,
    prompt_sha256,
)


HANKOOK_FILENAME = "한국투자_신용거래설명서_20260707.htm"
MEASURED_PASS1_INPUT_TOKENS = 42_948
PASS1_UNCACHED_OVERHEAD_TOKENS = 2_048
PASS2_INPUT_CEILING_TOKENS = 16_384
INPUT_USD_PER_MTOK = 3.0
OUTPUT_USD_PER_MTOK = 15.0
KRW_PER_USD = 1_500.0
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


def estimate_max_cost_krw(
    *,
    pass1_max_tokens: int = PASS1_MAX_TOKENS,
    pass2_max_tokens: int = PASS2_MAX_TOKENS,
) -> float:
    """#28 실측 토큰에 프롬프트·스키마 여유분을 더한 보수적 최초 호출 상한."""

    input_cost = (
        MEASURED_PASS1_INPUT_TOKENS * CACHE_WRITE_MULTIPLIER
        + PASS1_UNCACHED_OVERHEAD_TOKENS
        + PASS2_INPUT_CEILING_TOKENS
    ) * INPUT_USD_PER_MTOK
    output_cost = (pass1_max_tokens + pass2_max_tokens) * OUTPUT_USD_PER_MTOK
    return round((input_cost + output_cost) / 1_000_000 * KRW_PER_USD, 2)


def actual_cost_krw(headers: Mapping[str, str]) -> float:
    pass1_input = int(headers["x-ingest-pass1-input-tokens"])
    pass1_output = int(headers["x-ingest-pass1-output-tokens"])
    pass1_cache_write = int(headers["x-ingest-pass1-cache-write-tokens"])
    pass1_cache_read = int(headers["x-ingest-pass1-cache-read-tokens"])
    pass2_input = int(headers["x-ingest-pass2-input-tokens"])
    pass2_output = int(headers["x-ingest-pass2-output-tokens"])
    input_tokens = (
        pass1_input
        + pass2_input
        + pass1_cache_write * CACHE_WRITE_MULTIPLIER
        + pass1_cache_read * CACHE_READ_MULTIPLIER
    )
    output_tokens = pass1_output + pass2_output
    usd = (
        input_tokens * INPUT_USD_PER_MTOK
        + output_tokens * OUTPUT_USD_PER_MTOK
    ) / 1_000_000
    return round(usd * KRW_PER_USD, 2)


def require_approved_budget(approved_max_krw: float) -> float:
    estimated = estimate_max_cost_krw()
    if approved_max_krw < estimated:
        raise ValueError(
            f"승인 한도 {approved_max_krw:.2f}원이 예상 최대 {estimated:.2f}원보다 작습니다"
        )
    return estimated


def build_dry_run_plan(repo_root: Path) -> dict[str, Any]:
    path = repo_root / "data" / "terms" / HANKOOK_FILENAME
    parsed = parse_document(path)
    return {
        "status": "dry_run",
        "network_requests": 0,
        "endpoint": "POST /ingest",
        "model": DEFAULT_MODEL,
        "document": {
            "filename": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(path.read_bytes()).hexdigest(),
            "flattened_sha256": parsed.flattened_sha256,
            "measured_input_tokens": MEASURED_PASS1_INPUT_TOKENS,
        },
        "passes": 2,
        "pass1_max_tokens": PASS1_MAX_TOKENS,
        "pass2_max_tokens": PASS2_MAX_TOKENS,
        "cache_control": "ephemeral_5m",
        "prompt_sha256": prompt_sha256(),
        "estimated_max_cost_krw": estimate_max_cost_krw(),
        "execution_requirements": [
            "저장소 루트 .env의 ANTHROPIC_API_KEY",
            "--execute",
            "--approve-max-krw가 estimated_max_cost_krw 이상",
        ],
    }


def _all_evidence(card: ConditionCard) -> list[CharacterEvidenceSpan]:
    evidence = [
        *(rule.evidence for rule in card.ratio_rules),
        *(rule.evidence for rule in card.disposal_price_rules),
        *(rule.evidence for rule in card.execution_schedule),
    ]
    if not all(isinstance(span, CharacterEvidenceSpan) for span in evidence):
        raise ValueError("한투 HTML 카드는 문자형 evidence만 허용됩니다")
    return [span for span in evidence if isinstance(span, CharacterEvidenceSpan)]


def validate_gate_card(
    repo_root: Path,
    card_data: Mapping[str, Any],
    parsed: ParsedDocument,
) -> dict[str, bool]:
    schema = json.loads(
        (repo_root / "schemas" / "condition_card.schema.json").read_text(
            encoding="utf-8"
        )
    )
    schema_errors = list(Draft7Validator(schema).iter_errors(card_data))
    if schema_errors:
        raise ValueError(f"JSON Schema 재검증 실패: {schema_errors[0].message}")
    card = ConditionCard.model_validate(card_data)
    if card.status != "draft":
        raise ValueError("게이트 카드 status가 draft가 아닙니다")

    source = parsed.units[0].text
    for evidence in _all_evidence(card):
        if evidence.flattened_sha256 != parsed.flattened_sha256:
            raise ValueError("evidence 평탄화 해시가 한투 원문과 다릅니다")
        if source[evidence.char_start : evidence.char_end] != evidence.quote:
            raise ValueError("evidence 좌표가 한투 평탄화 원문을 가리키지 않습니다")

    discount_rates = {
        rule.discount_rate
        for rule in card.disposal_price_rules
        if rule.discount_basis == "prev_close_pct"
    }
    if 0.15 not in discount_rates:
        raise ValueError("한투 골든 할인율 h=0.15를 찾지 못했습니다")
    return {
        "status_draft": True,
        "evidence_coordinates_and_quotes": True,
        "json_schema_and_pydantic": True,
        "numeric_ranges": True,
        "formula_contamination_rejected_by_endpoint": True,
        "golden_h_0_15": True,
    }


async def _post_ingest(
    *, repo_root: Path, api_key: str, model: str
) -> httpx.Response:
    sdk = anthropic.AsyncAnthropic(api_key=api_key, max_retries=0)
    service = TwoPassIngestService(sdk, model=model)
    app.dependency_overrides[get_ingest_service] = lambda: service
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ingest.local",
            timeout=180.0,
        ) as client:
            path = repo_root / "data" / "terms" / HANKOOK_FILENAME
            return await client.post(
                "/ingest",
                files={"file": (path.name, path.read_bytes(), "text/html")},
            )
    finally:
        app.dependency_overrides.clear()
        await sdk.close()


def run_hankook(
    repo_root: Path,
    *,
    api_key: str,
    approved_max_krw: float,
    model: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    estimated = require_approved_budget(approved_max_krw)
    response = asyncio.run(_post_ingest(repo_root=repo_root, api_key=api_key, model=model))
    if response.status_code != 200:
        raise RuntimeError(
            f"POST /ingest 실패: HTTP {response.status_code} {response.text[:500]}"
        )

    card_data = response.json()
    path = repo_root / "data" / "terms" / HANKOOK_FILENAME
    checks = validate_gate_card(repo_root, card_data, parse_document(path))
    headers = {key.lower(): value for key, value in response.headers.items()}
    total_ms = float(headers["x-ingest-total-ms"])
    return {
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": "POST /ingest",
        "model": model,
        "document_sha256": sha256(path.read_bytes()).hexdigest(),
        "prompt_sha256": prompt_sha256(),
        "approved_max_cost_krw": approved_max_krw,
        "estimated_max_cost_krw": estimated,
        "actual_estimated_cost_krw": actual_cost_krw(headers),
        "timing_ms": {
            "parse": float(headers["x-ingest-parse-ms"]),
            "pass1": float(headers["x-ingest-pass1-ms"]),
            "pass2": float(headers["x-ingest-pass2-ms"]),
            "total": total_ms,
        },
        "within_60_seconds": total_ms <= 60_000,
        "usage": {
            key.removeprefix("x-ingest-"): value
            for key, value in headers.items()
            if key.startswith("x-ingest-pass") and key.endswith("tokens")
        },
        "checks": checks,
        "card": card_data,
    }


def _write_result(path: Path, result: Mapping[str, Any]) -> None:
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
    parser.add_argument("--output", type=Path)
    return parser


def main() -> None:
    args = _parser().parse_args()
    repo_root = Path(__file__).resolve().parents[3]
    if not args.execute:
        print(json.dumps(build_dry_run_plan(repo_root), ensure_ascii=False, indent=2))
        return
    if args.approve_max_krw is None:
        raise SystemExit("--execute에는 --approve-max-krw가 필수입니다")

    api_key = dotenv_values(repo_root / ".env").get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("저장소 루트 .env에 ANTHROPIC_API_KEY를 설정해야 합니다")
    try:
        result = run_hankook(
            repo_root,
            api_key=str(api_key),
            approved_max_krw=args.approve_max_krw,
            model=args.model,
        )
    except (ValueError, RuntimeError, anthropic.AnthropicError) as error:
        raise SystemExit(str(error)) from None

    output = args.output or (
        repo_root
        / "services"
        / "ingest"
        / "benchmarks"
        / "results"
        / "hankook_two_pass.json"
    )
    _write_result(output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
