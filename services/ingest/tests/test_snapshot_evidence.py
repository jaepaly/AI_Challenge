"""스냅숏 카드의 근거 좌표가 실제 원문을 가리키는지 검사한다.

`apps/web/lib/marginguard/snapshot.ts`의 EVIDENCE 블록은 손으로 적은 값이
아니라 `data/terms`의 원문을 평탄화해 뽑은 실측이다. 그 주장을 여기서
다시 검증한다 — 평탄화 결과물의 [char_start:char_end]가 인용문과 글자 단위로
같고, flattened_sha256이 그 평탄화 결과물의 해시인지.

이 검사가 없으면 좌표는 "적어두면 그만인 숫자"가 된다. 4중 방어 ①이
막으려는 것이 정확히 그것이다 — 근거가 있다고 말하면서 확인되지 않는 상태.

원문이 바뀌거나(개정) 평탄화 규칙이 바뀌면 이 테스트가 깨진다. 그때 해야 할
일은 좌표를 다시 뽑는 것이지 테스트를 낮추는 것이 아니다.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
import unittest

from app.parsing import parse_document


REPO_ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_TS = REPO_ROOT / "apps" / "web" / "lib" / "marginguard" / "snapshot.ts"
TERMS = REPO_ROOT / "data" / "terms"

# EVIDENCE 키 → 원문 파일. TS 쪽에 파일명이 없어 여기서 잇는다.
SOURCE_FILE = {
    "hantoo": "한국투자_신용거래설명서_20260707.htm",
    "meritz": "메리츠_신용거래설명서_20250421.pdf",
    "lower": "유진_반대매매안내_수집20260805.html",
}
ROLES = ("ratio", "disposal", "execution")


def _flattened(filename: str) -> tuple[str, str]:
    """평탄화 텍스트와 그 sha256 — snapshot.ts가 좌표를 잡은 것과 같은 문자열."""
    document = parse_document(TERMS / filename)
    text = "\n".join(unit.text for unit in document.units)
    return text, document.flattened_sha256 or ""


def _parse_evidence_block() -> dict[str, dict]:
    """snapshot.ts의 EVIDENCE 리터럴에서 sha·인용문·좌표를 읽는다.

    TS를 정규식으로 읽는 것은 취약하다 — 그게 의도다. 블록 모양이 바뀌면
    조용히 통과하지 말고 여기서 깨져야 한다.
    """
    source = SNAPSHOT_TS.read_text(encoding="utf-8")
    start = source.index("const EVIDENCE = {")
    end = source.index("} as const;", start)
    block = source[start:end]

    parsed: dict[str, dict] = {}
    for key in SOURCE_FILE:
        segment = re.search(rf"\n  {key}: \{{(.+?)\n  \}},", block, re.S)
        assert segment, f"EVIDENCE.{key} 블록을 찾지 못했다"
        body = segment.group(1)
        sha = re.search(r'sha:\s*"([0-9a-f]{64})"', body)
        assert sha, f"{key}: sha를 찾지 못했다"
        entry: dict = {"sha": sha.group(1), "spans": {}}
        for role in ROLES:
            span = re.search(
                rf'{role}:\s*\{{\s*(?://[^\n]*\n\s*)*'
                rf'quote:\s*\n?\s*("(?:[^"\\]|\\.)*")\s*,\s*'
                rf"char_start:\s*(\d+),\s*char_end:\s*(\d+)",
                body,
                re.S,
            )
            assert span, f"{key}.{role} 스팬을 파싱하지 못했다"
            entry["spans"][role] = {
                # TS 문자열 리터럴 = JSON 문자열 리터럴 (이스케이프 규칙 동일)
                "quote": json.loads(span.group(1)),
                "char_start": int(span.group(2)),
                "char_end": int(span.group(3)),
            }
        parsed[key] = entry
    return parsed


class SnapshotEvidenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.evidence = _parse_evidence_block()

    def test_every_card_has_three_spans(self) -> None:
        self.assertEqual(set(self.evidence), set(SOURCE_FILE))
        for key, entry in self.evidence.items():
            self.assertEqual(set(entry["spans"]), set(ROLES), f"{key}의 스팬이 3개가 아니다")

    def test_flattened_sha256_matches_the_source_document(self) -> None:
        for key, filename in SOURCE_FILE.items():
            _, sha = _flattened(filename)
            self.assertEqual(
                self.evidence[key]["sha"],
                sha,
                f"{key}: 기록된 flattened_sha256이 {filename}의 평탄화 해시와 다르다",
            )

    def test_coordinates_point_at_the_quoted_text(self) -> None:
        """좌표가 정본이다 — 인용문이 두 번 나와도 이 검사는 성립해야 한다."""
        for key, filename in SOURCE_FILE.items():
            text, _ = _flattened(filename)
            for role, span in self.evidence[key]["spans"].items():
                with self.subTest(card=key, role=role):
                    self.assertEqual(
                        text[span["char_start"] : span["char_end"]],
                        span["quote"],
                        f"{key}.{role}: [{span['char_start']}:{span['char_end']}]가 인용문과 다르다",
                    )

    def test_quotes_exist_in_the_source_document(self) -> None:
        """좌표와 별개로 인용문 자체가 원문에 있어야 한다 — 지어낸 문구 차단."""
        for key, filename in SOURCE_FILE.items():
            text, _ = _flattened(filename)
            for role, span in self.evidence[key]["spans"].items():
                with self.subTest(card=key, role=role):
                    self.assertIn(span["quote"], text)


if __name__ == "__main__":
    unittest.main()
