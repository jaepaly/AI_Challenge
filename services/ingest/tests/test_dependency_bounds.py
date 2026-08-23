"""직접 의존 선언이 **실제로 검증한 범위**를 말하는지 검사한다.

`test_direct_dependencies`(#61)는 *"직접 import 하는 것이 선언돼 있는가"* 를 본다.
이 검사는 그 다음 축이다 — *"선언된 범위가 우리가 돌려 본 것과 같은가"*.

2026-08-21에 `anthropic` 메이저 1.0.0이 상한 없는 `>=0.40`으로 들어와 main이
16시간 빨간불이었다(#61, #62). 우리 코드는 한 줄도 안 바뀌었다::

    2026-08-20 10:50 UTC  main(2a40552) CI  anthropic 0.x   → success
    2026-08-21 12:07 UTC  같은 커밋 재실행   anthropic 1.0.0 → failure

상한을 거는 것만으로는 절반이다. 실측하면 **선언이 이미 실제와 어긋나 있었다**::

    pypdf  선언 >=4.3   /  깨끗한 환경 해석 6.16.1   ← 메이저 2개 차이
    pypdf 6.0.0 릴리스 2025-08-11 — 1년 넘게 6.x를 돌려 왔다

즉 `pypdf>=4.3,<7`로 적으면 상한은 생기지만 *"4.3에서 돈다"* 는 **검증한 적 없는
주장**이 그대로 남는다. 그래서 두 축을 함께 본다.

    축 A   직접 의존에 상한이 있는가. 그 상한이 하한의 다음 메이저를 넘지 않는가
    축 B   선언 하한의 메이저가 실제 설치본의 메이저와 같은가

⚠ **축 B는 0.x에서 헐겁다.** `0.115`와 `0.141`은 둘 다 메이저 0이라 축 B로는 안
잡힌다. 0.x가 실제로 깨지는 자리는 1.0 전환이고 그건 축 A의 `<1`이 막는다. 0.x의
하한을 어디에 둘지는 **사람의 판단**으로 남는다 — 기계가 강제하지 않는다.

⚠ **이 검사로는 전이 의존이 안 잡힌다.** 지금 살아 있는 실례가 `starlette`다.
우리는 `starlette`를 직접 import 하지 않고 `fastapi.testclient` 경유로만 닿는다.
`fastapi 0.141.1`이 요구하는 것은 `starlette>=0.46.0`으로 **상한이 없고**,
`starlette 1.0.0`(2026-03-22) 메이저 전환은 이미 우리 모르게 지나갔다. 설치된
`starlette 1.6.0`은 이렇게 경고하고 있다::

    StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is
    deprecated; install `httpx2` instead.

`fastapi`를 `==`로 완전히 고정해도 그 fastapi가 starlette 상한을 안 건다. **이
부류는 락파일로만 닫힌다**(#62 ②). 이 검사가 전이까지 막아 준다고 읽지 마라.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version as installed_version
from pathlib import Path
import re
import unittest


INGEST_ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = INGEST_ROOT / "requirements.txt"

UPPER_BOUND_OPERATORS = ("<", "<=", "==", "~=")

# 상한을 일부러 넓게 두는 것 — 있다면 사유와 함께 여기 적는다.
# 지금은 없다. 비어 있는 채로 두는 것이 정상이다.
BOUND_EXEMPTIONS: dict[str, str] = {}


class _Declared:
    """requirements.txt 한 줄에서 뽑아낸 것."""

    def __init__(self, line: str) -> None:
        self.raw = line
        body = line.split("#", 1)[0].strip()
        self.name = re.split(r"[<>=!~\[]", body)[0].strip().lower()
        self.specs: list[tuple[str, str]] = [
            (operator, value.strip())
            for operator, value in re.findall(r"(==|~=|>=|<=|!=|<|>)\s*([^,]+)", body)
        ]

    @property
    def floor(self) -> str | None:
        for operator, value in self.specs:
            if operator in (">=", "==", "~="):
                return value
        return None

    @property
    def upper(self) -> tuple[str, str] | None:
        for operator, value in self.specs:
            if operator in UPPER_BOUND_OPERATORS:
                return operator, value
        return None


def _release(value: str) -> tuple[int, ...]:
    """'6.16.1' → (6, 16, 1). 숫자가 아닌 꼬리(rc1, .post2)는 버린다."""
    parts: list[int] = []
    for chunk in value.strip().split("."):
        match = re.match(r"\d+", chunk)
        if not match:
            break
        parts.append(int(match.group()))
    return tuple(parts) or (0,)


def _major(value: str) -> int:
    return _release(value)[0]


def _next_major(value: str) -> tuple[int, ...]:
    """하한이 6.16이면 (7,). 0.x는 1.0 전환이 그 자리다 — (1,)."""
    major = _major(value)
    return (major + 1,) if major > 0 else (1,)


def _declarations() -> list[_Declared]:
    found: list[_Declared] = []
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        if not line.split("#", 1)[0].strip():
            continue
        found.append(_Declared(line))
    return found


class DependencyBoundsTest(unittest.TestCase):
    def test_every_direct_dependency_has_a_floor(self) -> None:
        """하한이 없으면 축 B가 검사할 대상 자체가 없다."""
        missing = [d.name for d in _declarations() if d.floor is None]
        self.assertEqual(
            missing,
            [],
            f"하한(>=)이 없는 직접 의존: {missing}. 무엇을 검증했는지 적어야 한다.",
        )

    def test_every_direct_dependency_has_an_upper_bound(self) -> None:
        """축 A — 2026-08-21에 실제로 깨진 자리다."""
        missing = [
            d.name
            for d in _declarations()
            if d.upper is None and d.name not in BOUND_EXEMPTIONS
        ]
        self.assertEqual(
            missing,
            [],
            f"메이저 상한이 없는 직접 의존: {missing}. 상류가 메이저를 올리는 순간 "
            "우리 코드 변경 없이 CI가 깨진다(2026-08-21 anthropic 1.0.0). "
            "넓게 둘 사유가 있으면 BOUND_EXEMPTIONS에 사유와 함께 적어라.",
        )

    def test_upper_bound_does_not_reach_past_the_next_major(self) -> None:
        """축 A — `<99` 같은 상한은 상한이 아니다."""
        too_loose: dict[str, str] = {}
        for declared in _declarations():
            upper = declared.upper
            if upper is None or declared.floor is None:
                continue
            operator, value = upper
            if operator in ("==", "~="):
                continue
            if _release(value) > _next_major(declared.floor):
                too_loose[declared.name] = (
                    f"{operator}{value} — 하한 {declared.floor} 기준 "
                    f"{'.'.join(map(str, _next_major(declared.floor)))} 이하여야 한다"
                )
        self.assertEqual(too_loose, {}, f"상한이 다음 메이저를 넘는다: {too_loose}")

    def test_declared_floor_matches_the_installed_major(self) -> None:
        """축 B — 검증한 적 없는 메이저를 선언에 남겨 두지 않는다.

        `pypdf>=4.3`인데 실제로는 6.x만 돌려 본 상태가 이 검사가 잡는 것이다.
        """
        mismatched: dict[str, str] = {}
        for declared in _declarations():
            if declared.floor is None:
                continue
            try:
                actual = installed_version(declared.name)
            except PackageNotFoundError:  # 설치 안 된 환경은 다른 검사가 잡는다
                continue
            if _major(declared.floor) != _major(actual):
                mismatched[declared.name] = (
                    f"선언 하한 {declared.floor}(메이저 {_major(declared.floor)}) / "
                    f"설치본 {actual}(메이저 {_major(actual)})"
                )
        self.assertEqual(
            mismatched,
            {},
            "선언 하한이 실제 설치본과 다른 메이저다. 돌려 본 적 없는 메이저를 "
            f"호환된다고 주장하는 것이다: {mismatched}",
        )

    def test_anthropic_major_stays_bounded(self) -> None:
        """실제로 깨졌던 그 의존 — 회귀 케이스로 박아 둔다."""
        anthropic = next(
            (d for d in _declarations() if d.name == "anthropic"), None
        )
        self.assertIsNotNone(anthropic, "anthropic 선언이 사라졌다")
        assert anthropic is not None  # 타입 좁히기
        self.assertEqual(
            anthropic.upper,
            ("<", "1"),
            "anthropic 1.0.0은 HTTP 스택을 httpx→httpx2로 갈아탔다. 상한을 풀기 "
            "전에 테스트 하네스의 httpx 결합과 실제 API 왕복을 확인해야 한다(#62).",
        )

    def test_the_reason_for_the_anthropic_bound_stays_next_to_it(self) -> None:
        """왜 묶었는지가 코드 옆에 없으면 다음 사람이 상한을 지운다."""
        line = next(
            line
            for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines()
            if line.split("#", 1)[0].strip().lower().startswith("anthropic")
        )
        self.assertIn("#", line, "anthropic 상한의 사유 주석이 사라졌다")
        self.assertIn("httpx2", line, "무엇 때문에 묶었는지가 주석에 남아 있어야 한다")

    def test_pypdf_stays_pinned_exactly(self) -> None:
        """근거 좌표 전체가 이 추출기 출력에 묶여 있다 — 범위로 두면 안 된다.

        2026-08-23 에 실제로 깨졌다. `pypdf>=6.16,<7` 인 상태에서 6.16.2 가 나왔고,
        우리 코드 0줄 변경으로 main 이 빨간불이 됐다(#61 과 같은 모양)::

            pypdf 6.16.1   메리츠 34,224자  키움 20,799자    ← 좌표를 기록한 추출
            pypdf 6.16.2   메리츠 35,420자  키움 21,687자    ← 미래에셋·삼성·신한은 동일

        내용이 아니라 **띄어쓰기·결합**이 달라져서 인용문 전체가 부분일치에 실패한다
        ('A∙B군 140%' 자체는 6.16.2 에도 그대로 1회 있다). 그래서 *"6.16.2 가 더 낫다"*
        가 참이더라도 **좌표 아홉 개를 다시 기록·검수하기 전에는 올릴 수 없다.**

        축 A(상한 있음)만으로는 이걸 못 막는다. `<7` 은 6.16.2 를 허용한다.
        """
        pypdf = next((d for d in _declarations() if d.name == "pypdf"), None)
        self.assertIsNotNone(pypdf, "pypdf 선언이 사라졌다")
        assert pypdf is not None  # 타입 좁히기
        self.assertEqual(
            pypdf.specs,
            [("==", "6.16.1")],
            "pypdf 는 범위가 아니라 정확 고정이어야 한다. 근거 좌표(flattened_sha256, "
            "char_start/char_end)가 추출기 출력의 함수라, 패치 릴리스 하나가 좌표 "
            "아홉 개를 동시에 무효로 만든다(2026-08-23 6.16.2).",
        )

    def test_exemptions_only_hold_dependencies_we_declare(self) -> None:
        """쓰지 않는 예외가 쌓이면 이 검사가 무엇을 지키는지 흐려진다."""
        declared = {d.name for d in _declarations()}
        stale = set(BOUND_EXEMPTIONS) - declared
        self.assertEqual(stale, set(), f"선언에 없는 예외 항목: {stale}")


if __name__ == "__main__":
    unittest.main()
