"""근거 스팬 관측치가 실제 실행에서 본 문제를 드러내는지 검사한다.

4중 방어가 전부 통과해도 스팬이 크면 근거가 근거 노릇을 못 한다. PR #47의
4차 성공 실행이 그랬다 — `ratio`와 `execution`이 **같은 1,621자 블록**
(`Ⅱ.상품개요 및 특성 / ■신용거래제도 요약` 표 전체, 28줄·탭 37개)을 근거로
들었고, 그 안에 `105%`·`120%`·`140%`가 함께 들어 있어 `_validate_numeric_quote`가
`ratio` 1.05·1.2·1.4를 **똑같이 통과**시킨다. 낮은 r을 고르면 D가 작아지고
처분 수량이 작아진다 — 낙관 방향이다.

이 텔레메트리는 **막지 않는다.** 상한선을 아직 값으로 정할 수 없기 때문이다
(관측 기준선: 큐레이션 9건 43~67자, 인제스트 `disposal` 115자). 스키마에
상한을 박는 것은 경계 타입이라 전원 승인이 필요하다 — 8/17 이후다.

여기서 검사하는 것은 **관측치가 그 상황을 실제로 드러내는가**다.
"""

from __future__ import annotations

from typing import Any
import unittest

from app.schemas import ConditionCard
from app.two_pass import evidence_span_lengths


def _evidence(char_start: int, char_end: int, quote: str) -> dict[str, Any]:
    return {
        "quote": quote,
        "source_format": "html",
        "char_start": char_start,
        "char_end": char_end,
        "flattened_sha256": "0" * 64,
    }


def _card(
    *,
    ratio_span: tuple[int, int],
    disposal_span: tuple[int, int],
    execution_span: tuple[int, int],
    ratio_quote: str = "담보유지비율 140%",
    disposal_quote: str = "전일종가 대비 15% 하락",
    execution_quote: str = "담보유지비율 140%",
) -> ConditionCard:
    day_counting = "D일 평가 → D+2 집행"
    if day_counting not in execution_quote:
        execution_quote = f"{execution_quote}\n{day_counting}"
    return ConditionCard.model_validate(
        {
            "broker": "테스트",
            "ratio_rules": [
                {
                    "product_type": "신용거래융자",
                    "collateral_type": "주식",
                    "symbol_group": "일반",
                    "ratio": 1.4,
                    "evidence": _evidence(*ratio_span, ratio_quote),
                }
            ],
            "account_aggregation": "max",
            "disposal_price_rules": [
                {
                    "trigger": "담보부족",
                    "symbol_group": "일반",
                    "discount_basis": "prev_close_pct",
                    "discount_rate": 0.15,
                    "source_confidence": "explicit",
                    "evidence": _evidence(*disposal_span, disposal_quote),
                }
            ],
            "execution_schedule": [
                {
                    "threshold_ratio": 1.4,
                    "day_counting": day_counting,
                    "evidence": _evidence(*execution_span, execution_quote),
                }
            ],
            "ratio_source": "clause",
            "doc_version": {"review_no": "2026-0265"},
            "status": "draft",
        }
    )


