"""작업트리의 약관 원문 바이트가 저장소 정본과 같은지 검사한다.

`.gitattributes`의 `-text`는 **앞으로의 변환만** 막는다. 그 줄이 들어오기(#27,
8/11) 전에 뜬 작업트리는 `core.autocrlf=true`가 넣은 CRLF를 그대로 갖고 있고,
**git은 그걸 알려주지 않는다** — blob이 바뀌지 않았으니 checkout이 그 파일을
건드리지 않고, 인덱스의 stat 정보도 그대로라 `status`·`diff`가 내용 비교를
아예 하지 않는다. 실측(#49 리뷰, A):

    git status --porcelain -- data/terms   →  []            (깨끗하다고 말한다)
    git hash-object <파일>                  →  47245a0d…
    git rev-parse HEAD:<파일>               →  3fec203c…    (실제로는 다르다)

이게 실제 사고를 만들었다. `data/terms/README.md`의 한투 sha가 여덟 달 넘게
작업트리 값(`10e3f5ce…`)으로 적혀 있었고, PR #47의 성공 실행이 **그 CRLF
바이트를 그대로 제출**했다. 유료 호출이라 재실행에 돈이 든다.

CI는 매번 fresh checkout이라 여기서 이 검사는 항상 통과한다 — **이 테스트의
독자는 로컬이다.** 유료 실행 전에 pytest를 돌리면 스테일 트리가 여기서 걸린다.

깨졌을 때 할 일은 재체크아웃이다:

    rm data/terms/<파일> && git checkout -- data/terms/<파일>
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
TERMS_DIR = REPO_ROOT / "data" / "terms"


def _git(*args: str) -> str:
    return subprocess.run(
        # quotepath=false — 한글 파일명을 `\355\225…`로 이스케이프하면 그 문자열이
        # 그대로 파일명으로 넘어가 검사가 전부 헛돈다(실제로 한 번 그랬다).
        ["git", "-c", "core.quotepath=false", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout.strip()


def _tracked_terms_files() -> list[str]:
    listing = _git("ls-files", "--", "data/terms")
    return [line for line in listing.splitlines() if line and not line.endswith(".md")]


class TermsWorktreeBytesTest(unittest.TestCase):
    def test_git_is_available(self) -> None:
        """git이 없으면 아래 검사가 조용히 무의미해진다 — 먼저 확인한다."""
        self.assertTrue(_git("rev-parse", "--is-inside-work-tree") == "true")

    def test_tracked_documents_are_present(self) -> None:
        files = _tracked_terms_files()
        # 지금 7건(HTML 2 + PDF 5). 줄어들면 검사 범위가 조용히 좁아진 것이다.
        self.assertGreaterEqual(len(files), 7, f"추적 문서가 {len(files)}건뿐이다")

    def test_worktree_bytes_match_repository_blobs(self) -> None:
        """`git status`가 조용해도 여기서는 걸려야 한다."""
        stale: list[str] = []
        for path in _tracked_terms_files():
            with self.subTest(document=path):
                worktree = _git("hash-object", path)
                committed = _git("rev-parse", f"HEAD:{path}")
                if worktree != committed:
                    stale.append(path)
                self.assertEqual(
                    worktree,
                    committed,
                    f"{path}: 작업트리 바이트가 저장소 정본과 다르다. "
                    f"`rm '{path}' && git checkout -- '{path}'`로 되돌릴 것 — "
                    "이 상태로 인제스트를 돌리면 잘못된 content_sha256을 제출한다",
                )
        self.assertEqual(stale, [], f"스테일 문서 {len(stale)}건")


if __name__ == "__main__":
    unittest.main()
