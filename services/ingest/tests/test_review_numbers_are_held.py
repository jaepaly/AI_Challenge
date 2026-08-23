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
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

from app.parsing import parse_document
from app.two_pass import _REVIEW_NO_PATTERN


REPO_ROOT = Path(__file__).resolve().parents[3]
TERMS = REPO_ROOT / "data" / "terms"
PARSEABLE = {".pdf", ".htm", ".html"}

# 이 파일 자신이 26-52 를 담고 있다(왜 거짓인지 적으려면 적어야 한다).
EXEMPT = {"services/ingest/tests/test_review_numbers_are_held.py"}


def _held_review_numbers() -> set[str]:
    """`data/terms` 의 문서를 실제로 파싱해 뽑은 번호. 선언이 아니라 관측이다."""
    held: set[str] = set()
    for path in sorted(TERMS.iterdir()):
        if path.suffix.lower() not in PARSEABLE:
            continue
        text = "\n".join(unit.text for unit in parse_document(path).units)
        held |= {m.group("review_no") for m in _REVIEW_NO_PATTERN.finditer(text)}
    return held


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


class ReviewNumbersAreHeldTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.held = _held_review_numbers()
        cls.cited = _cited_review_numbers()

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
        self.assertEqual(
            proto - web,
            set(),
            f"프로토만 말하는 판본: {sorted(proto - web)}. 두 앱은 같은 스냅숏을 그린다.",
        )

    def test_the_exemption_list_only_holds_files_that_exist(self) -> None:
        missing = {rel for rel in EXEMPT if not (REPO_ROOT / rel).exists()}
        self.assertEqual(missing, set(), f"존재하지 않는 면제 경로: {missing}")


if __name__ == "__main__":
    unittest.main()
