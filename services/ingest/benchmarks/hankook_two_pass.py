"""한투 약관의 POST /ingest 2패스 종단 게이트 실행기.

기본 실행은 네트워크 요청 0회의 dry-run이다. 실제 호출은 ``--execute``와
``--approve-max-krw``를 함께 지정하고, 승인액이 보수적 예상 상한 이상일 때만
가능하다. 키는 저장소 루트 ``.env``에서만 읽는다.
"""

from __future__ import annotations

import argparse
import asyncio
from base64 import urlsafe_b64decode
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
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
    evidence_span_lengths,
    prompt_sha256,
)


HANKOOK_FILENAME = "한국투자_신용거래설명서_20260707.htm"
MEASURED_PASS1_INPUT_TOKENS = 42_948
PASS1_UNCACHED_OVERHEAD_TOKENS = 2_048
PASS2_INPUT_CEILING_TOKENS = 16_384
STANDARD_INPUT_USD_PER_MTOK = 3.0
STANDARD_OUTPUT_USD_PER_MTOK = 15.0
INTRODUCTORY_INPUT_USD_PER_MTOK = 2.0
INTRODUCTORY_OUTPUT_USD_PER_MTOK = 10.0
INTRODUCTORY_PRICE_ENDS_ON = "2026-08-31"
KRW_PER_USD = 1_500.0
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10
USAGE_TOKEN_HEADERS = (
    "x-ingest-pass1-input-tokens",
    "x-ingest-pass1-output-tokens",
    "x-ingest-pass1-cache-write-tokens",
    "x-ingest-pass1-cache-read-tokens",
    "x-ingest-pass2-input-tokens",
    "x-ingest-pass2-output-tokens",
)


def lf_normalized_sha256(data: bytes) -> str:
    """개행만 LF로 통일한 교차 플랫폼 비교용 SHA-256을 반환한다.

    ``document_sha256``은 실제 제출 바이트의 감사 기록이라 바꾸지 않는다.
    이 값은 Windows CRLF와 Linux LF 체크아웃을 같은 문서로 대조할 때만 쓴다.
    """

    normalized = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return sha256(normalized).hexdigest()


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
    ) * STANDARD_INPUT_USD_PER_MTOK
    output_cost = (
        pass1_max_tokens + pass2_max_tokens
    ) * STANDARD_OUTPUT_USD_PER_MTOK
    return round((input_cost + output_cost) / 1_000_000 * KRW_PER_USD, 2)


def usage_cost_krw(
    headers: Mapping[str, str],
    *,
    input_usd_per_mtok: float,
    output_usd_per_mtok: float,
) -> float:
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
        input_tokens * input_usd_per_mtok
        + output_tokens * output_usd_per_mtok
    ) / 1_000_000
    return round(usd * KRW_PER_USD, 2)


