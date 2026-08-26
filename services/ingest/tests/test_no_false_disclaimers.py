"""화면 문구가 화면보다 많이 약속하는 문장을 저장소 전체에서 막는다.

2026-08-22 팀원 외부 점검에서 나왔다. 참고 모드 배너가 이렇게 적혀 있었다:

    "⚠ 참고 모드 — 검수 전(draft) 조건카드. 정식 한계선 산출에 사용하지 않습니다"

**거짓이었다.** `quantOk`가 `mode !== "blocked"`라 draft는 통과하고, 하한가형 카드의
`discount_basis: "lower_limit"` → h=0.3이 처분 수량을 만들어 같은 화면에 찍는다.
쓰지 않는다고 적으면서 그 카드로 계산하고 있었다(#63으로 정정).

정정 뒤 A가 **같은 문장의 사본이 `apps/landing-proto/index.html`에 하나 더** 있다고
지적했다. **그 사본은 실제로 화면에 뜬다** — `src/main.ts:137`의
`$("cardBanner").hidden = card.status !== "draft"`가 초기 `hidden`을 풀고, 하한가형
카드가 `status: "draft"`라 그 버튼을 누르면 나온다. 마크업의 `hidden`만 보고
"안 뜨는 죽은 코드"로 읽으면 안 된다(이 검사를 처음 쓸 때 내가 그렇게 읽었고,
A가 번들을 빌드해 잡았다).

`freshness-view.test.ts`는 함수의 반환값을 보므로 HTML 사본을 못 본다. 이 검사는
**추적 파일 전체**를 훑는다. 문구는 코드보다 잘 복사되고, 복사될 때 근거는 안 따라온다.

⚠ 이 검사는 **금지 문구 목록**이지 일반 규칙이 아니다. 새 거짓 문장을 예언하지 못한다.
같은 종류가 또 나오면 목록에 한 줄 추가하고, **왜 거짓인지 옆에 적는다** — 이유가 없으면
다음 사람이 목록만 보고 "왜 못 쓰지?" 하며 지운다.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]

# 문구 → 왜 거짓인가
FORBIDDEN: dict[str, str] = {
    "담보유지비율이 계산의 입력이 아니": (
        "2026-08-26 부터 거짓이다 — #83·#84 로 화면이 `policyRatio(card, pos)` 를 쓰고, "
        "원장의 유지비율 리터럴은 지워졌다. 카드가 계산을 구동한다. "
        "첨부2 §5 초판이 이 문장을 달고 있었고, 그건 «AI 가 읽은 값이 계산에 닿지 "
        "않는다»는 뜻이라 우리가 파는 것 자체를 부정한다. 되살아나면 제출물이 "
        "제품보다 적게 약속하게 된다."
    ),
    "카드의 유지비율은 대조와 표시에만": (
        "위와 같은 문장의 다른 표현이다(#84 이후 거짓). 문구는 코드보다 잘 복사되고, "
        "복사될 때 근거는 안 따라온다 — 그래서 표현을 두 개 다 막는다."
    ),
    "정식 한계선 산출에 사용하지 않": (
        "draft 카드도 h가 읽혀 처분 수량이 산출된다 — quantOk는 blocked만 막는다(#63). "
        "화면이 그 카드로 계산해 놓고 안 쓴다고 적으면 거짓이다."
    ),
}

# 검사에서 제외할 경로 — 이 파일 자신이 문구를 담고 있다
EXEMPT = {
    "services/ingest/tests/test_no_false_disclaimers.py",
}


def _tracked_files() -> list[str]:
    """추적 파일 + 아직 커밋 안 된 새 파일. 빌드 산출물(.next 등)은 제외된다.

    `--others --exclude-standard`를 함께 주는 이유: 추적 파일만 보면 **커밋 전에는
    안 잡힌다.** CI는 푸시된 커밋을 보니 결국 걸리지만, 로컬에서 먼저 걸리는 편이
    되돌리기 싸다. `--exclude-standard`가 gitignore를 그대로 존중하므로
    `.next` 같은 산출물은 여전히 제외된다.
    """
    listing = subprocess.run(
        # quotepath=false — 한글 파일명이 이스케이프되면 경로가 어긋난다
        ["git", "-c", "core.quotepath=false", "ls-files", "--cached", "--others",
         "--exclude-standard"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    return [line for line in listing.splitlines() if line]


class FalseDisclaimerTest(unittest.TestCase):
    def test_git_is_available(self) -> None:
        """git이 없으면 아래 검사가 조용히 0건을 훑는다 — 먼저 확인한다."""
        files = _tracked_files()
        self.assertGreater(len(files), 50, f"추적 파일이 {len(files)}건뿐이다")

    def test_no_tracked_file_claims_a_card_is_unused(self) -> None:
        """문구가 어디로 복사돼도 여기서 걸린다."""
        for phrase, why in FORBIDDEN.items():
            with self.subTest(phrase=phrase):
                hits: list[str] = []
                for path in _tracked_files():
                    if path in EXEMPT:
                        continue
                    full = REPO_ROOT / path
                    try:
                        text = full.read_text(encoding="utf-8")
                    except (UnicodeDecodeError, OSError):
                        continue  # 바이너리·읽기 불가는 건너뛴다
                    if phrase in text:
                        hits.append(path)

                self.assertEqual(hits, [], f"{why}\n발견: {hits}")

    def test_the_exemption_list_only_holds_files_that_exist(self) -> None:
        """없는 파일을 면제해 두면 이 검사가 무엇을 지키는지 흐려진다.

        ⚠ 추적 여부가 아니라 **디스크 존재**로 본다. 새 파일은 커밋 전까지
        `git ls-files`에 안 나오는데, 그것 때문에 검사가 빨간불이면 이 파일을
        처음 만드는 사람이 자기 검사에 걸린다(실제로 그랬다).
        """
        missing = {path for path in EXEMPT if not (REPO_ROOT / path).exists()}
        self.assertEqual(missing, set(), f"존재하지 않는 면제 경로: {missing}")

    def test_every_forbidden_phrase_says_why(self) -> None:
        """이유 없는 금지는 다음 사람이 지운다."""
        for phrase, why in FORBIDDEN.items():
            with self.subTest(phrase=phrase):
                self.assertGreater(len(why), 30, f"{phrase}: 왜 거짓인지 적혀 있지 않다")


if __name__ == "__main__":
    unittest.main()
