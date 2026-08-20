"""스냅숏 카드가 이 저장소 자신의 Pydantic 규칙을 통과하는지 검사한다.

2026-08-18에 이 검사가 없어서 생긴 일이 있다. `apps/web/lib/marginguard/snapshot.ts`의
EVIDENCE 좌표 9개는 PR #46에서 손으로 뽑았고, 그때 확인한 것은 셋이었다 —
좌표 일치(`text[start:end] == quote`), sha 일치, 인용문이 원문에 있음.
**세 검사 모두 통과했는데, 그 카드를 우리 검증기에 넣으면 execution 3장이 전부
거부됐다.** `ExecutionScheduleRule.require_threshold_ratio_in_quote`가
threshold_ratio(1.4)를 인용문과 대조하는데, 세 인용문이 전부 집행 **일정**만
서술하고 140%를 담지 않았기 때문이다:

    한투   "추가담보납부 요구일의 다음 영업일까지 … 임의처분하는 경우"
    메리츠  "(D일)담보유지비율하회사실발생및…→(D+2)반대매매실행"
    유진   "추가납부기한 익일 자동반대매매"

즉 화면은 `threshold_ratio 140%`를 인용문 옆에 나란히 놓고 있었는데, 파이프라인이
그 짝을 무효라고 판정하는 상태였다. `test_snapshot_evidence.py`는 좌표만 보므로
이것을 못 잡았다. **이 파일이 그 구멍이다.**

여기서 검사하는 것은 좌표가 아니라 **카드 값과 인용문의 관계**다. 값은 지어내지
않고 snapshot.ts에서 읽는다 — 정규식으로 TS를 읽는 것은 취약하고, 그게 의도다.
카드 모양이 바뀌면 조용히 통과하지 말고 여기서 깨져야 한다.

깨졌을 때 할 일은 인용 범위를 조항 쪽으로 다시 잡는 것이지 검증기를 낮추는 것이
아니다. 경계 타입 3파일(`app/schemas.py`, `schemas/condition_card.schema.json`,
`packages/engine/src/types.ts`) 변경은 팀 전원 승인 사항이다.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys
import unittest

from pydantic import ValidationError

# 형제 테스트의 EVIDENCE 파서를 재사용한다. 그 정규식이 하나뿐이어야 snapshot.ts의
# 블록 모양이 바뀌었을 때 한 곳에서만 깨진다. 러너에 따라 tests/가 sys.path에
# 들어오기도 하고 아니기도 해서(`unittest discover -s tests` 대 `unittest tests.x`)
# 여기서 명시적으로 넣는다.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_snapshot_evidence import (  # noqa: E402
    ROLES,
    SNAPSHOT_TS,
    SOURCE_FILE,
    _parse_evidence_block,
)

from app import schemas  # noqa: E402


# ── snapshot.ts에서 카드 값을 읽는다 ────────────────────────────────────────
# 좌표만 대조하는 형제 테스트와 달리 여기서는 **값**이 필요하다(ratio 1.4,
# threshold_ratio 1.4, discount_rate 0.15/0.2/없음 …). 손으로 옮겨 적으면 이 파일이
# snapshot.ts와 조용히 갈라져 "통과한다고 말하지만 실제 카드는 다른 값"이 된다.


def _snapshot_source() -> str:
    return SNAPSHOT_TS.read_text(encoding="utf-8")


def _make_card_body(source: str) -> str:
    """`makeCard`가 반환하는 카드 리터럴 — 프리셋 3종이 공유하는 값들이 여기 있다."""
    match = re.search(r"function makeCard\(.*?\n\}\n", source, re.S)
    assert match, "makeCard 함수를 찾지 못했다 — snapshot.ts의 모양이 바뀌었다"
    return match.group(0)


def _text_field(body: str, name: str) -> str:
    match = re.search(rf'(?<![_a-zA-Z]){name}:\s*"([^"]*)"', body)
    assert match, f"makeCard에서 {name}을 찾지 못했다"
    return match.group(1)


def _number_field(body: str, name: str) -> float:
    # `threshold_ratio:`가 `ratio:`로 잡히지 않도록 앞 경계를 막는다.
    match = re.search(rf"(?<![_a-zA-Z]){name}:\s*([\d.]+)", body)
    assert match, f"makeCard에서 {name}을 찾지 못했다"
    return float(match.group(1))


def _presets(source: str) -> list[dict]:
    """CARDS의 `makeCard({ … })` 인자 — 프리셋마다 다른 값들."""
    presets = []
    for args in re.findall(r"makeCard\(\{(.*?)\}\)", source, re.S):
        evidence = re.search(r'evidence:\s*"(\w+)"', args)
        basis = re.search(r'discount_basis:\s*"(\w+)"', args)
        status = re.search(r'status:\s*"(\w+)"', args)
        assert evidence and basis and status, f"프리셋 인자를 파싱하지 못했다: {args!r}"
        rate = re.search(r"discount_rate:\s*([\d.]+)", args)
        review_no = re.search(r'review_no:\s*"([^"]*)"', args)
        doc_sha = re.search(r'doc_sha256:\s*\n?\s*"([0-9a-f]{64})"', args)
        verified_at = re.search(r'verified_at:\s*"([^"]*)"', args)
        presets.append(
            {
                "evidence": evidence.group(1),
                "broker": _text_field(args, "broker"),
                "discount_basis": basis.group(1),
                # 없으면 None이다 — 0으로 채우지 않는다. 유진 카드는 할인율이 없고,
                # 그 사실 자체가 lower_limit 기준가의 의미다.
                "discount_rate": float(rate.group(1)) if rate else None,
                "status": status.group(1),
                "review_no": review_no.group(1) if review_no else None,
                "doc_sha256": doc_sha.group(1) if doc_sha else None,
                "verified_at": verified_at.group(1) if verified_at else None,
            }
        )
    return presets


def _span(evidence: dict, key: str, role: str) -> dict:
    entry = evidence[key]
    span = entry["spans"][role]
    return {
        "source_format": entry["format"],
        "char_start": span["char_start"],
        "char_end": span["char_end"],
        "flattened_sha256": entry["sha"],
        "quote": span["quote"],
    }


def _card_payload(preset: dict, body: str, evidence: dict) -> dict:
    key = preset["evidence"]
    doc_version = (
        {"review_no": preset["review_no"]}
        if preset["review_no"] is not None
        else {"content_sha256": preset["doc_sha256"]}
    )
    return {
        "broker": preset["broker"],
        "ratio_rules": [
            {
                "product_type": _text_field(body, "product_type"),
                "collateral_type": _text_field(body, "collateral_type"),
                "symbol_group": _text_field(body, "symbol_group"),
                "ratio": _number_field(body, "ratio"),
                "evidence": _span(evidence, key, "ratio"),
            }
        ],
        "account_aggregation": _text_field(body, "account_aggregation"),
        "disposal_price_rules": [
            {
                "trigger": _text_field(body, "trigger"),
                "symbol_group": _text_field(body, "symbol_group"),
                "discount_basis": preset["discount_basis"],
                "discount_rate": preset["discount_rate"],
                "source_confidence": _text_field(body, "source_confidence"),
                "evidence": _span(evidence, key, "disposal"),
            }
        ],
        "execution_schedule": [
            {
                "threshold_ratio": _number_field(body, "threshold_ratio"),
                "day_counting": _text_field(body, "day_counting"),
                "evidence": _span(evidence, key, "execution"),
            }
        ],
        "ratio_source": _text_field(body, "ratio_source"),
        "doc_version": doc_version,
        "status": preset["status"],
        "verified_at": preset["verified_at"],
    }


# ── #46이 쓰던 좌표 — 되돌아오면 안 되는 값들 ───────────────────────────────
# 아래 셋은 **실제로 화면에 있었던** execution 인용문이다. 음성 대조군으로 남긴다:
# 이 파일이 정말 무언가를 막고 있는지(단순히 통과만 하는 검사가 아닌지) 확인한다.
REJECTED_EXECUTION_QUOTES_46 = {
    "hantoo": "추가담보납부 요구일의 다음 영업일까지 추가담보를 납입하지 않아 그 다음 영업일에 임의처분하는 경우",
    "meritz": "(D일)담보유지비율하회사실발생및추가담보납부요구→(D+1)추가담보납입기한일이나추가담보미납발생→(D+2)반대매매실행",
    "lower": "추가납부기한 익일 자동반대매매",
}


class SnapshotCardValidatesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        source = _snapshot_source()
        cls.body = _make_card_body(source)
        cls.presets = _presets(source)
        cls.evidence = _parse_evidence_block()

    def test_presets_cover_every_evidence_document(self) -> None:
        """프리셋과 EVIDENCE가 어긋나면 아래 검사가 조용히 반쪽이 된다 — 먼저 확인한다."""
        self.assertEqual(len(self.presets), len(SOURCE_FILE))
        self.assertEqual(
            {preset["evidence"] for preset in self.presets},
            set(SOURCE_FILE),
        )

    def test_every_snapshot_card_passes_pydantic(self) -> None:
        """카드 3장이 RatioRule·DisposalPriceRule·ExecutionScheduleRule을 전부 통과한다.

        #46 시점에는 execution 3장이 여기서 거부됐다. 이 검사가 그때 있었으면
        빨간불이었고, 예시 문장이 조항으로 화면에 오르지 않았다.
        """
        for preset in self.presets:
            with self.subTest(card=preset["evidence"]):
                payload = _card_payload(preset, self.body, self.evidence)
                try:
                    schemas.ConditionCard(**payload)
                except ValidationError as error:
                    self.fail(
                        f"{preset['evidence']} 카드가 Pydantic에서 거부됐다 — "
                        f"인용 범위를 조항 쪽으로 다시 잡아야 한다:\n{error}"
                    )

    def test_execution_quote_carries_the_ratio_the_screen_shows(self) -> None:
        """화면이 인용문 옆에 붙이는 표기가 그 인용문 안에 실제로 있어야 한다.

        `apps/web/app/evidence-panel.tsx`는 execution 행에 threshold_ratio를
        값으로 찍고 바로 아래에 인용문을 놓는다. 나란히 놓는 것 자체가 출처 주장으로
        읽히므로, 표기가 인용문에 없으면 화면이 없는 관계를 주장하게 된다.
        Pydantic이 같은 것을 보지만 여기서 따로 단언해 **왜** 그 규칙이 있는지를 남긴다.
        """
        threshold = _number_field(self.body, "threshold_ratio")
        percent = f"{threshold * 100:g}%"
        for key in SOURCE_FILE:
            with self.subTest(card=key):
                quote = self.evidence[key]["spans"]["execution"]["quote"]
                self.assertIn(
                    percent,
                    quote,
                    f"{key}.execution 인용문에 {percent}가 없다 — 화면이 이 짝을 "
                    f"출처처럼 내보이면 거짓이다",
                )

    def test_the_spans_46_used_are_still_rejected(self) -> None:
        """음성 대조군 — 이 검사에 이빨이 있는지 확인한다.

        #46의 execution 인용문 셋을 그대로 넣으면 지금도 거부되어야 한다. 거부되지
        않는다면 그 사이에 검증기가 느슨해진 것이고, 위 통과 검사는 아무것도
        보증하지 않는 상태가 된다.
        """
        threshold = _number_field(self.body, "threshold_ratio")
        day_counting = _text_field(self.body, "day_counting")
        for key, quote in REJECTED_EXECUTION_QUOTES_46.items():
            with self.subTest(card=key):
                span = _span(self.evidence, key, "execution")
                span["quote"] = quote
                # 좌표는 이 인용문을 설명하지 못하지만 여기서 보는 것은 좌표가 아니다 —
                # 인용문↔수치 대조뿐이다. 폭은 맞춰 두어 다른 이유로 실패하지 않게 한다.
                span["char_end"] = span["char_start"] + len(quote)
                with self.assertRaises(ValidationError):
                    schemas.ExecutionScheduleRule(
                        threshold_ratio=threshold,
                        day_counting=day_counting,
                        evidence=span,
                    )

    def test_lower_limit_disposal_quote_is_not_checked_at_all(self) -> None:
        """유진 카드의 disposal PASS는 "검증됐다"가 아니라 "검증 대상이 아니다"다.

        `require_discount_rate_in_quote`를 유진 값(discount_basis="lower_limit",
        discount_rate=None)으로 따라가면 두 if 가드를 모두 빠져나가 그대로 return한다.
        즉 **인용문 내용 검사가 0회 실행된다** — 아무 문장이나 넣어도 통과한다.

        이 사실을 검사로 박아 두는 이유: 위 `test_every_snapshot_card_passes_pydantic`이
        3장 전부 초록이라고 말하는데, 그중 한 칸은 검사가 돌지 않은 초록이다. 적어
        두지 않으면 다음 사람이 그 초록을 근거 적합성의 보증으로 읽는다. 하한가형
        카드에서 disposal 근거의 적합성을 판단할 수 있는 것은 사람뿐이다.
        """
        lower = next(p for p in self.presets if p["evidence"] == "lower")
        self.assertEqual(lower["discount_basis"], "lower_limit")
        self.assertIsNone(lower["discount_rate"])

        span = _span(self.evidence, "lower", "disposal")
        span["quote"] = "이 문장은 이 문서에 없고 하한가와도 아무 상관이 없다"
        # 무관한 문장인데도 통과한다 — 그게 이 검사가 보여주려는 것이다.
        schemas.DisposalPriceRule(
            trigger=_text_field(self.body, "trigger"),
            symbol_group=_text_field(self.body, "symbol_group"),
            discount_basis="lower_limit",
            discount_rate=None,
            source_confidence=_text_field(self.body, "source_confidence"),
            evidence=span,
        )

        # 대조: prev_close_pct 카드에는 이 구멍이 없다. 같은 장난을 치면 거부된다.
        hantoo = next(p for p in self.presets if p["evidence"] == "hantoo")
        self.assertEqual(hantoo["discount_basis"], "prev_close_pct")
        bad = _span(self.evidence, "hantoo", "disposal")
        bad["quote"] = "이 문장에는 할인율이 없다"
        with self.assertRaises(ValidationError):
            schemas.DisposalPriceRule(
                trigger=_text_field(self.body, "trigger"),
                symbol_group=_text_field(self.body, "symbol_group"),
                discount_basis="prev_close_pct",
                discount_rate=hantoo["discount_rate"],
                source_confidence=_text_field(self.body, "source_confidence"),
                evidence=bad,
            )

    def test_day_counting_is_not_validated_against_the_quote(self) -> None:
        """day_counting은 검증기가 보지 않는다 — 그래서 화면에도 배지를 붙이지 않는다.

        `ExecutionScheduleRule`의 인용문과 대조되는 것은 threshold_ratio뿐이고
        day_counting은 그냥 `str`이라 빈 문자열도 통과한다. 이 비대칭이
        `apps/web/lib/marginguard/evidence-view.ts`의 DAY_COUNTING_WHY 제약(근거 배지
        금지)의 근거다. 검증기가 조용히 바뀌면 그 제약의 이유가 사라지므로 여기서 본다.
        """
        span = _span(self.evidence, "hantoo", "execution")
        rule = schemas.ExecutionScheduleRule(
            threshold_ratio=_number_field(self.body, "threshold_ratio"),
            day_counting="",  # 아무 근거도 없는 값
            evidence=span,
        )
        self.assertEqual(rule.day_counting, "")

        # 그리고 스냅숏이 실제로 쓰는 표기는 인용문에 글자로 없다 — 이 사실이
        # 배지 금지의 실질적 이유다.
        day_counting = _text_field(self.body, "day_counting")
        self.assertNotIn(day_counting, span["quote"])
        for role in ROLES:
            self.assertNotIn(
                "D+2 집행",
                self.evidence["hantoo"]["spans"][role]["quote"],
            )

    def test_numeric_quote_is_existence_not_binding(self) -> None:
        """`_validate_numeric_quote`는 존재 검사다 — 결속 검사가 아니다.

        이 파일의 초록을 "카드 값이 근거로 검증됐다"로 읽으면 실제보다 넓게 읽는
        것이다. 검증기가 보증하는 것은 *"인용문 어딘가에 그 값의 표기가 있다"* 까지고
        *"그 값이 이 조항이 말하는 값이다"* 는 보증하지 않는다.

        한투 execution 인용문(192자)이 그 차이를 그대로 드러낸다 — 담보유지 비율 표
        블록이라 융자 140%·대주 120%·대주전용계좌 105%가 한 스팬에 같이 들어 있다.
        그래서 융자 계좌 카드에 대주 비율을 넣어도 초록이다(A 리뷰, #52).

        인제스트(#47 `e01d4bb`)에는 이 축의 방어가 있다 — `_maintenance_row_values`가
        단일성 검사를 유지비율 **행 안으로** 좁혀 120·105를 후보에서 뺀다. 손으로 뽑은
        이 스냅숏에는 그 관측기가 걸려 있지 않다. 두 경로가 같은 기준을 통과하게
        만드는 것은 별도 과제이고, 여기서는 **지금 무엇이 보증되지 않는지만** 박아 둔다.
        """
        span = _span(self.evidence, "hantoo", "execution")
        card_value = _number_field(self.body, "threshold_ratio")
        self.assertEqual(card_value, 1.4)

        # 같은 인용문에 다른 상품의 비율을 넣어도 통과한다 — 검사가 존재만 보기 때문이다.
        for wrong in (1.2, 1.05):
            with self.subTest(threshold_ratio=wrong):
                self.assertIn(f"{wrong * 100:g}%", span["quote"])
                schemas.ExecutionScheduleRule(
                    threshold_ratio=wrong,
                    day_counting=_text_field(self.body, "day_counting"),
                    evidence=span,
                )

        # 인용문에 표기가 아예 없는 값은 거부된다 — 검사가 죽은 건 아니다.
        with self.assertRaises(ValidationError):
            schemas.ExecutionScheduleRule(
                threshold_ratio=1.5,
                day_counting=_text_field(self.body, "day_counting"),
                evidence=span,
            )


if __name__ == "__main__":
    unittest.main()
