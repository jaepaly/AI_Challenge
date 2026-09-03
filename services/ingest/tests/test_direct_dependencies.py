"""직접 import 하는 서드파티가 requirements.txt에 선언돼 있는지 검사한다.

2026-08-21에 실제로 CI가 깨졌다. 테스트가 `import httpx` 하는데 `requirements.txt`에는
없었고, `anthropic`의 **transitive 의존**으로만 들어와 있었다. 상류가 그 의존을 놓는
순간 우리 코드는 한 줄도 안 바뀐 채 빨간불이 됐다:

    2026-08-20 10:50 UTC  main(2a40552) CI  → success
    2026-08-21 06:37 UTC  같은 커밋 재실행   → ModuleNotFoundError: No module named 'httpx'

**직접 import 하는 것은 직접 의존으로 적는다.** 남의 패키지가 끌어와 주는 것에 기대면
우리가 통제하지 못하는 시점에 깨진다. 이 검사는 그 규칙을 기계로 지킨다.

⚠ import 이름과 배포 패키지 이름이 다른 경우가 있다(`dotenv` ← `python-dotenv`).
그 매핑을 손으로 적어 두는 이유는, 자동 추론이 틀리면 **없는 문제를 만들거나 있는
문제를 가리기** 때문이다. 새 패키지가 그런 경우면 여기 한 줄 추가하면 된다.
"""

from __future__ import annotations

import ast
from pathlib import Path
import re
import sys
import unittest


INGEST_ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = INGEST_ROOT / "requirements.txt"

# import 이름 → requirements.txt 의 배포 패키지 이름
IMPORT_TO_DISTRIBUTION = {
    "dotenv": "python-dotenv",
}

# 이 저장소 안의 모듈 — 서드파티가 아니다
LOCAL_PACKAGES = {"app", "benchmarks", "tests"}

# tests/ 안에서 서로를 import 하는 헬퍼(테스트 러너가 tests/ 를 경로에 넣는다)
LOCAL_TEST_MODULES = {
    path.stem for path in (INGEST_ROOT / "tests").glob("*.py")
}

# 저장소 안의 다른 폴더에 있는 우리 모듈. 검사가 이걸 «선언 안 된 외부 의존» 으로
# 읽으면 안 된다 — 실제로 `submission/build_hwpx.py` 를 그렇게 읽었다(2026-09-04).
# ⚠ **파일이 실재하는지 확인해서 넣는다.** 이름만 적어 두면 그 파일이 사라진 뒤에도
#   허용 목록이 조용히 남아, 같은 이름의 외부 패키지를 통과시킨다.
LOCAL_REPO_MODULES = {
    path.stem
    for path in (INGEST_ROOT.parents[1] / "submission").glob("*.py")
}


def _declared_distributions() -> set[str]:
    declared: set[str] = set()
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        declared.add(re.split(r"[<>=!\[]", line)[0].strip().lower())
    return declared


def _third_party_imports() -> dict[str, set[str]]:
    """직접 import 하는 서드파티 최상위 모듈 → 사용 파일."""
    stdlib = set(sys.stdlib_module_names)
    found: dict[str, set[str]] = {}

    for path in INGEST_ROOT.rglob("*.py"):
        if ".venv" in path.parts or "__pycache__" in path.parts:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # 문법 오류는 다른 검사가 잡는다
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name.split(".")[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module.split(".")[0]]
            else:
                continue

            for name in names:
                if (
                    name in stdlib
                    or name in LOCAL_PACKAGES
                    or name in LOCAL_TEST_MODULES
                    or name in LOCAL_REPO_MODULES
                    or name.startswith("_")
                ):
                    continue
                found.setdefault(name, set()).add(
                    str(path.relative_to(INGEST_ROOT)).replace("\\", "/")
                )
    return found


class DirectDependencyTest(unittest.TestCase):
    def test_every_direct_import_is_declared(self) -> None:
        """transitive 로만 들어오는 의존이 있으면 여기서 깨진다."""
        declared = _declared_distributions()
        undeclared: dict[str, set[str]] = {}

        for module, files in _third_party_imports().items():
            distribution = IMPORT_TO_DISTRIBUTION.get(module, module).lower()
            if distribution not in declared:
                undeclared[module] = files

        self.assertEqual(
            undeclared,
            {},
            "requirements.txt 에 없는 직접 의존이 있다. 남의 패키지가 끌어와 주는 것에 "
            "기대면 상류가 바뀔 때 우리 코드 변경 없이 CI 가 깨진다(2026-08-21 httpx). "
            "import 이름과 패키지 이름이 다르면 IMPORT_TO_DISTRIBUTION 에 매핑을 넣어라.",
        )

    def test_httpx_stays_declared(self) -> None:
        """실제로 깨졌던 그 의존 — 회귀 케이스로 박아 둔다."""
        self.assertIn("httpx", _declared_distributions())
        self.assertIn("httpx", _third_party_imports(), "httpx 를 더 안 쓰면 이 줄도 지워라")

    def test_the_mapping_only_holds_entries_we_actually_import(self) -> None:
        """쓰지 않는 매핑이 쌓이면 이 검사가 무엇을 지키는지 흐려진다."""
        imported = set(_third_party_imports())
        stale = set(IMPORT_TO_DISTRIBUTION) - imported
        self.assertEqual(stale, set(), f"더 이상 import 하지 않는 매핑: {stale}")


if __name__ == "__main__":
    unittest.main()
