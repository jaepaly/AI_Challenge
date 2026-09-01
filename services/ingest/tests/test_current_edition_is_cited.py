"""«새 근거는 현행본에서만 뜬다» 를 기계로 붙잡는다.

2026-08-25 한국투자 개정으로 `data/terms` 에 **같은 회사 문서가 둘** 생겼다(#64 G-3).
현행본은 카드가 인용하고, 보존본은 4차 유료 실행(2026-08-16)의 좌표가 *"그 문서의 그
자리"* 를 가리켰다는 것을 확인하는 데만 쓴다. 유료 실행이라 다시 만들 수 없어 지울 수도
없다.

⚠ **말로만 있는 규약은 다음 사람이 모른다.** 새 근거를 뜨면서 보존본을 열면 카드가
  «없어진 판본» 을 인용하게 되는데, 좌표도 해시도 그 문서 기준으로 맞아떨어지므로
  **모든 검사가 초록인 채로** 그렇게 된다. 그 조용한 경로를 여기서 막는다.

판본의 정본은 `data/terms/README.md` 의 **판본 열**이다 — 파일을 넣으면서 그 표에
적지 않으면 아래 첫 검사가 먼저 넘어진다.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_snapshot_evidence import SOURCE_FILE  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
TERMS = REPO_ROOT / "data" / "terms"

#: 보존본을 **경로로 여는** 것이 허용된 자리. 전부 «그때 그 문서» 를 재는 코드다.
#: 여기에 파일을 더하려면 왜 옛 판본을 읽어야 하는지가 그 파일 머리말에 있어야 한다.
PRESERVED_READERS = {
    "services/ingest/tests/test_two_pass.py",
    "services/ingest/tests/test_parsing.py",
    "services/ingest/benchmarks/path_comparison.py",
    "services/ingest/benchmarks/hankook_two_pass.py",
}

#: 훑는 대상 — 문서(.md)는 옛 판본을 **이야기할** 수 있어야 하므로 뺀다.
CODE_GLOBS = ("services/ingest/**/*.py", "apps/web/**/*.ts", "apps/web/**/*.tsx")
SKIP_PARTS = {"node_modules", ".next", "__pycache__", ".pytest_cache", "dist",
              ".venv", "venv", "site-packages"}


def _editions() -> dict[str, str]:
    """README 표에서 {파일명: 판본} 을 읽는다. 굵게(`**현행**`)든 아니든 같게 본다."""

    rows: dict[str, str] = {}
    for line in (TERMS / "README.md").read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip().strip("*").strip() for c in line.strip("|").split("|")]
        if len(cells) < 2 or cells[0] in {"파일", ""} or set(cells[0]) <= set("-"):
            continue
        if (TERMS / cells[0]).suffix:
            rows[cells[0]] = cells[1]
    return rows


def _broker(filename: str) -> str:
    return filename.split("_", 1)[0]


def _code_files() -> list[Path]:
    out: list[Path] = []
    for glob in CODE_GLOBS:
        for path in REPO_ROOT.glob(glob):
            if SKIP_PARTS.isdisjoint(path.parts):
                out.append(path)
    return out


class CurrentEditionIsCitedTest(unittest.TestCase):
    def test_every_document_declares_an_edition(self) -> None:
        """표와 디렉터리가 서로를 덮는다 — 판본을 안 적고 파일만 넣는 길을 막는다."""

        declared = set(_editions())
        on_disk = {p.name for p in TERMS.iterdir() if p.is_file() and p.name != "README.md"}
        self.assertEqual(
            declared,
            on_disk,
            "data/terms 와 README 표가 어긋난다. 표에만 있음: "
            f"{sorted(declared - on_disk)} / 파일만 있음: {sorted(on_disk - declared)}",
        )
        self.assertEqual(
            {v for v in _editions().values()},
            {"현행", "보존"} if any(v == "보존" for v in _editions().values()) else {"현행"},
            "판본 열은 «현행» 또는 «보존» 만 쓴다",
        )

    def test_each_broker_has_exactly_one_current_edition(self) -> None:
        """회사마다 현행은 하나다 — 둘이면 어느 것을 인용해야 하는지 아무도 못 정한다."""

        current: dict[str, list[str]] = {}
        for name, edition in _editions().items():
            if edition == "현행":
                current.setdefault(_broker(name), []).append(name)
        for broker, names in current.items():
            with self.subTest(broker):
                self.assertEqual(len(names), 1, f"{broker}: 현행이 {names}")

    def test_card_evidence_reads_only_current_editions(self) -> None:
        """🔴 카드 근거는 현행본에서만 뜬다.

        `SOURCE_FILE` 이 근거가 저장소로 들어오는 유일한 문이다. 여기가 보존본을
        가리키면 카드가 없어진 판본을 인용하는데, **좌표·해시가 그 문서 기준으로
        맞아떨어져 다른 검사는 전부 초록**이다.
        """

        editions = _editions()
        for key, filename in SOURCE_FILE.items():
            with self.subTest(key):
                self.assertIn(filename, editions, f"{filename} 이 README 표에 없다")
                self.assertEqual(
                    editions[filename],
                    "현행",
                    f"{key} 근거가 보존본({filename})을 가리킨다 — 현행본에서 다시 떠라",
                )

    def test_preserved_editions_are_opened_only_where_declared(self) -> None:
        """보존본을 코드로 여는 자리는 허용 목록뿐이다 — 새 소비자가 조용히 생기지 않게."""

        preserved = [n for n, e in _editions().items() if e == "보존"]
        if not preserved:
            self.skipTest("보존본이 없다")

        for path in _code_files():
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel in PRESERVED_READERS:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for name in preserved:
                with self.subTest(f"{rel} -> {name}"):
                    self.assertNotIn(
                        name,
                        text,
                        f"{rel} 이 보존본 {name} 을 연다. 새 근거는 현행본에서 뜨고, "
                        "옛 판본을 읽어야 한다면 그 이유를 머리말에 적고 "
                        "PRESERVED_READERS 에 등록해라.",
                    )

    def test_the_allowlist_has_no_dead_entry(self) -> None:
        """허용 목록이 낡으면 «등록돼 있으니 괜찮다» 가 거짓이 된다."""

        for rel in sorted(PRESERVED_READERS):
            with self.subTest(rel):
                self.assertTrue((REPO_ROOT / rel).exists(), f"{rel} 이 없다")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