class EvidenceSpanTelemetryTest(unittest.TestCase):
    def test_reports_length_per_span(self) -> None:
        report = evidence_span_lengths(
            _card(
                ratio_span=(1405, 1472),      # #46 큐레이션 실측: 67자
                disposal_span=(1738, 1781),   # 43자
                execution_span=(1474, 1528),  # 54자
            )
        )

        self.assertEqual([span["length"] for span in report["spans"]], [67, 43, 54])
        self.assertEqual(report["max_length"], 67)
        self.assertEqual(report["min_length"], 43)
        self.assertEqual(report["duplicate_spans"], 0)
        self.assertEqual(report["ambiguous_percent_spans"], 0)
        self.assertTrue(report["all_spans_single_percent_candidate"])
        self.assertEqual(report["ambiguous_bound_percent_spans"], 0)
        self.assertTrue(
            report["all_numeric_bindings_single_percent_candidate"]
        )
        self.assertEqual(
            [span["percent_values"] for span in report["spans"]],
            [[140.0], [15.0], [140.0]],
        )
        self.assertEqual(report["character_span_count"], 3)
        self.assertEqual(report["non_character_span_count"], 0)
        self.assertEqual(report["unmeasurable_span_count"], 0)
        self.assertEqual(report["coordinate_mode"], "character")

    def test_reveals_the_fourth_run_shape(self) -> None:
        """#47 4차 — ratio·execution이 같은 1,621자 블록이었다."""
        report = evidence_span_lengths(
            _card(
                ratio_span=(4444, 6065),
                disposal_span=(3342, 3457),
                execution_span=(4444, 6065),
                ratio_quote="담보유지비율 105%·120%·140%",
                execution_quote="담보유지비율 105%·120%·140%",
            )
        )

        self.assertEqual(report["max_length"], 1621)
        self.assertEqual(report["min_length"], 115)
        # 두 규칙이 같은 좌표를 근거로 든다 — 근거가 구분되지 않는다
        self.assertEqual(report["duplicate_spans"], 1)
        self.assertEqual(report["ambiguous_percent_spans"], 2)
        self.assertFalse(report["all_spans_single_percent_candidate"])
        self.assertEqual(report["ambiguous_bound_percent_spans"], 2)
        self.assertFalse(
            report["all_numeric_bindings_single_percent_candidate"]
        )

    def test_execution_reports_full_span_and_row_bound_percent_separately(self) -> None:
        """조항 연속 구간은 3개 비율을 담아도 threshold는 140% 행에 결속한다."""
        report = evidence_span_lengths(
            _card(
                ratio_span=(5252, 5272),
                disposal_span=(3342, 3457),
                execution_span=(5252, 5444),
                execution_quote=(
                    "담보유지 비율\t융자\t융자금의 140%\n"
                    "대주\t대주 시가상당액의 120%\n"
                    "신용거래대주 전용계좌\t담보평가액의 105%\n"
                    "임의상환정리(반대매매)\t담보부족발생(D일) + 2일"
                ),
            )
        )

        execution = next(
            span
            for span in report["spans"]
            if span["role"] == "execution_schedule"
        )
        self.assertEqual(execution["percent_values"], [105.0, 120.0, 140.0])
        self.assertEqual(execution["bound_percent_values"], [140.0])
        self.assertEqual(report["ambiguous_percent_spans"], 1)
        self.assertEqual(report["ambiguous_bound_percent_spans"], 0)
        self.assertTrue(
            report["all_numeric_bindings_single_percent_candidate"]
        )

    def test_span_roles_are_labelled(self) -> None:
        """어느 규칙의 근거가 큰지 보이지 않으면 관측치가 쓸모없다."""
        report = evidence_span_lengths(
            _card(
                ratio_span=(4444, 6065),
                disposal_span=(3342, 3457),
                execution_span=(4444, 6065),
            )
        )

        by_role = {span["role"]: span["length"] for span in report["spans"]}
        self.assertEqual(by_role["ratio_rules"], 1621)
        self.assertEqual(by_role["disposal_price_rules"], 115)
        self.assertEqual(by_role["execution_schedule"], 1621)

    def test_reads_spans_before_schema_validation_fails(self) -> None:
        """유료 2패스 출력이 422여도 좌표 관측치는 보존한다."""

        raw = _card(
            ratio_span=(4444, 6065),
            disposal_span=(3342, 3457),
            execution_span=(4444, 6065),
        ).model_dump(mode="json")
        raw["ratio_rules"][0]["ratio"] = 0.88

        report = evidence_span_lengths(raw)

        self.assertEqual(report["max_length"], 1621)
        self.assertEqual(report["duplicate_spans"], 1)
        self.assertEqual(report["character_span_count"], 3)

    def test_page_spans_are_not_reported_as_zero_length_character_spans(self) -> None:
        """페이지 좌표의 0/0/0을 '짧고 좋은 근거'로 오해하지 않는다."""

        raw = _card(
            ratio_span=(1405, 1472),
            disposal_span=(1738, 1781),
            execution_span=(1474, 1528),
        ).model_dump(mode="json")
        for role in (
            "ratio_rules",
            "disposal_price_rules",
            "execution_schedule",
        ):
            for rule in raw[role]:
                rule["evidence"] = {
                    "source_format": "pdf",
                    "page": 1,
                    "quote": rule["evidence"]["quote"],
                }

        report = evidence_span_lengths(raw)

        self.assertEqual(report["character_span_count"], 0)
        self.assertEqual(report["non_character_span_count"], 3)
        self.assertEqual(report["coordinate_mode"], "page")
        self.assertEqual(report["spans"], [])


if __name__ == "__main__":
    unittest.main()
