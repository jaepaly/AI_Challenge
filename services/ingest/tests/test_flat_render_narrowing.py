"""구분자 없는 렌더에서 무엇이 달라지는가 — 두 판본을 나란히 두고 고정한다.

2026-08-25 한국투자 개정본은 같은 문장을 `pdf2htmlEX` 로 다시 조판했다. 글자는
같은데 **탭 228개·개행 246개가 전부 공백이 됐다**(#64 G-3). 그때 "우리 4중 방어가
없어진 형식으로만 검증된 것 아니냐"는 물음이 남았고, 이 파일이 그 물음에 답을
**둘로 갈라** 고정한다.

    ① 검증기(4중 방어)는 구분자를 안 본다      -> 옛/새 판정이 같다
    ② 좁히기(_native_backed_subspans)는 본다   -> 새 렌더에서 최소 스팬이 안 나온다

②가 이 파일이 존재하는 이유다. **없어진 것이 아니라 조용히 안 나오는 것**이라,
고정해 두지 않으면 다음 사람이 "왜 이 문서만 인용문이 넓지" 를 처음부터 판다.

⚠ 여기서 재는 것은 **성질이지 판본이 아니다.** 실제 문서를 읽지 않고 같은 문장을
  두 형태로 만들어 쓴다 — 판본이 또 바뀌어도 이 검사는 안 낡는다.
"""

from __future__ import annotations

from pathlib import Path
import hashlib
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import (  # noqa: E402
    _contains_percent,
    _has_disposal_context,
    _normalized_quote,
)
from app.two_pass import (  # noqa: E402
    CitationSpan,
    _credit_product_kind,
    _native_backed_subspans,
)

#: '주요내용 요약' 표의 담보유지비율 블록 — 보존본(_20260707)의 형태 그대로다.
TABBED = (
    "담보유지 비율\t융자\t융자금의 140%\n"
    "대주\t대주 시가상당액의 120%\n"
    "신용거래대주 전용계좌\t신용거래대주 전용계좌 담보평가액의 105% "
    "(담보증권의 유형별로 일정수준의 할인평가적용)\n"
    "상환방법\t상환기일 전이라도 전부 또는 일부 상환 가능 "
    "(매매에 의한 상환 시에는 당해 매매거래의 결제일에 상환)\n"
    "임의상환정리(반대매매)\t담보부족발생(D일) + 2일"
)

#: 같은 블록의 현행본(_20260825) 형태. **글자는 같고 구분자만 공백이다.**
FLAT = TABBED.replace("\t", " ").replace("\n", " ")


def _span(quote: str) -> CitationSpan:
    return CitationSpan(
        source_format="html",
        char_start=0,
        char_end=len(quote),
        flattened_sha256=hashlib.sha256(quote.encode("utf-8")).hexdigest(),
        quote=quote,
    )


class FlatRenderNarrowingTest(unittest.TestCase):
    def test_the_two_forms_differ_only_in_separators(self) -> None:
        """전제 확인 — 글자가 달라졌으면 아래 비교가 형식 얘기가 아니게 된다."""

        self.assertEqual(TABBED.split(), FLAT.split())
        self.assertEqual((TABBED.count("\t"), TABBED.count("\n")), (6, 4))
        self.assertEqual((FLAT.count("\t"), FLAT.count("\n")), (0, 0))

    def test_the_validators_do_not_read_separators(self) -> None:
        r"""4중 방어는 구분자에 무관하다 — 그래서 판본이 바뀌어도 판정이 안 흔들린다.

        `_contains_percent` 는 `\s*%` 로 공백을 흡수하고, 문맥 판정은 어휘 포함
        여부이며, 상품 결속은 `"융자" in text` 다. 어느 것도 행을 세지 않는다.
        """

        for label, probe in (
            ("140% 표기", lambda q: _contains_percent(_normalized_quote(q), "140")),
            ("처분 문맥", _has_disposal_context),
            ("상품 결속", _credit_product_kind),
        ):
            with self.subTest(label):
                self.assertEqual(probe(TABBED), probe(FLAT))

    def test_narrowing_needs_line_breaks_and_says_nothing_without_them(self) -> None:
        """🔴 좁히기는 **행**으로 최소 스팬을 만든다 — 행이 없으면 안 만든다.

        `_native_backed_subspans` 는 행마다 «퍼센트가 정확히 하나» 인지를 보고 최소
        인용 후보를 만든다. 구분자가 전부 공백이면 이 블록이 **한 줄**이라 140·120·105
        셋이 같은 줄에 있고, 그 조건이 영영 안 맞는다.

        결과는 오류가 아니라 **침묵**이다: 넓은 인용문 하나만 남는다. 화면에서는
        `otherFigures` 문단(«인용문에 120%·105%도 함께 있다»)으로 드러나고, 그것이
        지금 한투 카드가 좁은 근거 대신 192자를 인용하는 이유다.
        """

        tabbed = _native_backed_subspans(_span(TABBED))
        flat = _native_backed_subspans(_span(FLAT))

        # 탭·개행이 있으면 담보유지비율 행만 뽑은 최소 스팬이 함께 나온다.
        self.assertEqual(len(tabbed), 2)
        self.assertEqual(tabbed[1].quote, "담보유지 비율\t융자\t융자금의 140%")

        # 없으면 부모 인용문 하나뿐이다 — 좁혀지지 않는다.
        self.assertEqual(len(flat), 1)
        self.assertEqual(flat[0].quote, FLAT)

    def test_a_single_row_still_narrows_when_a_line_break_exists(self) -> None:
        """행이 하나만 있어도 좁혀진다 — 못 좁히는 원인이 «길이» 가 아니라 «행» 임을 가른다.

        이 단언이 없으면 위 검사가 "긴 인용문은 못 좁힌다" 로도 읽힌다.
        """

        one_row = "담보유지 비율 융자 융자금의 140%\n대주 대주 시가상당액의 120%"
        subs = _native_backed_subspans(_span(one_row))
        self.assertEqual(len(subs), 2)
        self.assertEqual(subs[1].quote, "담보유지 비율 융자 융자금의 140%")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
