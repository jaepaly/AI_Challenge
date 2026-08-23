"""락파일이 선언과 어긋나지 않는지 검사한다.

## 왜 락파일이 필요한가 — 그리고 무엇을 지키지 *않는가*

2026-08-21에 우리 코드 0줄 변경으로 main 이 16시간 깨졌다(#61). `anthropic` 메이저가
상한 없이 들어왔기 때문이다. A 가 #65 로 상한을 걸었지만 **상한은 직접 의존만 막는다.**
그때 실제로 사라진 `httpx` 는 **전이 의존**이었고, `requirements.txt` 를 `==` 로 고정해도
전이는 여전히 뜬다. 전이까지 고정하는 것은 락파일뿐이다(#62 ②).

⚠ **이 락파일은 배포를 지키지 않는다.** `services/ingest` 는 어디에도 배포돼 있지 않다 —
`vercel.json`·`Dockerfile`·`Procfile` 이 없고, `deploy.yml` 은 `apps/web` 만 Vercel 로
올리며, 배포본의 `POST /api/ingest` 는 404 다. 이 락이 지키는 것은 **CI 재현성**이다:
심사 기간(9/7~9/11)에 급한 수정을 밀어 넣어야 할 때 CI 가 상류 사정으로 깨져 있으면
그 수정을 못 넣는다.

## CI 는 왜 락을 쓰지 않는가

`ci.yml:68` 은 여전히 `requirements.txt` 로 설치한다. **일부러 그렇게 둔다** — 락으로
설치하면 상류가 깨지는 것을 **영영 모르게** 된다. A 의 상한 가드(#65)와 이 락은 역할이
반대다:

    requirements.txt + 상한 가드   상류 변화를 **일찍 알기** 위한 것 (CI)
    requirements.lock.txt          검증한 환경을 **그대로 재현**하기 위한 것 (심사 기간 동결)

심사 기간에만 락으로 고정하고, 그 전후로는 CI 가 계속 상류를 본다.

## 왜 `--universal` 인가

락을 만든 사람은 Windows, CI 는 ubuntu 다. 평범한 `pip freeze` 는 그 차이를 못 담는다 —
실측하면 `uvloop` 은 Linux 전용이라 Windows 에 없고 `colorama` 는 Windows 전용이다.
`uv pip compile --universal` 이 환경 마커를 남겨 한 파일이 두 플랫폼에서 다 선다:

    colorama==0.4.6 ; sys_platform == 'win32'
    uvloop==0.22.1 ; ... and sys_platform != 'win32'

## 이 검사가 막는 것

선언을 고치고 락을 다시 만들지 않는 것. 그러면 락이 **과거의 결정**을 재현한다.
"""

from __future__ import annotations

from pathlib import Path
import re
import unittest


INGEST_ROOT = Path(__file__).resolve().parents[1]
LOCKFILE = INGEST_ROOT / "requirements.lock.txt"
REQUIREMENT_FILES = (
    INGEST_ROOT / "requirements.txt",
    INGEST_ROOT / "requirements-dev.txt",
)


def _declared() -> dict[str, str]:
    """직접 선언한 패키지 → 원문 줄. `-r` 포함 지시어는 건너뛴다."""
    found: dict[str, str] = {}
    for path in REQUIREMENT_FILES:
        for line in path.read_text(encoding="utf-8").splitlines():
            body = line.split("#", 1)[0].strip()
            if not body or body.startswith("-"):
                continue
            name = re.split(r"[<>=!~\[]", body)[0].strip().lower()
            found[name] = body
    return found


def _locked() -> dict[str, str]:
    """락파일의 `name==version` → 버전. 마커·해시 줄은 무시한다."""
    found: dict[str, str] = {}
    for line in LOCKFILE.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z0-9._-]+)==([^\s;\\]+)", line)
        if match:
            found[match.group(1).lower()] = match.group(2)
    return found


