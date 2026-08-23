"""화면이 인용하는 **심의필 번호가 우리가 실제로 가진 문서의 것인지** 본다.

2026-08-23, `#66` 리뷰에서 A 가 찾았다::

    apps/landing-proto/src/main.ts:35
      source: "신용거래설명서 심의필 제26-52호 · 교차검증 309주"
    apps/web/lib/marginguard/snapshot.ts:387
      source: "신용거래설명서 심의필 제25-125호 · 교차검증 309주"

둘이 달랐고, **26-52 는 우리가 한 번도 열어 본 적 없는 판본**이다. `data/terms`
에 있는 것은 `메리츠_신용거래설명서_20250421.pdf`(25-125)뿐이고, 26-52 는
`data/terms/README.md` 가 *"현행 26-52호 추가 확보 필요"* 라고 적어 둔 미확보
문서다. 수량 309주 자체는 25-125 에서 나온 맞는 값이었다 — 틀린 것은 **어느
문서에서 나왔는가**이고, 심사자가 대조하려면 그 번호로 원문을 찾는다.

`test_no_false_disclaimers` 는 이걸 못 잡는다. 그쪽은 **금지 문구 목록**이고
이것은 식별자라, 목록에 미리 적어 둘 수가 없다(무엇이 틀릴지 모른다).

그래서 이 검사는 목록을 쓰지 않는다. **우리가 가진 문서를 그 자리에서 파싱해**
번호를 뽑고, 화면이 그 집합 밖의 번호를 말하는지 본다. 새 판본을 확보하면
`data/terms` 에 넣는 것만으로 자동으로 허용된다 — 선언을 따로 갱신할 곳이 없다.

⚠ 범위는 `apps/` 로 한정한다. `data/terms/README.md` 는 26-52 를 **확보 필요
목록으로** 적고 있고 그건 참이다. 막아야 하는 것은 *가진 것처럼 말하는 화면*이다.

⚠ **표지 없는 번호는 안 잡힌다.** `_REVIEW_NO_PATTERN` 은 `심사필|심의필|검토필`
   이 앞에 있어야 번호로 본다. 그래서 `"(제24-0104호 대조)"` 처럼 표지 없이 적으면
   이 파일의 어느 검사도 보지 못한다(#74 리뷰 중 실측으로 확인 — A 가 제안한 뮤테이션
   문자열이 정확히 그 형태였고, 대칭차 수정 **전에도 후에도** 통과했다. 표지를 붙여
   다시 재니 두 검사가 함께 발화했다).

   넓히지 않은 이유는 헛경보다. 표지를 떼면 `제25-125호` 같은 조각이 문서 번호·
   조문 번호와 구별되지 않는다. **화면 문구가 항상 표지를 달고 있다는 것이 전제**이고,
   그 전제가 깨지는 날 이 검사는 조용해진다 — 그때는 규약을 고치는 편이 맞다.
"""

from __future__ import annotations

from pathlib import Path
import re
import subprocess
import unittest

from app.parsing import parse_document
from app.two_pass import _REVIEW_NO_PATTERN


REPO_ROOT = Path(__file__).resolve().parents[3]
TERMS = REPO_ROOT / "data" / "terms"
PARSEABLE = {".pdf", ".htm", ".html"}

# 이 파일 자신이 26-52 를 담고 있다(왜 거짓인지 적으려면 적어야 한다).
EXEMPT = {"services/ingest/tests/test_review_numbers_are_held.py"}

# `data/terms` 에 대응 문서가 없는 화면상의 broker — 사유와 함께 적는다.
UNDOCUMENTED_BROKERS = {
    "하한가형(예시)": "실제 증권사가 아니다. k≤0 전량 폴백을 보이는 합성 카드라 원문이 없다.",
}

_BROKER_MARKER = re.compile(r'broker:\s*"([^"]+)"')
_COMMENT_LINE = re.compile(r"^\s*(//|\*|/\*|\{/\*)")


def _held_by_broker() -> dict[str, set[str]]:
    """`data/terms` 를 실제로 파싱해 만든 {회사 → 번호}. 선언이 아니라 관측이다.

    회사 이름은 파일명 앞부분에서 온다(`메리츠_신용거래설명서_20250421.pdf`).
    """
    owned: dict[str, set[str]] = {}
    for path in sorted(TERMS.iterdir()):
        if path.suffix.lower() not in PARSEABLE:
            continue
        broker = path.name.split("_", 1)[0]
        text = "\n".join(unit.text for unit in parse_document(path).units)
        found = {m.group("review_no") for m in _REVIEW_NO_PATTERN.finditer(text)}
        if found:
            owned.setdefault(broker, set()).update(found)
    return owned


