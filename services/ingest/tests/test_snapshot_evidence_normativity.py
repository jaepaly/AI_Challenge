"""근거 좌표가 약관 조항을 가리키는지, 워크드 예시를 가리키는지 검사한다.

2026-08-18에 실측으로 드러난 일이다. `apps/web/lib/marginguard/snapshot.ts`의
EVIDENCE 좌표 9개는 PR #46에서 손으로 뽑았고, 그때 확인한 것은 셋이었다 —
좌표 일치, sha 일치, 인용문 고유성. **셋 다 통과했다. 그런데 셋 중 무엇도
"이 문장이 규범인가"를 묻지 않았다.** 9개 중 5개가 문서가 스스로 예시라고 선언한
블록 안의 문장이었다:

    한투   ratio     [1405:1472]  "(1) 투자원금 400만원 … 최저담보유지비율 140%"
          execution [1474:1528]  "추가담보납부 요구일의 … 임의처분하는 경우"
          disposal  [1738:1781]  "전일종가(6,150원) 대비 15% 하락한 가격(5,230원)…"
          → 셋 다 "*투자사례 (1), (2)는 … 이해를 돕기 위해 작성한 예시입니다"(@1280) 안
    메리츠  ratio     [2995:3010]  "담보유지비율(140% 가정)"   ← 인용문이 스스로 '가정'이라 말한다
          execution [3039:3101]  "(D일)…→(D+2)반대매매실행"  ← "◉ <예시>"(@2929) 안

그중 한투 ratio·disposal과 메리츠 ratio는 **Pydantic까지 통과했다.** 검증기가 보는
것은 "인용문 안에 140%/15%라는 글자가 있는가"뿐이고, 그 140%가 조항 값인지 예시
계좌의 가정치인지는 어떤 자동 검사도 묻지 않았다. 규범성은 이 저장소에서 자동화된
적이 없는 유일한 축이었다. **이 파일이 그 축이다.**

방법: 문서에서 예시 마커(그 문서가 예시를 여는 데 실제로 쓰는 말)를 찾아 그 지배
범위를 만들고, 모든 근거 스팬이 그 밖에 있는지 본다. 판정은 시작 좌표가 아니라
**겹침**이다 — 조항 문장에서 시작해 예시 표로 흘러 들어가는 스팬도 잡아야 한다.

구간의 끝은 다음 섹션 경계다. 어떤 문서에서는 개행으로 끊을 수 없다 — 한투
[17950,18742)는 평탄화 후 개행이 하나도 없는 7,304자짜리 한 줄 안에 있고, 열거
마커(가./나. → 다.)만이 경계 근거다. 그래서 구간을 "마커 문자열 → 경계 문자열"
쌍으로 적고 둘 다 실행 시점에 원문에서 찾는다. 원문이 개정되면 찾기가 실패해
여기서 깨진다 — 그때 할 일은 마커를 다시 조사하는 것이지 이 표를 지우는 것이 아니다.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_snapshot_evidence import (  # noqa: E402
    ROLES,
    SOURCE_FILE,
    _flattened,
    _parse_evidence_block,
)


# ── 예시 구간 ───────────────────────────────────────────────────────────────
# (여는 마커, 닫는 경계). 구간 = [text.index(마커), 마커 뒤에서 처음 찾은 경계).
# 경계는 전역 유일할 필요가 없다 — 마커 뒤 첫 출현만 쓴다.
EXAMPLE_REGIONS: dict[str, tuple[tuple[str, str], ...]] = {
    "hantoo": (
        # 마커가 지배 대상을 스스로 '(1), (2)'라고 밝힌다. 끝은 다음 □ 섹션 헤딩.
        # #46의 한투 3개가 전부 이 안에 있었다.
        # ⚠ 경계가 «□ 투자위험등급» 이었는데 현행본은 그 불릿이 «▷» 로 바뀌었고,
        #   조판 순서까지 달라져 그 제목이 **예시 본문보다 앞**에 온다(@1493 < 140% @2012).
        #   그대로 두면 구간이 [1365,1493) 로 쪼그라들어 정작 예시 숫자를 안 덮는다 —
        #   «찾았다» 고 통과하면서 지키는 것이 없어지는 쪽이라 더 나쁘다.
        #   두 판본 다 예시 본문 **뒤**에 있는 «유의사항» 을 경계로 쓴다(옛 @2906 · 새 @3043).
        ("*투자사례 (1), (2)는", "유의사항"),
        # '신용이자율' 표 행 안의 괄호 예시. 그 행의 끝(다음 개행)까지가 지배 범위다.
        # 옛 판본에서는 경계가 그 행의 끝(개행)이었다. 현행본은 pdf2htmlEX 산출물이라
        # **개행이 하나도 없어** 행 끝이라는 것이 없다 — 두 판본에 다 있는 다음 행
        # 머리말을 경계로 쓴다.
        ("(예시: 골드등급", "KOSPI200종목"),
        ("④ 신용융자이자 계산사례", "<예시-신용거래대주>"),
        ("<예시-신용거래대주>", "(9) 만기 연장"),
        # ⚠ 이 구간은 개행이 없는 초장문 한 줄 안에 있다. 열거 마커(가./나. → 다.)가
        # 유일한 경계 근거다. 안에 '하한가'가 5번 나오는데 전부 예시 숫자다.
        ("※ 투자사례(가,나)는", "다. 상황에 따라서 투자원금의 전체를 잃은 후"),
        ("④ 유통융자분에 대한 권리 배정 예시", "(7) 대주권리대금 산정 및 징수시기"),
    ),
    "meritz": (
        # 워크드 시나리오 한 덩어리 — 투자원금 400만원 → '140% 가정' → D/D+1/D+2 표.
        # #46의 메리츠 ratio·execution이 이 안에 있었다.
        ("◉ <예시> 투자원금 400만원", "☆ 투자위험등급"),
        # 가중평균 시연. 안의 140% 두 개는 가정값이라 조항 근거로 쓸 수 없다.
        ("<예시> A종목군 100만원", "◉ 담보유지비율 미달 시"),
        ("<예시1> 일반 위탁계좌", "<예시2>"),
        ("<예시2> 신용거래대주 매도 후", " 수수료 등 비용부담 사항"),
        ("[예시 작성례]", "☑ 상환매체"),
        ("<예시> 보유현황(융자수량:", "<참고> 대용가격이"),
        ("<사례1> 주식의 상하한가 폭은", "◉ 담보증권의 가격의 변동"),
        # 용어설명 표의 <예시> 3개가 연속한다. 말미에 '…가정하여 산출함'이 붙는다.
        ("소급법▪", "공매도▪"),
    ),
    "lower": (
        # 이 문서의 예시 마커는 'ex)' 두 개뿐이다.
        ("ex) 다수종목 보유 시 반대매매", "ex) 단일종목 보유 시 반대매매"),
        # ⚠ 후반 '유의사항 : 담보부족발생시 전액상환방식으로…'은 일반 주의문처럼 읽히지만
        # 단일종목 표의 '전액' 열을 설명하는 자리라 예시의 결론일 가능성이 높다.
        # 보수적으로 구간 안에 포함한다 — 넓게 잡는 쪽이 안전한 방향이다.
        ("ex) 단일종목 보유 시 반대매매", "04. 반대매매 순서"),
    ),
}

# 예시를 여는 데 쓰이는 어휘. 위 표가 문서의 예시 블록을 **전부** 덮는지 확인하는 데 쓴다.
EXAMPLE_VOCABULARY = re.compile(r"예시|투자사례|사례\d|가정|ex\)|<참고>")

# 위 어휘에 걸리지만 예시 블록을 여는 것이 아닌 자리. 각 항목은 원문의 문자열이고,
# 그 문자열이 차지하는 구간 안에 든 히트만 면제된다.
VOCABULARY_FALSE_HITS: tuple[str, ...] = (
    # '평가정보'(NICE평가정보 / 신용정보평가정보)가 '가정'을 부분 문자열로 담는다.
    "평가정보",
    # 문서 말미의 마무리 위험고지 — 예시를 여는 것이 아니라 앞 내용을 가리킨다.
    "위에서 예시된 사항이",
    # '참고' 블록이지 예시가 아니다. 위 구간표에서는 메리츠 여섯째 구간의 경계로 쓴다.
    "<참고> 대용가격이",
)

# ── #46이 쓰던 좌표 ─────────────────────────────────────────────────────────
# 음성 대조군. 이 표가 실제로 예시를 잡아내는지(그냥 통과만 하는 검사가 아닌지) 본다.
SPANS_46 = {
    "hantoo": {"ratio": (1405, 1472), "disposal": (1738, 1781), "execution": (1474, 1528)},
    "meritz": {"ratio": (2995, 3010), "disposal": (1598, 1645), "execution": (3039, 3101)},
    "lower": {"ratio": (473, 502), "disposal": (807, 843), "execution": (517, 533)},
}
# #46 좌표 중 예시 구간과 겹치는 것들 — 위 표가 최소한 이만큼은 잡아야 한다.
INSIDE_EXAMPLES_46 = {
    ("hantoo", "ratio"),
    ("hantoo", "disposal"),
    ("hantoo", "execution"),
    ("meritz", "ratio"),
    ("meritz", "execution"),
}


def _find_loose(text: str, needle: str, start: int = 0) -> tuple[int, int]:
    """마커를 **공백 배치에 관대하게** 찾는다. 못 찾으면 (-1, -1).

    ⚠ 왜 완전 일치가 아닌가 — 2026-08-25 개정본은 같은 문장을 `pdf2htmlEX` 로 다시
      조판했고 **공백만 달라진** 마커가 둘 있었다.

          *투자사례 (1), (2)는     ->  * 투자사례 (1), (2)는
          ※ 투자사례(가,나)는       ->  ※ 투자사례(가, 나)는

      완전 일치로 두면 판본이 바뀔 때마다 이 가드가 **조용히 앵커를 잃는다** — 실제로
      그렇게 5건이 한 번에 넘어갔다(#64 G-3). 예시 구간을 못 찾으면 «스팬이 예시
      밖인가» 를 아무도 안 보게 되므로, 여기서는 **띄어쓰기를 무시하고 글자 순서만**
      본다. 마커들이 충분히 특이해서 이 완화로 다른 자리에 걸릴 여지는 없다.
    """

    idx = text.find(needle, start)
    if idx >= 0:
        return idx, idx + len(needle)
    pattern = r"\s*".join(re.escape(ch) for ch in needle if not ch.isspace())
    match = re.compile(pattern).search(text, start)
    return (match.start(), match.end()) if match else (-1, -1)


def _regions(key: str) -> list[tuple[int, int]]:
    """예시 구간을 원문에서 다시 만든다 — 좌표를 적어 두지 않고 매번 찾는다."""
    text, _ = _flattened(SOURCE_FILE[key])
    regions = []
    for marker, boundary in EXAMPLE_REGIONS[key]:
        start, marker_end = _find_loose(text, marker)
        assert start >= 0, f"{key}: 예시 마커를 찾지 못했다 — {marker!r}"
        end, _ = _find_loose(text, boundary, marker_end)
        assert end > start, f"{key}: {marker!r}의 경계 {boundary!r}를 찾지 못했다"
        regions.append((start, end))
    return regions


def _overlaps(span: tuple[int, int], regions: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """겹치는 구간들. 시작 좌표만 보지 않는다 — 조항에서 시작해 예시로 흘러드는 스팬도 잡는다."""
    start, end = span
    return [(a, b) for a, b in regions if start < b and a < end]


class SnapshotEvidenceNormativityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.evidence = _parse_evidence_block()
        cls.regions = {key: _regions(key) for key in SOURCE_FILE}

    def test_example_regions_are_found_and_ordered(self) -> None:
        """구간표가 원문에서 실제로 만들어지는지 먼저 본다 — 실패하면 아래가 헛돈다."""
        for key, regions in self.regions.items():
            with self.subTest(card=key):
                self.assertEqual(len(regions), len(EXAMPLE_REGIONS[key]))
                for start, end in regions:
                    self.assertLess(start, end)

    def test_no_evidence_span_touches_an_example_region(self) -> None:
        """9개 스팬 전부가 예시 구간 **밖**이다. 이것이 이 파일의 본론이다."""
        for key in SOURCE_FILE:
            regions = self.regions[key]
            for role in ROLES:
                span = self.evidence[key]["spans"][role]
                bounds = (span["char_start"], span["char_end"])
                with self.subTest(card=key, role=role):
                    hits = _overlaps(bounds, regions)
                    self.assertEqual(
                        hits,
                        [],
                        f"{key}.{role} [{bounds[0]}:{bounds[1]}]가 예시 구간 {hits}과 "
                        f"겹친다 — 워크드 예시를 조항으로 인용하고 있다. "
                        f"인용문: {span['quote'][:60]!r}",
                    )

    def test_the_spans_46_used_are_caught(self) -> None:
        """음성 대조군 — 구간표에 이빨이 있는지 확인한다.

        #46의 좌표를 이 구간표에 넣으면 5개가 예시로 잡혀야 한다. 잡히지 않는다면
        구간이 좁아진 것이고, 위 본론 검사는 아무것도 보증하지 않는 상태가 된다.
        """
        caught = set()
        for key, spans in SPANS_46.items():
            for role, bounds in spans.items():
                if _overlaps(bounds, self.regions[key]):
                    caught.add((key, role))
        self.assertEqual(caught, INSIDE_EXAMPLES_46)

    def test_example_vocabulary_is_fully_covered_by_the_regions(self) -> None:
        """예시를 여는 어휘가 구간표 밖에 남아 있지 않은지 본다.

        구간표가 손으로 만든 목록이라, 원문이 개정돼 새 예시 블록이 생기면 위 본론
        검사는 그 블록을 모르는 채 초록으로 통과한다. 그래서 어휘 수준에서 한 번 더
        훑는다 — 걸리는 자리는 전부 구간 안이거나 아래 면제 목록에 있어야 한다.

        깨졌을 때 할 일: 그 자리가 정말 예시 블록을 여는지 확인하고, 맞으면
        EXAMPLE_REGIONS에 구간을 추가하고, 아니면 왜 아닌지를 적어
        VOCABULARY_FALSE_HITS에 넣는다. 정규식을 좁혀 조용히 지나가게 하지 말 것.
        """
        for key, filename in SOURCE_FILE.items():
            text, _ = _flattened(filename)
            regions = self.regions[key]
            excused = [
                (m.start(), m.end())
                for literal in VOCABULARY_FALSE_HITS
                for m in re.finditer(re.escape(literal), text)
            ]
            for hit in EXAMPLE_VOCABULARY.finditer(text):
                position = hit.start()
                if any(start <= position < end for start, end in regions):
                    continue
                if any(start <= position < end for start, end in excused):
                    continue
                self.fail(
                    f"{key}: 구간표가 덮지 않는 예시 어휘가 @{position}에 있다 — "
                    f"{hit.group()!r} :: {text[max(0, position - 40):position + 40]!r}"
                )

    def test_quotes_do_not_declare_themselves_as_examples(self) -> None:
        """인용문 자체가 '가정/예시/사례'라고 말하지 않는다.

        구간 판정과 독립적인 두 번째 그물이다. 메리츠 ratio가 쓰던
        "담보유지비율(140% 가정)"은 구간 안이기도 했지만, 구간 경계를 잘못 잡았더라도
        이 검사에는 걸렸다.
        """
        for key in SOURCE_FILE:
            for role in ROLES:
                quote = self.evidence[key]["spans"][role]["quote"]
                with self.subTest(card=key, role=role):
                    for word in ("가정", "예시", "투자사례"):
                        self.assertNotIn(
                            word,
                            quote,
                            f"{key}.{role} 인용문이 스스로 {word!r}이라고 말한다",
                        )


if __name__ == "__main__":
    unittest.main()
