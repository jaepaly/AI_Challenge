from pathlib import Path
import unittest

from benchmarks.hankook_two_pass import (
    HANKOOK_FILENAME,
    actual_cost_krw,
    build_dry_run_plan,
    estimate_max_cost_krw,
    require_approved_budget,
    validate_gate_card,
)
from app.parsing import parse_document


REPO_ROOT = Path(__file__).resolve().parents[3]


class HankookTwoPassGateTest(unittest.TestCase):
    def test_dry_run_is_network_free_and_uses_measured_input(self) -> None:
        plan = build_dry_run_plan(REPO_ROOT)

        self.assertEqual(plan["status"], "dry_run")
        self.assertEqual(plan["network_requests"], 0)
        self.assertEqual(plan["document"]["measured_input_tokens"], 42_948)
        self.assertEqual(plan["cache_control"], "ephemeral_5m")
        self.assertGreater(plan["estimated_max_cost_krw"], 400)
        self.assertLess(plan["estimated_max_cost_krw"], 550)

    def test_budget_guard_rejects_below_estimated_ceiling(self) -> None:
        estimated = estimate_max_cost_krw()

        with self.assertRaisesRegex(ValueError, "승인 한도"):
            require_approved_budget(estimated - 0.01)
        self.assertEqual(require_approved_budget(estimated), estimated)

    def test_actual_cost_uses_cache_write_and_read_rates(self) -> None:
        headers = {
            "x-ingest-pass1-input-tokens": "100",
            "x-ingest-pass1-output-tokens": "200",
            "x-ingest-pass1-cache-write-tokens": "1000",
            "x-ingest-pass1-cache-read-tokens": "500",
            "x-ingest-pass2-input-tokens": "300",
            "x-ingest-pass2-output-tokens": "400",
        }

        self.assertEqual(actual_cost_krw(headers), 21.15)

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
            "doc_version": {"review_no": "제2026-0265"},
            "status": "draft",
        }

        checks = validate_gate_card(REPO_ROOT, card, parsed)

        self.assertTrue(all(checks.values()))


if __name__ == "__main__":
    unittest.main()