def _held_review_numbers() -> set[str]:
    return {no for numbers in _held_by_broker().values() for no in numbers}


def _app_files() -> list[str]:
    listing = subprocess.run(
        ["git", "-c", "core.quotepath=false", "ls-files", "--cached", "--others",
         "--exclude-standard", "apps"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    return [line for line in listing.splitlines() if line and line not in EXEMPT]


def _cited_review_numbers() -> dict[str, set[str]]:
    """`apps/` 의 파일별로 인용된 번호."""
    cited: dict[str, set[str]] = {}
    for rel in _app_files():
        try:
            text = (REPO_ROOT / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # 바이너리·읽기 불가
        found = {m.group("review_no") for m in _REVIEW_NO_PATTERN.finditer(text)}
        if found:
            cited[rel] = found
    return cited


def _attributed_citations() -> tuple[list[tuple[str, int, str, str]], list[tuple[str, int]]]:
    """번호마다 **바로 앞의 `broker`** 를 소유자로 붙인다.

    카드 리터럴은 `broker` 가 `source`·`review_no` 보다 먼저 온다 — 같은 줄이거나
    (프로토) 몇 줄 위다(`snapshot.ts`). 그래서 "가장 가까운 앞의 broker" 가 소유자다.

    돌려주는 것은 (귀속된 것, 소유자를 못 찾은 것). **귀속 실패를 조용히 넘기지
    않는다** — 못 찾은 자리는 따로 돌려주고, 그것이 주석인지를 별도 검사가 본다.
    화면에 나가는 문자열이 소유자 없이 번호를 말하면 그 자리는 아무도 안 본다.
    """
    attributed: list[tuple[str, int, str, str]] = []
    orphans: list[tuple[str, int]] = []
    for rel in _app_files():
        try:
            lines = (REPO_ROOT / rel).read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, OSError):
            continue
        current: str | None = None
        for lineno, line in enumerate(lines, start=1):
            numbers = [m.group("review_no") for m in _REVIEW_NO_PATTERN.finditer(line)]
            marker = _BROKER_MARKER.search(line)
            # 같은 줄에 broker 와 번호가 함께 있으면(프로토가 그렇다) 그 broker 가 소유자다
            owner = marker.group(1) if marker else current
            for number in numbers:
                if owner is None:
                    orphans.append((rel, lineno))
                else:
                    attributed.append((rel, lineno, owner, number))
            if marker:
                current = marker.group(1)
    return attributed, orphans


class ReviewNumbersAreHeldTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.owned = _held_by_broker()
        cls.held = {no for numbers in cls.owned.values() for no in numbers}
        cls.cited = _cited_review_numbers()
        cls.attributed, cls.orphans = _attributed_citations()

    def test_the_document_corpus_yields_review_numbers(self) -> None:
        """뽑힌 게 없으면 아래 검사가 무엇과도 대조하지 않고 통과한다."""
        self.assertGreaterEqual(
            len(self.held),
            4,
            f"data/terms 에서 뽑은 심의필 번호가 {len(self.held)}건뿐이다: {self.held}. "
            "파싱이 깨졌거나 문서가 사라졌다 — 이 상태로는 아래 검사가 무의미하다.",
        )

    def test_the_screen_cites_at_least_one_review_number(self) -> None:
        """화면이 아무 번호도 안 적으면 이 검사는 빈 집합을 훑는다."""
        self.assertNotEqual(
            self.cited,
            {},
            "apps/ 에서 심의필 번호를 한 건도 못 찾았다. 문구가 바뀌었다면 "
            "정규식(_REVIEW_NO_PATTERN)이 아직 맞는지 확인해야 한다.",
        )

    def test_every_cited_review_number_is_one_we_hold(self) -> None:
        """가진 적 없는 판본을 근거로 적지 않는다."""
        unheld = {
            rel: sorted(numbers - self.held)
            for rel, numbers in self.cited.items()
            if numbers - self.held
        }
        self.assertEqual(
            unheld,
            {},
            f"화면이 우리가 갖지 않은 판본을 근거로 적는다: {unheld}\n"
            f"data/terms 에서 실제로 뽑히는 번호: {sorted(self.held)}\n"
            "판본을 새로 확보했다면 data/terms 에 넣어라 — 그것만으로 통과한다.",
        )

    def test_the_two_apps_agree(self) -> None:
        """같은 회사 카드를 두 앱이 다른 판본으로 적으면 하나는 반드시 틀렸다.

        `apps/web` 과 `apps/landing-proto` 는 같은 스냅숏을 그린다. 2026-08-23 에
        실제로 어긋나 있었고, 어긋난 쪽이 미확보 판본이었다.
        """
        proto = {n for rel, ns in self.cited.items() if "landing-proto" in rel for n in ns}
        web = {n for rel, ns in self.cited.items() if "apps/web" in rel for n in ns}
        if not proto or not web:
            self.skipTest("두 앱 중 한쪽이 심의필 번호를 인용하지 않는다")
        # ⚠ **대칭차다.** `proto - web` 만 보면 `apps/web` 쪽에만 다른 번호가 들어갔을
        #   때 통과한다 — A 가 뮤테이션으로 확인했다(apps/web 메리츠에 24-0104 를
        #   덧붙여도 5 passed). docstring 이 "하나는 반드시 틀렸다"로 대칭을 말하므로
        #   검사도 대칭이어야 한다.
        self.assertEqual(
            proto ^ web,
            set(),
            f"한쪽에만 있는 판본: {sorted(proto ^ web)}. 두 앱은 같은 스냅숏을 그린다.",
        )

    def test_every_cited_number_belongs_to_that_card_broker(self) -> None:
        """번호가 **어느 회사 것인지**까지 본다.

        보유 집합 안에 있기만 하면 통과하던 구멍이다(#74 리뷰, A). 메리츠 카드에
        한투 번호를 붙이면 *"우리가 가진 번호"* 라 통과하는데, 화면은 메리츠 수치의
        출처로 한투 문서를 가리킨다 — **이 PR 이 고친 것과 같은 종류의 거짓**이다.
        한 앱만 바꾸면 위 검사가 우연히 잡지만, 문구는 보통 한쪽에서 다른 쪽으로
        복사되므로 **둘이 같이 틀리는 쪽이 더 흔하다.**

        소유자는 `data/terms` 파일명에서 온다. 화면의 broker 이름이 파일명 앞부분과
        같아야 대조가 되고, 대응 문서가 없는 broker 는 `UNDOCUMENTED_BROKERS` 에
        사유와 함께 적는다.
        """
        wrong: list[str] = []
        for rel, lineno, broker, number in self.attributed:
            if broker in UNDOCUMENTED_BROKERS:
                continue
            owned = self.owned.get(broker)
            if owned is None:
                wrong.append(
                    f"{rel}:{lineno} broker={broker!r} — data/terms 에 그 회사 문서가 없다. "
                    "합성 카드라면 UNDOCUMENTED_BROKERS 에 사유와 함께 적어라."
                )
            elif number not in owned:
                wrong.append(
                    f"{rel}:{lineno} broker={broker!r} 가 {number!r} 을 인용하는데 "
                    f"그 회사 문서에서 나오는 번호는 {sorted(owned)} 다"
                )
        self.assertEqual(
            wrong, [], "화면이 다른 회사 문서를 출처로 가리킨다:\n  " + "\n  ".join(wrong)
        )

    def test_numbers_without_an_owner_only_appear_in_comments(self) -> None:
        """소유자를 못 찾은 번호는 **주석 안에만** 있어야 한다.

        귀속 실패를 조용히 넘기면 위 검사가 훑는 대상이 줄어든다 — 검사가 있다는
        사실이 오히려 해로워지는 자리다.
        """
        outside: list[str] = []
        for rel, lineno in self.orphans:
            line = (REPO_ROOT / rel).read_text(encoding="utf-8").splitlines()[lineno - 1]
            if not _COMMENT_LINE.match(line):
                outside.append(f"{rel}:{lineno}  {line.strip()[:70]}")
        self.assertEqual(
            outside,
            [],
            "소유 회사를 알 수 없는 자리에서 심사필 번호를 말한다:\n  " + "\n  ".join(outside),
        )

    def test_the_undocumented_broker_list_stays_small_and_explained(self) -> None:
        """예외에 사유가 없으면 다음 사람이 아무 회사나 여기 넣는다."""
        for broker, why in UNDOCUMENTED_BROKERS.items():
            with self.subTest(broker=broker):
                self.assertGreater(len(why), 20, f"{broker}: 왜 문서가 없는지 적혀 있지 않다")

    def test_the_exemption_list_only_holds_files_that_exist(self) -> None:
        missing = {rel for rel in EXEMPT if not (REPO_ROOT / rel).exists()}
        self.assertEqual(missing, set(), f"존재하지 않는 면제 경로: {missing}")


if __name__ == "__main__":
    unittest.main()
