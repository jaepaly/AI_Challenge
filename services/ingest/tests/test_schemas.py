import copy
import json
from pathlib import Path
import unittest

from jsonschema import Draft7Validator
from pydantic import ValidationError

from app.schemas import ConditionCard


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "schemas/condition_card.schema.json"
FLATTENED_SHA256 = "a" * 64


def page_evidence(quote: str = "담보유지비율 140%") -> dict[str, object]:
    return {"source_format": "pdf", "page": 1, "end_page": 2, "quote": quote}


def character_evidence(
    source_format: str = "html",
    quote: str = "담보유지비율 140%",
    flattened_sha256: str = FLATTENED_SHA256,
) -> dict[str, object]:
    return {
        "source_format": source_format,
        "char_start": 10,
        "char_end": 21,
        "flattened_sha256": flattened_sha256,
        "quote": quote,
    }


def evidence_with_quote(evidence: dict[str, object], quote: str) -> dict[str, object]:
    updated = copy.deepcopy(evidence)
    updated["quote"] = quote
    return updated


def make_card(evidence: dict[str, object]) -> dict[str, object]:
    return {
        "broker": "테스트증권",
        "ratio_rules": [
            {
                "product_type": "신용융자",
                "collateral_type": "주식",
                "symbol_group": "일반",
                "ratio": 1.4,
                "evidence": evidence_with_quote(evidence, "담보유지비율 140%"),
            }
        ],
        "account_aggregation": "max",
        "disposal_price_rules": [
            {
                "trigger": "담보부족 미해소",
                "symbol_group": "일반",
                "discount_basis": "prev_close_pct",
                "discount_rate": 0.15,
                "source_confidence": "explicit",
                "evidence": evidence_with_quote(evidence, "전일종가 대비 15% 할인"),
            }
        ],
        "execution_schedule": [
            {
                "threshold_ratio": 1.4,
                "day_counting": "D+2",
                "evidence": evidence_with_quote(evidence, "담보비율 140% 미만"),
            }
        ],
        "ratio_source": "clause",
        "doc_version": {"review_no": "제2026-0001호"},
        "status": "draft",
    }


class EvidenceSpanContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft7Validator.check_schema(cls.schema)
        cls.validator = Draft7Validator(cls.schema)

    def assert_contract_accepts(self, card: dict[str, object]) -> None:
        self.assertEqual(list(self.validator.iter_errors(card)), [])
        ConditionCard.model_validate(card)

    def assert_contract_rejects(self, card: dict[str, object]) -> None:
        self.assertNotEqual(list(self.validator.iter_errors(card)), [])
        with self.assertRaises(ValidationError):
            ConditionCard.model_validate(card)

    def assert_pydantic_rejects(self, card: dict[str, object]) -> None:
        with self.assertRaises(ValidationError):
            ConditionCard.model_validate(card)

    def test_page_coordinate_card_is_valid(self) -> None:
        self.assert_contract_accepts(make_card(page_evidence()))

    def test_character_coordinate_card_is_valid_for_text_and_html(self) -> None:
        self.assert_contract_accepts(make_card(character_evidence("html")))
        self.assert_contract_accepts(make_card(character_evidence("text")))

    def test_character_coordinates_require_flattened_sha256(self) -> None:
        missing_hash = character_evidence()
        del missing_hash["flattened_sha256"]
        malformed_hash = character_evidence(flattened_sha256="ABC123")

        self.assert_contract_rejects(make_card(missing_hash))
        self.assert_contract_rejects(make_card(malformed_hash))

    def test_character_card_requires_one_flattened_text_hash(self) -> None:
        card = make_card(character_evidence())
        card["disposal_price_rules"][0]["evidence"]["flattened_sha256"] = "b" * 64

        self.assertEqual(list(self.validator.iter_errors(card)), [])
        self.assert_pydantic_rejects(card)

    def test_evidence_requires_exactly_one_coordinate_shape(self) -> None:
        missing_coordinates = make_card(
            {"source_format": "html", "quote": "담보유지비율 140%"}
        )
        mixed_coordinates = make_card(page_evidence())
        mixed_coordinates["ratio_rules"][0]["evidence"]["char_start"] = 0
        mixed_coordinates["ratio_rules"][0]["evidence"]["char_end"] = 3

        self.assert_contract_rejects(missing_coordinates)
        self.assert_contract_rejects(mixed_coordinates)

    def test_card_rejects_mixed_page_and_character_coordinates(self) -> None:
        mixed_card = make_card(page_evidence())
        mixed_card["disposal_price_rules"][0]["evidence"] = character_evidence()

        self.assert_contract_rejects(mixed_card)

    def test_numeric_quotes_accept_percent_decimal_and_fullwidth_notation(self) -> None:
        card = make_card(page_evidence())
        card["ratio_rules"][0]["evidence"]["quote"] = "담보유지비율 １４０％"
        card["execution_schedule"][0]["evidence"]["quote"] = "임계 담보비율 1.40 미만"

        self.assert_contract_accepts(card)

    def test_discount_quote_accepts_samsung_complement(self) -> None:
        cases = [
            (0.15, "반대매매 기준가격: S, A는 85%"),
            (0.20, "반대매매 기준가격: B등급 이하는 80%"),
            (0.15, "전일종가의 100분의 15 할인"),
            (0.15, "할인율 0.150 적용"),
        ]
        for discount_rate, quote in cases:
            with self.subTest(discount_rate=discount_rate, quote=quote):
                card = make_card(page_evidence())
                card["disposal_price_rules"][0]["discount_rate"] = discount_rate
                card["disposal_price_rules"][0]["evidence"]["quote"] = quote
                self.assert_contract_accepts(card)

    def test_numeric_quotes_reject_wrong_or_embedded_numbers(self) -> None:
        invalid_quotes = ["150%", "2015년", "제15조", "1,500주"]
        for quote in invalid_quotes:
            with self.subTest(quote=quote):
                card = make_card(page_evidence())
                card["disposal_price_rules"][0]["evidence"]["quote"] = quote
                self.assert_pydantic_rejects(card)

        ratio_card = make_card(page_evidence())
        ratio_card["ratio_rules"][0]["evidence"]["quote"] = "1400주"
        self.assert_pydantic_rejects(ratio_card)


if __name__ == "__main__":
    unittest.main()
