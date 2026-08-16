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
) -> ConditionCard:
    return ConditionCard.model_validate(
        {
            "broker": "테스트",
            "ratio_rules": [
                {
                    "product_type": "신용거래융자",
                    "collateral_type": "주식",
                    "symbol_group": "일반",
                    "ratio": 1.4,
                    "evidence": _evidence(*ratio_span, "담보유지비율 140%"),
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
                    "evidence": _evidence(*disposal_span, "전일종가 대비 15% 하락"),
                }
            ],
            "execution_schedule": [
                {
                    "threshold_ratio": 1.4,
                    "day_counting": "D일 평가 → D+2 집행",
                    "evidence": _evidence(*execution_span, "담보유지비율 140%"),
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

    def test_reveals_the_fourth_run_shape(self) -> None:
        """#47 4차 — ratio·execution이 같은 1,621자 블록이었다."""
        report = evidence_span_lengths(
            _card(
                ratio_span=(4444, 6065),
                disposal_span=(3342, 3457),
                execution_span=(4444, 6065),
            )
        )

        self.assertEqual(report["max_length"], 1621)
        self.assertEqual(report["min_length"], 115)
        # 두 규칙이 같은 좌표를 근거로 든다 — 근거가 구분되지 않는다
        self.assertEqual(report["duplicate_spans"], 1)

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


if __name__ == "__main__":
    unittest.main()