def _release(value: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in value.strip().split("."):
        digits = re.match(r"\d+", chunk)
        if not digits:
            break
        parts.append(int(digits.group()))
    return tuple(parts) or (0,)


def _ci_yaml() -> str:
    return (INGEST_ROOT.parents[1] / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )


def _expand_includes(path: Path, seen: set[Path]) -> None:
    """`-r other.txt` 를 따라가며 실제로 읽히는 선언 파일을 모은다."""
    path = path.resolve()
    if path in seen or not path.exists():
        return
    seen.add(path)
    for line in path.read_text(encoding="utf-8").splitlines():
        body = line.split("#", 1)[0].strip()
        match = re.match(r"^-r\s+(\S+)", body)
        if match:
            _expand_includes(path.parent / match.group(1), seen)


def _ci_pip_install() -> tuple[set[Path], list[str]]:
    """ci.yml 의 `pip install` 이 실제로 무엇을 읽고 무엇을 맨손으로 까는가.

    돌려주는 것은 (읽히는 선언 파일 집합, 파일 밖에서 깔리는 맨 패키지 목록).
    """
    repo_root = INGEST_ROOT.parents[1]
    read: set[Path] = set()
    bare: list[str] = []
    for line in _ci_yaml().splitlines():
        body = line.split("#", 1)[0]
        if "pip install" not in body:
            continue
        tokens = body.split("pip install", 1)[1].split()
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token in ("-r", "--requirement"):
                index += 1
                if index < len(tokens):
                    _expand_includes(repo_root / tokens[index], read)
            elif token.startswith("-"):
                pass  # 그 밖의 플래그(-U, --quiet …)
            else:
                bare.append(token)
            index += 1
    return read, bare


class LockfileTest(unittest.TestCase):
    def test_lockfile_exists_and_records_how_it_was_made(self) -> None:
        """헤더가 없으면 다시 만드는 방법을 아무도 모른다."""
        self.assertTrue(LOCKFILE.exists(), "requirements.lock.txt 가 없다")
        head = LOCKFILE.read_text(encoding="utf-8")[:400]
        self.assertIn("uv pip compile", head, "생성 명령이 헤더에 없다")
        self.assertIn("--universal", head, "플랫폼 마커 없이 만든 락이다 — CI(ubuntu)에서 어긋난다")
        self.assertIn("--generate-hashes", head, "해시 없는 락은 공급망 무결성을 못 준다")

    def test_every_declared_dependency_is_locked(self) -> None:
        """선언을 늘리고 락을 안 만들면 여기서 걸린다."""
        locked = _locked()
        missing = sorted(name for name in _declared() if name not in locked)
        self.assertEqual(
            missing,
            [],
            f"선언했는데 락에 없다: {missing}. `uv pip compile services/ingest/requirements-dev.txt "
            "--universal --python-version 3.11 --generate-hashes "
            "-o services/ingest/requirements.lock.txt` 로 다시 만들어라",
        )

    def test_locked_versions_satisfy_the_declared_bounds(self) -> None:
        """선언을 고치고 락을 안 고치면 락이 과거의 결정을 재현한다."""
        locked = _locked()
        violations: dict[str, str] = {}
        for name, body in _declared().items():
            version = locked.get(name)
            if version is None:
                continue  # 위 검사가 잡는다
            got = _release(version)
            for operator, raw in re.findall(r"(>=|<=|==|<|>)\s*([^,\s]+)", body):
                want = _release(raw)
                ok = {
                    ">=": got >= want,
                    "<=": got <= want,
                    "==": got == want,
                    "<": got < want,
                    ">": got > want,
                }[operator]
                if not ok:
                    violations[name] = f"락 {version} 이 선언 '{body}' 를 만족하지 않는다"
        self.assertEqual(violations, {}, f"{violations}")

    def test_platform_markers_are_present(self) -> None:
        """--universal 이 실제로 일을 했는지 본다.

        `uvloop`(Linux 전용)과 `colorama`(Windows 전용)가 마커와 함께 둘 다 있어야
        한 파일이 두 플랫폼에서 선다. 하나만 있으면 어느 한쪽에서 설치가 어긋난다.
        """
        text = LOCKFILE.read_text(encoding="utf-8")
        self.assertRegex(text, r"colorama==[^\s]+ ; sys_platform == 'win32'")
        self.assertRegex(text, r"uvloop==[^\s]+ ;.*sys_platform != 'win32'")

    def test_ci_still_installs_from_requirements_not_the_lock(self) -> None:
        """의도한 분업이 유지되는지 본다 — 위 docstring 참조.

        CI 가 락으로 설치하기 시작하면 상류가 깨지는 것을 영영 모르게 된다.
        바꾸려면 이 검사를 함께 고치고 **왜 바꾸는지**를 적어야 한다.

        ⚠ **텍스트 전체가 아니라 `pip install` 줄만 본다.** 파일 어딘가에
        `requirements.lock.txt` 라는 글자가 있는 것은 문제가 아니다 — 왜 락을 안
        쓰는지 주석으로 적어 두는 것이 오히려 맞다. 막아야 하는 것은 **설치**다.
        """
        installed, _ = _ci_pip_install()
        self.assertIn(
            INGEST_ROOT / "requirements-dev.txt",
            {path.resolve() for path in installed},
            "CI 가 requirements-dev.txt 로 깔지 않는다 — pytest 상한이 효력을 잃는다.",
        )
        self.assertEqual(
            [path.name for path in installed if path.name == LOCKFILE.name],
            [],
            "CI 가 락으로 설치한다. 그러면 상류가 깨지는 것을 영영 모른다 — "
            "심사 기간 동결만 락으로 하고, 그 전후로는 범위 설치로 상류를 계속 본다.",
        )

    def test_ci_install_reads_every_declaration_file(self) -> None:
        """선언에 상한을 걸어도 **CI 가 그 파일을 안 읽으면 효력이 없다.**

        2026-08-23 에 실제로 그 상태였다(#71 리뷰, A)::

            ci.yml   pip install -r services/ingest/requirements.txt pytest
                                                                     ^^^^^^

        `requirements-dev.txt` 의 `pytest>=9.1,<10` 이 **어느 설치 경로에도 적용되지
        않았다.** 상한 가드도 발화하지 않는다 — 선언은 `<10` 이라 만족하고, 어긋난
        것은 declaration 이 아니라 install 이기 때문이다. 지키는 것처럼 보이는 검사만
        하나 늘어난 셈이라 오히려 더 나빴다.
        """
        installed, bare = _ci_pip_install()
        self.assertEqual(
            bare,
            [],
            f"CI 가 선언 파일 밖에서 맨 패키지를 깐다: {bare}. 그 패키지에는 상한이 "
            "없고, 상한 가드는 declaration 만 보므로 발화하지 않는다.\n"
            "고치는 법: **런타임 의존이든 도구든** requirements 계열 파일에 버전 "
            "범위와 함께 적고 `-r` 로 깔아라. 도구(uv·ruff 같은 것)도 예외가 아니다 "
            "— 상류가 메이저를 올리면 도구도 똑같이 CI 를 깬다. 잡용 도구라 "
            "requirements-dev.txt 에 넣기 어색하면 파일을 하나 더 만들고 "
            "REQUIREMENT_FILES 에 추가해라(#71 리뷰, A).",
        )
        missing = [path.name for path in REQUIREMENT_FILES if path not in installed]
        self.assertEqual(
            missing,
            [],
            f"CI 설치가 읽지 않는 선언 파일: {missing}. 여기 적힌 상한은 효력이 없다.",
        )


if __name__ == "__main__":
    unittest.main()
