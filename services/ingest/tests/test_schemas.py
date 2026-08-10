import copy
import json
from pathlib import Path
import unittest

from jsonschema import Draft7Validator
from pydantic import ValidationError

from app.schemas import ConditionCard


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "schemas/condition_card.schema.json"


def page_evidence() -> dict[str, object]:
    return {"source_format": "pdf", "page": 1, "end_page": 2, "quote": "담보유지비율 140%"}


def character_evidence(source_format: str = "html") -> dict[str, object]:
    return {
        "source_format": source_format,
        "char_start": 10,
        "char_end": 21,
        "quote": "담보유지비율 140%",
    }


def make_card(evidence: dict[str, object]) -> dict[str, object]:
    return {
        "broker": "테스트증권",
        "ratio_rules": [
            {
                "product_type": "신용융자",
                "collateral_type": "주식",
                "symbol_group": "일반",
                "ratio": 1.4,
                "evidence": copy.deepcopy(evidence),
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
                "evidence": copy.deepcopy(evidence),
            }
        ],
        "execution_schedule": [
            {
                "threshold_ratio": 1.4,
                "day_counting": "D+2",
                "evidence": copy.deepcopy(evidence),
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

    def test_page_coordinate_card_is_valid(self) -> None:
        self.assert_contract_accepts(make_card(page_evidence()))

    def test_character_coordinate_card_is_valid_for_text_and_html(self) -> None:
        self.assert_contract_accepts(make_card(character_evidence("html")))
        self.assert_contract_accepts(make_card(character_evidence("text")))

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


if __name__ == "__main__":
    unittest.main()