def evidence_span_report(headers: Mapping[str, str]) -> dict[str, Any]:
    """근거 스팬 관측치를 응답 헤더에서 거둔다 — **판정이 아니라 기록이다.**

    4중 방어가 전부 통과해도 스팬이 크면 근거를 화면에 못 올린다(#47 리뷰).
    4차 실행에서 ratio·execution이 같은 1,621자 표 블록이었고, 그 안에
    105%·120%·140%가 함께 있어 수치 대조가 셋을 똑같이 통과시켰다.
    상한선은 실측이 쌓인 뒤 정한다 — 지금은 값을 남기기만 한다.
    """

    integer_keys = {
        "max_length": "x-ingest-evidence-max-span",
        "min_length": "x-ingest-evidence-min-span",
        "duplicate_spans": "x-ingest-evidence-duplicate-spans",
        "ambiguous_percent_spans": (
            "x-ingest-evidence-ambiguous-percent-spans"
        ),
        "ambiguous_bound_percent_spans": (
            "x-ingest-evidence-ambiguous-bound-percent-spans"
        ),
        "derived_span_count": "x-ingest-evidence-derived-span-count",
        "character_span_count": "x-ingest-evidence-character-span-count",
        "non_character_span_count": (
            "x-ingest-evidence-non-character-span-count"
        ),
        "unmeasurable_span_count": "x-ingest-evidence-unmeasurable-span-count",
    }
    report = {
        name: int(headers[header])
        for name, header in integer_keys.items()
        if header in headers
    }
    coordinate_mode = headers.get("x-ingest-evidence-coordinate-mode")
    if coordinate_mode is not None:
        report["coordinate_mode"] = coordinate_mode
    all_single_percent = headers.get("x-ingest-evidence-all-single-percent")
    if all_single_percent is not None:
        report["all_spans_single_percent_candidate"] = (
            all_single_percent.lower() == "true"
        )
    all_bound_single = headers.get(
        "x-ingest-evidence-all-numeric-bindings-single-percent"
    )
    if all_bound_single is not None:
        report["all_numeric_bindings_single_percent_candidate"] = (
            all_bound_single.lower() == "true"
        )
    encoded_spans = headers.get("x-ingest-evidence-spans")
    if encoded_spans is not None:
        try:
            spans = json.loads(urlsafe_b64decode(encoded_spans).decode("ascii"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        else:
            if isinstance(spans, list):
                report["spans"] = spans
    result = {"evidence_spans": report} if report else {}
    encoded_candidates = headers.get("x-ingest-citation-candidates")
    if encoded_candidates is not None:
        try:
            candidates = json.loads(
                urlsafe_b64decode(encoded_candidates).decode("ascii")
            )
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        else:
            if isinstance(candidates, list):
                result["citation_candidates"] = candidates
    return result


def usage_cost_report(headers: Mapping[str, str]) -> dict[str, Any]:
    """가격표 환산과 콘솔 실청구를 구분한다.

    Messages API usage에는 청구 금액이 없으므로 콘솔에서 대조하기 전에는
    실제 청구액을 주장하지 않는다.
    """

    return {
        "standard_price_usage_estimated_cost_krw": usage_cost_krw(
            headers,
            input_usd_per_mtok=STANDARD_INPUT_USD_PER_MTOK,
            output_usd_per_mtok=STANDARD_OUTPUT_USD_PER_MTOK,
        ),
        "introductory_price_usage_estimated_cost_krw": usage_cost_krw(
            headers,
            input_usd_per_mtok=INTRODUCTORY_INPUT_USD_PER_MTOK,
            output_usd_per_mtok=INTRODUCTORY_OUTPUT_USD_PER_MTOK,
        ),
        "introductory_price_ends_on": INTRODUCTORY_PRICE_ENDS_ON,
        "console_billed_cost_krw": None,
    }


def usage_token_report(headers: Mapping[str, str]) -> dict[str, int]:
    """HTTP 헤더의 토큰 수를 기계 검산 가능한 JSON 정수로 바꾼다."""

    return {
        header.removeprefix("x-ingest-"): int(headers[header])
        for header in USAGE_TOKEN_HEADERS
        if header in headers
    }


def require_approved_budget(approved_max_krw: float) -> float:
    estimated = estimate_max_cost_krw()
    if approved_max_krw < estimated:
        raise ValueError(
            f"승인 한도 {approved_max_krw:.2f}원이 예상 최대 {estimated:.2f}원보다 작습니다"
        )
    return estimated


def build_dry_run_plan(repo_root: Path) -> dict[str, Any]:
    path = repo_root / "data" / "terms" / HANKOOK_FILENAME
    document_bytes = path.read_bytes()
    parsed = parse_document(path)
    return {
        "status": "dry_run",
        "network_requests": 0,
        "endpoint": "POST /ingest",
        "model": DEFAULT_MODEL,
        "document": {
            "filename": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(document_bytes).hexdigest(),
            "sha256_scope": "submitted_bytes",
            "lf_normalized_sha256": lf_normalized_sha256(document_bytes),
            "flattened_sha256": parsed.flattened_sha256,
            "measured_input_tokens": MEASURED_PASS1_INPUT_TOKENS,
        },
        "passes": 2,
        "pass1_max_tokens": PASS1_MAX_TOKENS,
        "pass2_max_tokens": PASS2_MAX_TOKENS,
        "cache_control": "ephemeral_5m",
        "prompt_sha256": prompt_sha256(),
        "estimated_max_cost_krw": estimate_max_cost_krw(),
        "approval_pricing_basis": {
            "input_usd_per_mtok": STANDARD_INPUT_USD_PER_MTOK,
            "output_usd_per_mtok": STANDARD_OUTPUT_USD_PER_MTOK,
            "krw_per_usd": KRW_PER_USD,
        },
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
    path = repo_root / "data" / "terms" / HANKOOK_FILENAME
    document_bytes = path.read_bytes()
    headers = {key.lower(): value for key, value in response.headers.items()}
    if response.status_code != 200:
        timing_headers = {
            key: float(headers[f"x-ingest-{key}-ms"])
            for key in ("parse", "pass1", "pass2", "total")
            if f"x-ingest-{key}-ms" in headers
        }
        usage_headers = usage_token_report(headers)
        failure: dict[str, Any] = {
            "status": "failed",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "endpoint": "POST /ingest",
            "http_status": response.status_code,
            "detail": response.json().get("detail", response.text[:500]),
            "model": model,
            "document_sha256": sha256(document_bytes).hexdigest(),
            "document_sha256_scope": "submitted_bytes",
            "document_lf_sha256": lf_normalized_sha256(document_bytes),
            "prompt_sha256": prompt_sha256(),
            "approved_max_cost_krw": approved_max_krw,
            "estimated_max_cost_krw": estimated,
            "timing_ms": timing_headers,
            "usage": usage_headers,
        }
        required_cost_headers = set(USAGE_TOKEN_HEADERS)
        if required_cost_headers <= headers.keys():
            failure.update(usage_cost_report(headers))
        failure.update(evidence_span_report(headers))
        return failure

    card_data = response.json()
    checks = validate_gate_card(repo_root, card_data, parse_document(path))
    evidence_spans = evidence_span_lengths(ConditionCard.model_validate(card_data))
    header_evidence = evidence_span_report(headers).get("evidence_spans")
    if isinstance(header_evidence, Mapping) and "spans" in header_evidence:
        evidence_spans = dict(header_evidence)
    total_ms = float(headers["x-ingest-total-ms"])
    return {
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": "POST /ingest",
        "model": model,
        "document_sha256": sha256(document_bytes).hexdigest(),
        "document_sha256_scope": "submitted_bytes",
        "document_lf_sha256": lf_normalized_sha256(document_bytes),
        "prompt_sha256": prompt_sha256(),
        "approved_max_cost_krw": approved_max_krw,
        "estimated_max_cost_krw": estimated,
        **usage_cost_report(headers),
        "evidence_spans": evidence_spans,
        "timing_ms": {
            "parse": float(headers["x-ingest-parse-ms"]),
            "pass1": float(headers["x-ingest-pass1-ms"]),
            "pass2": float(headers["x-ingest-pass2-ms"]),
            "total": total_ms,
        },
        "within_60_seconds": total_ms <= 60_000,
        "usage": usage_token_report(headers),
        "checks": checks,
        "card": card_data,
    }


def _write_result(path: Path, result: Mapping[str, Any], *, overwrite: bool = False) -> None:
    """결과를 기록한다. **기존 파일은 물어보지 않는 한 덮지 않는다.**

    유료 실행 1회의 산출물은 되돌릴 수 없다. 경로 선택이 이미 빈 자리를
    고르므로 여기서 걸리면 그 사이에 파일이 생긴 것이다 — 조용히 덮는 대신
    던져서 호출부가 다른 자리에 남기게 한다.

    ⚠ `overwrite` 는 **사람이 명시적으로 요구했을 때만** 참이다. 8차 성공을 정본으로
      올리는 것 같은 판단은 있을 수 있지만, 그건 **결정**이지 부수효과가 아니다.
      기본값이 거짓인 것이 이 함수의 계약이다.
    """

    if path.exists() and not overwrite:
        raise FileExistsError(
            f"{path} 가 이미 있다 — 기존 기록을 덮지 않는다.\n"
            f"  정말 이 자리를 갱신하려면: --overwrite"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


_ATTEMPT_PATTERN = re.compile(r"hankook_two_pass_attempt(\d+)_(?:failed|success)\.json$")


def _results_dir(repo_root: Path) -> Path:
    return repo_root / "services" / "ingest" / "benchmarks" / "results"


def _next_attempt_path(results_dir: Path, suffix: str) -> Path:
    """기존 어떤 기록도 덮지 않는 다음 시도 경로.

    번호는 **단조 증가**한다. 빈 번호를 재사용하면 8차 실행이 ``attempt1`` 로
    기록돼 이력 자체가 거짓이 된다 — 지금 2·3·5·6·7 만 있어 1 이 비어 있다.
    """

    used = {
        int(match.group(1))
        for path in results_dir.glob("hankook_two_pass_attempt*.json")
        if (match := _ATTEMPT_PATTERN.search(path.name))
    }
    attempt = max(used, default=0) + 1
    candidate = results_dir / f"hankook_two_pass_attempt{attempt}_{suffix}.json"
    while candidate.exists():
        attempt += 1
        candidate = results_dir / f"hankook_two_pass_attempt{attempt}_{suffix}.json"
    return candidate


def _default_result_path(repo_root: Path, result: Mapping[str, Any]) -> Path:
    """정본은 **최초 성공만** 만든다. 이후 성공·실패는 시도 번호로 보존한다.

    이전 구현은 성공이면 무조건 정본 경로를 돌려줘, 재실행이 성공하는 순간
    4차 성공 기록을 덮었다. 그 파일은 되돌릴 수 없는 유료 실행 1회의
    산출물이면서 ``packages/engine/test/fixtures/hankook-ingest-fourth-success.json``
    의 ``source_result`` 가 가리키는 대상이다 — 덮이면 픽스처의 출처 주장이
    **조용히 거짓**이 된다(그 테스트는 문자열끼리만 비교하므로 계속 통과한다).
    """

    results_dir = _results_dir(repo_root)
    completed = result.get("status") == "completed"
    canonical = results_dir / "hankook_two_pass.json"
    if completed and not canonical.exists():
        return canonical
    return _next_attempt_path(results_dir, "success" if completed else "failed")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="실제 Anthropic API 호출")
    parser.add_argument("--approve-max-krw", type=float)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="이미 있는 결과 파일을 덮는다. 되돌릴 수 없는 유료 실행 기록을 지우는 "
        "행위이므로 **사람이 판단해서** 붙인다(기본값은 거부).",
    )
    return parser


def main() -> None:
    args = _parser().parse_args()
    repo_root = Path(__file__).resolve().parents[3]
    if not args.execute:
        print(json.dumps(build_dry_run_plan(repo_root), ensure_ascii=False, indent=2))
        return
    if args.approve_max_krw is None:
        raise SystemExit("--execute에는 --approve-max-krw가 필수입니다")
    # 유료 호출 **전에** 막는다 — 실행한 뒤에 거절하면 되돌릴 수 없는 결과를 잃는다.
    if args.output is not None and args.output.exists() and not args.overwrite:
        raise SystemExit(
            f"--output {args.output} 가 이미 있다 — 기존 기록을 덮지 않는다. 호출하지 않았다.\n"
            f"  정말 이 자리를 갱신하려면: --overwrite"
        )

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

    output = args.output or _default_result_path(repo_root, result)
    if output.exists() and not args.overwrite:
        # 그 사이 생겼다면 결과를 버리지 않고 옆자리에 남긴다 — 재실행은 유료다.
        rescue = _next_attempt_path(
            _results_dir(repo_root),
            "success" if result.get("status") == "completed" else "failed",
        )
        print(f"경고: {output} 가 이미 있어 {rescue} 에 기록한다", file=sys.stderr)
        output = rescue
    _write_result(output, result, overwrite=args.overwrite)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] != "completed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
