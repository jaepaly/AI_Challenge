import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from benchmarks.hankook_two_pass import (
    HANKOOK_FILENAME,
    build_dry_run_plan,
    evidence_span_report,
    estimate_max_cost_krw,
    lf_normalized_sha256,
    require_approved_budget,
    usage_cost_report,
    validate_gate_card,
)
from app.parsing import parse_document


REPO_ROOT = Path(__file__).resolve().parents[3]
RECORDED_RESULT = (
    REPO_ROOT
    / "services"
    / "ingest"
    / "benchmarks"
    / "results"
    / "hankook_two_pass.json"
)


class HankookTwoPassGateTest(unittest.TestCase):
    def test_recorded_first_success_revalidates_against_hankook_source(
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
        self.assertEqual(result["prompt_sha256"], plan["prompt_sha256"])
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
        self.assertFalse(result["within_60_seconds"])
        self.assertIsNone(result["console_billed_cost_krw"])

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
        self.assertGreater(plan["estimated_max_cost_krw"], 550)
        self.assertLess(plan["estimated_max_cost_krw"], 650)
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

    def test_evidence_span_report_reads_failure_headers(self) -> None:
        report = evidence_span_report(
            {
                "x-ingest-evidence-coordinate-mode": "character",
                "x-ingest-evidence-character-span-count": "3",
                "x-ingest-evidence-non-character-span-count": "0",
                "x-ingest-evidence-unmeasurable-span-count": "0",
                "x-ingest-evidence-max-span": "1621",
                "x-ingest-evidence-min-span": "115",
                "x-ingest-evidence-duplicate-spans": "1",
            }
        )

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
                    "day_counting": "추가담보 납부기한 경과 후",
                    "evidence": evidence(ratio_quote),
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


if __name__ == "__main__":
    unittest.main()
