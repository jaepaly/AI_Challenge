from base64 import urlsafe_b64encode
from datetime import datetime, timezone
import json
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from benchmarks.hankook_two_pass import (
    HANKOOK_FILENAME,
    _default_result_path,
    _next_attempt_path,
    _parser,
    _write_result,
    build_dry_run_plan,
    evidence_span_report,
    estimate_max_cost_krw,
    lf_normalized_sha256,
    record_console_billed_cost,
    require_approved_budget,
    usage_cost_report,
    usage_token_report,
    validate_gate_card,
)
from app.parsing import parse_document
from app.schemas import ConditionCard
from app.two_pass import (
    PASS1_SYSTEM,
    CitationSpan,
    _maintenance_row_values,
    _percent_values,
    _role_citations,
    evidence_span_lengths,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
RECORDED_RESULT = (
    REPO_ROOT
    / "services"
    / "ingest"
    / "benchmarks"
    / "results"
    / "hankook_two_pass.json"
)
ENGINE_FROZEN_FIXTURE = (
    REPO_ROOT
    / "packages"
    / "engine"
    / "test"
    / "fixtures"
    / "hankook-ingest-fourth-success.json"
)
ATTEMPT6_RESULT = (
    REPO_ROOT
    / "services"
    / "ingest"
    / "benchmarks"
    / "results"
    / "hankook_two_pass_attempt6_failed.json"
)


class HankookTwoPassGateTest(unittest.TestCase):
    def test_default_output_keeps_success_canonical_and_versions_failures(self) -> None:
        root = Path("C:/virtual-repo")
        results = root / "services" / "ingest" / "benchmarks" / "results"
        with patch.object(
            Path,
            "exists",
            autospec=True,
            side_effect=lambda path: path.name == "hankook_two_pass_attempt1_failed.json",
        ):
            self.assertEqual(
                _default_result_path(root, {"status": "completed"}),
                results / "hankook_two_pass.json",
            )
            self.assertEqual(
                _default_result_path(root, {"status": "failed"}),
                results / "hankook_two_pass_attempt2_failed.json",
            )

    def test_success_never_overwrites_an_existing_canonical_record(self) -> None:
        """재실행이 성공해도 4차 성공 기록을 덮지 않는다.

        이전 구현은 status=completed 면 무조건 정본 경로를 돌려줬다. 8차 유료
        실행이 성공하는 순간 4차 기록이 사라지는데, 그 파일은 되돌릴 수 없다.
        """

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            results = root / "services" / "ingest" / "benchmarks" / "results"
            results.mkdir(parents=True)
            canonical = results / "hankook_two_pass.json"
            canonical.write_text("4차", encoding="utf-8")

            chosen = _default_result_path(root, {"status": "completed"})

            self.assertNotEqual(chosen, canonical)
            self.assertFalse(chosen.exists())
            self.assertTrue(chosen.name.endswith("_success.json"))
            self.assertEqual(canonical.read_text(encoding="utf-8"), "4차")

    def test_first_success_still_creates_the_canonical_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            results = root / "services" / "ingest" / "benchmarks" / "results"
            results.mkdir(parents=True)

            self.assertEqual(
                _default_result_path(root, {"status": "completed"}),
                results / "hankook_two_pass.json",
            )

    def test_attempt_numbers_increase_instead_of_filling_gaps(self) -> None:
        """빈 번호를 재사용하지 않는다 — 8차가 attempt1 로 기록되면 이력이 거짓이다.

        저장소 실제 상태가 그 함정이다: 2·3·5·6·7 만 있어 1 과 4 가 비어 있다
        (4 는 정본이 가져갔다). 첫 빈 자리를 쓰면 다음 실행이 attempt1 이 된다.
        """

        with tempfile.TemporaryDirectory() as tmp:
            results = Path(tmp)
            for number in (2, 3, 5, 6, 7):
                (results / f"hankook_two_pass_attempt{number}_failed.json").write_text(
                    "x", encoding="utf-8"
                )

            self.assertEqual(
                _next_attempt_path(results, "failed").name,
                "hankook_two_pass_attempt8_failed.json",
            )
            self.assertEqual(
                _next_attempt_path(results, "success").name,
                "hankook_two_pass_attempt8_success.json",
            )

    def test_write_result_refuses_to_clobber(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hankook_two_pass.json"
            path.write_text("기존", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                _write_result(path, {"status": "completed"})

            self.assertEqual(path.read_text(encoding="utf-8"), "기존")

    def test_overwrite_is_possible_but_must_be_asked_for(self) -> None:
        """8차를 정본으로 올리는 판단은 있을 수 있다 — 다만 **결정**이지 부수효과가 아니다.

        탈출구가 없으면 사람이 결국 파일을 손으로 옮기고, 그때는 아무 기록도 안 남는다.
        """

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hankook_two_pass.json"
            path.write_text("기존", encoding="utf-8")

            _write_result(path, {"status": "completed", "새": True}, overwrite=True)

            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                {"status": "completed", "새": True},
            )

    def test_the_cli_exposes_the_flag_the_error_message_names(self) -> None:
        """거절 문구가 `--overwrite` 를 이름으로 부른다 — 그 플래그가 실제로 있어야 한다.

        플래그를 지우거나 이름을 바꾸면 문구가 **없는 탈출구를 안내**하게 된다.
        문구와 파서를 따로 두면 어긋나도 아무도 모르므로 여기서 묶는다.
        """

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "hankook_two_pass.json"
            path.write_text("기존", encoding="utf-8")
            with self.assertRaises(FileExistsError) as caught:
                _write_result(path, {"status": "completed"})

        named = re.findall(r"--[a-z-]+", str(caught.exception))
        self.assertIn("--overwrite", named)

        parsed = _parser().parse_args(["--overwrite"])
        self.assertTrue(parsed.overwrite)
        self.assertFalse(_parser().parse_args([]).overwrite)  # 기본값은 거부다

    def test_console_cost_requires_an_explicit_single_run_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = (
                root
                / "services"
                / "ingest"
                / "benchmarks"
                / "results"
                / "hankook_two_pass_attempt8_success.json"
            )
            path.parent.mkdir(parents=True)
            path.write_text(
                json.dumps({"console_billed_cost_krw": None}), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "누적 Console 금액"):
                record_console_billed_cost(
                    root,
                    path,
                    310.93,
                    confirmed_single_run_charge=False,
                )

            self.assertIsNone(
                json.loads(path.read_text(encoding="utf-8"))["console_billed_cost_krw"]
            )

    def test_console_cost_records_only_an_isolated_single_run_bill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = (
                root
                / "services"
                / "ingest"
                / "benchmarks"
                / "results"
                / "hankook_two_pass_attempt8_success.json"
            )
            path.parent.mkdir(parents=True)
            original = {
                "status": "completed",
                "prompt_sha256": "c7b6effc",
                "console_billed_cost_krw": None,
            }
            path.write_text(json.dumps(original), encoding="utf-8")
            observed = datetime(2026, 8, 25, 11, 30, tzinfo=timezone.utc)

            result = record_console_billed_cost(
                root,
                path,
                310.93,
                confirmed_single_run_charge=True,
                recorded_at=observed,
            )

            self.assertEqual(result["console_billed_cost_krw"], 310.93)
            self.assertEqual(result["status"], original["status"])
            self.assertEqual(result["prompt_sha256"], original["prompt_sha256"])
            self.assertEqual(
                result["console_billing_verification"],
                {
                    "source": "anthropic_console",
                    "scope": "single_run",
                    "recorded_at": "2026-08-25T11:30:00+00:00",
                },
            )
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")), result
            )

            with self.assertRaisesRegex(ValueError, "덮어쓰지 않는다"):
                record_console_billed_cost(
                    root,
                    path,
                    999.0,
                    confirmed_single_run_charge=True,
                )

    def test_console_cost_rejects_invalid_amounts_and_files_outside_results(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            results = root / "services" / "ingest" / "benchmarks" / "results"
            results.mkdir(parents=True)
            path = results / "hankook_two_pass_attempt8_success.json"
            path.write_text(
                json.dumps({"console_billed_cost_krw": None}), encoding="utf-8"
            )

            for amount in (0.0, -1.0, float("nan"), float("inf")):
                with self.subTest(amount=amount), self.assertRaisesRegex(
                    ValueError, "유한한 원화"
                ):
                    record_console_billed_cost(
                        root,
                        path,
                        amount,
                        confirmed_single_run_charge=True,
                    )

            outside = root / "other" / "hankook_two_pass_attempt8_success.json"
            outside.parent.mkdir()
            outside.write_text(
                json.dumps({"console_billed_cost_krw": None}), encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "결과 디렉터리"):
                record_console_billed_cost(
                    root,
                    outside,
                    310.93,
                    confirmed_single_run_charge=True,
                )

    def test_console_cost_cli_flags_are_opt_in(self) -> None:
        parsed = _parser().parse_args(
            [
                "--record-console-billed-cost-krw",
                "310.93",
                "--record-result",
                "benchmarks/results/hankook_two_pass_attempt8_success.json",
                "--confirm-single-run-charge",
            ]
        )

        self.assertEqual(parsed.record_console_billed_cost_krw, 310.93)
        self.assertTrue(parsed.confirm_single_run_charge)
        self.assertIsNotNone(parsed.record_result)
        self.assertIsNone(_parser().parse_args([]).record_console_billed_cost_krw)

    def test_canonical_record_is_still_the_fourth_success(self) -> None:
        """정본이 **여전히 4차 성공인지** 파일끼리 대조한다.

        위 가드는 이 실행기를 통한 덮어쓰기를 막는다. 이 테스트는 경로가 무엇이든
        (수동 복사·다른 도구·되돌린 커밋) 정본이 바뀌면 빨간불이 되게 한다.
        기존 test_frozen_engine_fixture_is_traceable_to_fourth_success 는 픽스처
        안의 문자열끼리만 비교하므로, 정본이 덮여도 계속 통과한다 — 출처 주장이
        조용히 거짓이 되는 구멍이 그 자리다.
        """

        recorded = json.loads(RECORDED_RESULT.read_text(encoding="utf-8"))
        fixture = json.loads(ENGINE_FROZEN_FIXTURE.read_text(encoding="utf-8"))

        self.assertEqual(recorded["status"], "completed")
        self.assertEqual(recorded["prompt_sha256"], fixture["source_prompt_sha256"])
        self.assertEqual(recorded["card"], fixture["card"])

    def test_first_pass_requests_minimal_claim_specific_citations(self) -> None:
        self.assertIn("최소 문장·표 행", PASS1_SYSTEM)
        self.assertIn("여러 규칙을 한 번에 인용하지 말고", PASS1_SYSTEM)

    def test_recorded_fourth_success_revalidates_against_hankook_source(
        self,
    ) -> None:
        result = json.loads(RECORDED_RESULT.read_text(encoding="utf-8"))
        plan = build_dry_run_plan(REPO_ROOT)
        path = REPO_ROOT / "data" / "terms" / HANKOOK_FILENAME
        checks = validate_gate_card(
            REPO_ROOT,
            result["card"],
            parse_document(path),
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["document_sha256_scope"], "submitted_bytes")
        self.assertEqual(
            result["document_lf_sha256"],
            plan["document"]["lf_normalized_sha256"],
        )
        self.assertEqual(
            result["document_lf_sha256"],
            "0220979938c03a24ac0dafb039185f863bef3c2e155cea60a4c2b5ce1e92bc9d",
        )
        self.assertEqual(
            result["prompt_sha256"],
            "70ce01c9743bb8cc16fe2467ec83b493cc476c7d0e72b01635a8b63a5ca8de81",
        )
        self.assertNotEqual(result["prompt_sha256"], plan["prompt_sha256"])
        self.assertEqual(result["approved_max_cost_krw"], 650.0)
        self.assertEqual(result["estimated_max_cost_krw"], 601.01)
        self.assertEqual(result["checks"], checks)
        self.assertTrue(all(checks.values()))
        self.assertEqual(result["card"]["doc_version"], {"review_no": "2026-0265"})
        self.assertEqual(
            result["card"]["disposal_price_rules"][0]["discount_rate"],
            0.15,
        )
        self.assertEqual(
            result["within_60_seconds"],
            result["timing_ms"]["total"] <= 60_000,
        )
        self.assertIsNone(result["console_billed_cost_krw"])
        self.assertTrue(
            all(isinstance(value, int) for value in result["usage"].values())
        )
        current_report = evidence_span_lengths(
            ConditionCard.model_validate(result["card"])
        )
        # 4차 결과의 당시 텔레메트리는 보존하고, 이후 추가된 필드는 현재
        # 계산값에서 별도로 허용한다. 기존 키의 의미가 바뀌지는 않아야 한다.
        for key, value in result["evidence_spans"].items():
            if key == "spans":
                continue
            self.assertEqual(current_report[key], value)
        self.assertEqual(
            len(current_report["spans"]),
            len(result["evidence_spans"]["spans"]),
        )
        for recorded_span, current_span in zip(
            result["evidence_spans"]["spans"],
            current_report["spans"],
            strict=True,
        ):
            for key, value in recorded_span.items():
                self.assertEqual(current_span[key], value)

    def test_frozen_engine_fixture_is_traceable_to_fourth_success(self) -> None:
        fixture = json.loads(ENGINE_FROZEN_FIXTURE.read_text(encoding="utf-8"))
        path = REPO_ROOT / "data" / "terms" / HANKOOK_FILENAME

        self.assertEqual(fixture["fixture_kind"], "frozen-fourth-success")
        self.assertEqual(
            fixture["source_result"],
            "services/ingest/benchmarks/results/hankook_two_pass.json",
        )
        self.assertEqual(
            fixture["source_prompt_sha256"],
            "70ce01c9743bb8cc16fe2467ec83b493cc476c7d0e72b01635a8b63a5ca8de81",
        )
        self.assertEqual(fixture["recorded_status"], "completed")
        checks = validate_gate_card(
            REPO_ROOT,
            fixture["card"],
            parse_document(path),
        )
        self.assertTrue(all(checks.values()))

    def test_sixth_run_native_citations_yield_minimal_role_subspans(self) -> None:
        result = json.loads(ATTEMPT6_RESULT.read_text(encoding="utf-8"))
        path = REPO_ROOT / "data" / "terms" / HANKOOK_FILENAME
        document = parse_document(path)
        text = document.units[0].text
        native_citations = tuple(
            CitationSpan(
                source_format="html",
                char_start=candidate["char_start"],
                char_end=candidate["char_end"],
                flattened_sha256=document.flattened_sha256 or "",
                quote=text[candidate["char_start"] : candidate["char_end"]],
            )
            for candidate in result["citation_candidates"]
        )

        roles = _role_citations(native_citations, text)

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["usage"]["pass2-input-tokens"], 0)
        self.assertEqual(max(len(item.quote) for item in native_citations), 1621)
        # 6차에서 73자로 잘렸던 [1459:1532]는 투자사례다. 역할 후보에서
        # 예시 블록 전체를 제외하고 유일한 조항 140%(@5268)만 남긴다.
        self.assertTrue(
            all(
                not 1281 <= item.char_start < 2500
                for role in roles.values()
                for item in role
            )
        )
        self.assertEqual(
            {_percent_values(item.quote)[0] for item in roles["ratio_rules"]},
            {140.0},
        )
        self.assertTrue(
            all(
                _maintenance_row_values(item.quote) == [140.0]
                for item in roles["execution_schedule"]
            )
        )
        self.assertEqual(
            min(len(item.quote) for item in roles["execution_schedule"]),
            192,
        )
        self.assertEqual(
            {item.char_start for item in roles["execution_schedule"]},
            {5252},
        )
        self.assertTrue(
            all(
                "담보부족발생(D일) + 2일" in item.quote
                for item in roles["execution_schedule"]
            )
        )
        self.assertTrue(
            all(
                item.parent_char_start == 4444
                and item.parent_char_end == 6065
                for item in roles["execution_schedule"]
            )
        )
        self.assertLessEqual(
            max(
                len(item.quote)
                for role in roles.values()
                for item in role
            ),
            192,
        )
        for role in roles.values():
            for item in role:
                self.assertTrue(
                    any(
                        parent.char_start <= item.char_start
                        and item.char_end <= parent.char_end
                        and item.quote
                        == parent.quote[
                            item.char_start - parent.char_start :
                            item.char_end - parent.char_start
                        ]
                        for parent in native_citations
                    )
                )

    def test_dry_run_is_network_free_and_uses_measured_input(self) -> None:
        plan = build_dry_run_plan(REPO_ROOT)

        self.assertEqual(plan["status"], "dry_run")
        self.assertEqual(plan["network_requests"], 0)
        self.assertEqual(plan["document"]["measured_input_tokens"], 42_948)
        self.assertEqual(plan["document"]["sha256_scope"], "submitted_bytes")
        self.assertEqual(
            plan["document"]["lf_normalized_sha256"],
            "0220979938c03a24ac0dafb039185f863bef3c2e155cea60a4c2b5ce1e92bc9d",
        )
        self.assertEqual(plan["cache_control"], "ephemeral_5m")
        self.assertEqual(
            plan["prompt_sha256"],
            "c7b6effc566eabd1fc915be5f860a958d7c1e9add470f7f261553c872e15194e",
        )
        self.assertEqual(plan["estimated_max_cost_krw"], 601.01)
        self.assertEqual(
            plan["approval_pricing_basis"],
            {
                "input_usd_per_mtok": 3.0,
                "output_usd_per_mtok": 15.0,
                "krw_per_usd": 1500.0,
            },
        )

    def test_lf_normalized_sha_is_stable_across_line_endings(self) -> None:
        self.assertEqual(
            lf_normalized_sha256(b"first\r\nsecond\r\n"),
            lf_normalized_sha256(b"first\nsecond\n"),
        )

    def test_budget_guard_rejects_below_estimated_ceiling(self) -> None:
        estimated = estimate_max_cost_krw()

        with self.assertRaisesRegex(ValueError, "승인 한도"):
            require_approved_budget(estimated - 0.01)
        self.assertEqual(require_approved_budget(estimated), estimated)

    def test_usage_cost_report_separates_price_estimates_from_console_bill(
        self,
    ) -> None:
        headers = {
            "x-ingest-pass1-input-tokens": "100",
            "x-ingest-pass1-output-tokens": "200",
            "x-ingest-pass1-cache-write-tokens": "1000",
            "x-ingest-pass1-cache-read-tokens": "500",
            "x-ingest-pass2-input-tokens": "300",
            "x-ingest-pass2-output-tokens": "400",
        }

        report = usage_cost_report(headers)

        self.assertEqual(report["standard_price_usage_estimated_cost_krw"], 21.15)
        self.assertEqual(
            report["introductory_price_usage_estimated_cost_krw"], 14.10
        )
        self.assertEqual(report["introductory_price_ends_on"], "2026-08-31")
        self.assertIsNone(report["console_billed_cost_krw"])

    def test_usage_token_report_serializes_header_values_as_integers(self) -> None:
        report = usage_token_report(
            {
                "x-ingest-pass1-input-tokens": "100",
                "x-ingest-pass1-output-tokens": "200",
                "x-ingest-pass1-cache-write-tokens": "1000",
                "x-ingest-pass1-cache-read-tokens": "500",
                "x-ingest-pass2-input-tokens": "300",
                "x-ingest-pass2-output-tokens": "400",
            }
        )

        self.assertEqual(report["pass1-input-tokens"], 100)
        self.assertEqual(report["pass2-output-tokens"], 400)
        self.assertTrue(all(isinstance(value, int) for value in report.values()))

    def test_evidence_span_report_reads_failure_headers(self) -> None:
        spans = [
            {
                "role": "execution_schedule",
                "index": 0,
                "source_format": "html",
                "char_start": 1474,
                "char_end": 1528,
                "length": 54,
                "percent_values": [],
            }
        ]
        candidates = [
            {
                "citation_id": 3,
                "char_start": 1474,
                "char_end": 1528,
                "length": 54,
                "percent_values": [],
                "eligible_roles": [],
            }
        ]
        report = evidence_span_report(
            {
                "x-ingest-evidence-coordinate-mode": "character",
                "x-ingest-evidence-character-span-count": "3",
                "x-ingest-evidence-non-character-span-count": "0",
                "x-ingest-evidence-unmeasurable-span-count": "0",
                "x-ingest-evidence-max-span": "1621",
                "x-ingest-evidence-min-span": "115",
                "x-ingest-evidence-duplicate-spans": "1",
                "x-ingest-evidence-ambiguous-percent-spans": "1",
                "x-ingest-evidence-all-single-percent": "false",
                "x-ingest-evidence-spans": urlsafe_b64encode(
                    json.dumps(spans, separators=(",", ":")).encode("ascii")
                ).decode("ascii"),
                "x-ingest-citation-candidates": urlsafe_b64encode(
                    json.dumps(candidates, separators=(",", ":")).encode("ascii")
                ).decode("ascii"),
            }
        )
        self.assertEqual(report["citation_candidates"], candidates)

        self.assertEqual(
            report["evidence_spans"],
            {
                "coordinate_mode": "character",
                "character_span_count": 3,
                "non_character_span_count": 0,
                "unmeasurable_span_count": 0,
                "max_length": 1621,
                "min_length": 115,
                "duplicate_spans": 1,
                "ambiguous_percent_spans": 1,
                "all_spans_single_percent_candidate": False,
                "spans": spans,
            },
        )

    def test_gate_validator_accepts_known_hankook_card_shape(self) -> None:
        path = REPO_ROOT / "data" / "terms" / HANKOOK_FILENAME
        parsed = parse_document(path)
        text = parsed.units[0].text

        def evidence(quote: str) -> dict[str, object]:
            start = text.index(quote)
            return {
                "source_format": "html",
                "char_start": start,
                "char_end": start + len(quote),
                "flattened_sha256": parsed.flattened_sha256,
                "quote": quote,
            }

        ratio_quote = "최저담보유지비율 140%"
        discount_quote = "전일종가(8,100원) 대비 15% 하락한 가격(6,890원)"
        execution_start = text.index("담보유지 비율")
        schedule_quote = "임의상환정리(반대매매)\t담보부족발생(D일) + 2일"
        execution_end = text.index(schedule_quote, execution_start) + len(
            schedule_quote
        )
        execution_quote = text[execution_start:execution_end]
        card = {
            "broker": "한국투자증권",
            "ratio_rules": [
                {
                    "product_type": "신용융자",
                    "collateral_type": "주식",
                    "symbol_group": "전체",
                    "ratio": 1.4,
                    "evidence": evidence(ratio_quote),
                }
            ],
            "account_aggregation": "max",
            "disposal_price_rules": [
                {
                    "trigger": "담보부족 미해소",
                    "symbol_group": "전체",
                    "discount_basis": "prev_close_pct",
                    "discount_rate": 0.15,
                    "source_confidence": "explicit",
                    "evidence": evidence(discount_quote),
                }
            ],
            "execution_schedule": [
                {
                    "threshold_ratio": 1.4,
                    "day_counting": "담보부족발생(D일) + 2일",
                    "evidence": evidence(execution_quote),
                }
            ],
            "ratio_source": "clause",
            "doc_version": {"review_no": "2026-0265"},
            "status": "draft",
        }

        checks = validate_gate_card(REPO_ROOT, card, parsed)

        self.assertTrue(all(checks.values()))

    def test_failed_endpoint_response_preserves_usage_and_cost(self) -> None:
        response = httpx.Response(
            422,
            json={"detail": "2패스 응답이 완결되지 않았습니다"},
            headers={
                "x-ingest-parse-ms": "10.0",
                "x-ingest-pass1-ms": "20.0",
                "x-ingest-pass2-ms": "30.0",
                "x-ingest-total-ms": "60.0",
                "x-ingest-pass1-input-tokens": "100",
                "x-ingest-pass1-output-tokens": "200",
                "x-ingest-pass1-cache-write-tokens": "1000",
                "x-ingest-pass1-cache-read-tokens": "500",
                "x-ingest-pass2-input-tokens": "300",
                "x-ingest-pass2-output-tokens": "400",
                "x-ingest-evidence-coordinate-mode": "character",
                "x-ingest-evidence-character-span-count": "3",
                "x-ingest-evidence-non-character-span-count": "0",
                "x-ingest-evidence-unmeasurable-span-count": "0",
                "x-ingest-evidence-max-span": "1621",
                "x-ingest-evidence-min-span": "115",
                "x-ingest-evidence-duplicate-spans": "1",
            },
        )
        from benchmarks import hankook_two_pass

        with patch.object(
            hankook_two_pass,
            "_post_ingest",
            new=AsyncMock(return_value=response),
        ):
            result = hankook_two_pass.run_hankook(
                REPO_ROOT,
                api_key="sk-ant-test",
                approved_max_krw=estimate_max_cost_krw(),
            )

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["http_status"], 422)
        self.assertEqual(
            result["standard_price_usage_estimated_cost_krw"], 21.15
        )
        self.assertEqual(
            result["introductory_price_usage_estimated_cost_krw"], 14.10
        )
        self.assertIsNone(result["console_billed_cost_krw"])
        self.assertEqual(result["timing_ms"]["total"], 60.0)
        self.assertEqual(result["usage"]["pass1-input-tokens"], 100)
        self.assertIsInstance(result["usage"]["pass2-output-tokens"], int)
        self.assertEqual(result["evidence_spans"]["max_length"], 1621)
        self.assertEqual(result["evidence_spans"]["duplicate_spans"], 1)

    def test_completed_result_preserves_role_level_evidence_spans(self) -> None:
        recorded = json.loads(RECORDED_RESULT.read_text(encoding="utf-8"))
        response = httpx.Response(
            200,
            json=recorded["card"],
            headers={
                "x-ingest-parse-ms": "10.0",
                "x-ingest-pass1-ms": "20000.0",
                "x-ingest-pass2-ms": "30000.0",
                "x-ingest-total-ms": "50010.0",
                "x-ingest-pass1-input-tokens": "100",
                "x-ingest-pass1-output-tokens": "200",
                "x-ingest-pass1-cache-write-tokens": "1000",
                "x-ingest-pass1-cache-read-tokens": "500",
                "x-ingest-pass2-input-tokens": "300",
                "x-ingest-pass2-output-tokens": "400",
            },
        )
        from benchmarks import hankook_two_pass

        with patch.object(
            hankook_two_pass,
            "_post_ingest",
            new=AsyncMock(return_value=response),
        ):
            result = hankook_two_pass.run_hankook(
                REPO_ROOT,
                api_key="sk-ant-test",
                approved_max_krw=estimate_max_cost_krw(),
            )

        spans = result["evidence_spans"]["spans"]
        self.assertEqual(
            {span["role"] for span in spans},
            {"ratio_rules", "disposal_price_rules", "execution_schedule"},
        )
        self.assertEqual(result["evidence_spans"]["max_length"], 1621)
        self.assertEqual(result["evidence_spans"]["duplicate_spans"], 1)
        self.assertEqual(result["usage"]["pass1-input-tokens"], 100)
        self.assertIsInstance(result["usage"]["pass2-output-tokens"], int)


if __name__ == "__main__":
    unittest.main()
