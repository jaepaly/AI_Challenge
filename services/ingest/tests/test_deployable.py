"""`services/ingest` 가 **저장소 루트 없이도** 도는지 본다.

2026-08-24, 업로드 기능을 살리기로 하면서 드러난 것::

    two_pass.py:1064   schema = json.loads(SCHEMA_PATH.read_text(...))
    SCHEMA_PATH        REPO_ROOT / "schemas" / "condition_card.schema.json"

배포 루트를 `services/ingest` 로 잡으면 번들에 저장소 루트가 안 들어온다. 그러면
4중 방어 ②(JSON Schema 검증)가 **프로덕션에서만** 터진다 — 로컬·CI 는 루트가 있어
끝까지 통과한다. 오늘만 같은 모양을 세 번 봤다(jsdom 30 / pytest 8.4 / pypdf 6.16.2):
**선언은 맞는데 실행 환경이 다른** 종류다.

그래서 이 파일은 선언을 읽지 않는다. `vercel.json` 의 제외 규칙대로 **번들을 실제로
만들어 그 안에서 import 하고 스키마를 읽는다.** 경로가 다시 끊어지면 여기서 넘어진다.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


INGEST_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = INGEST_ROOT.parents[1]
CANONICAL = REPO_ROOT / "schemas" / "condition_card.schema.json"
BUNDLED = INGEST_ROOT / "app" / "_bundled" / "condition_card.schema.json"
VERCEL_JSON = INGEST_ROOT / "vercel.json"
PYTHON_VERSION_FILE = INGEST_ROOT / ".python-version"
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"

# Vercel 파이썬 런타임이 받아 주는 것(2026-07 문서). 3.11 은 **없다**.
VERCEL_PYTHON_VERSIONS = {"3.12", "3.13", "3.14"}

# 번들에서 빠지는 것 — vercel.json 의 excludeFiles 와 같은 뜻이어야 한다.
EXCLUDED_DIRS = {"tests", "benchmarks", "__pycache__"}


class BundledSchemaTest(unittest.TestCase):
    def test_bundled_schema_matches_canonical(self) -> None:
        """사본이 낡으면 배포본만 옛 스키마로 검증한다 — 화면에서는 안 보인다."""
        self.assertTrue(CANONICAL.exists(), f"정본이 없다: {CANONICAL}")
        self.assertTrue(
            BUNDLED.exists(),
            f"번들 사본이 없다: {BUNDLED}. `python scripts/sync_bundled_schema.py` 를 돌려라.",
        )
        self.assertEqual(
            BUNDLED.read_bytes(),
            CANONICAL.read_bytes(),
            "번들 사본이 정본과 다르다. **사본을 손으로 고치지 마라** — 정본을 고치고 "
            "`python scripts/sync_bundled_schema.py` 를 돌려라.",
        )

    def test_the_copy_is_valid_json_schema_shaped(self) -> None:
        """복사가 깨졌으면 바이트 비교만으로는 둘 다 깨진 것을 못 본다."""
        schema = json.loads(BUNDLED.read_text(encoding="utf-8"))
        self.assertIn("required", schema)
        self.assertIn("ratio_rules", schema["required"])

    def test_canonical_wins_when_both_exist(self) -> None:
        """개발·CI 에서는 **항상 정본**을 읽어야 사본이 낡은 것을 검사가 잡는다.

        사본을 먼저 읽으면 정본을 고쳐도 아무 일도 안 일어난다.
        """
        from app.two_pass import CANONICAL_SCHEMA_PATH, schema_path

        self.assertEqual(schema_path(), CANONICAL_SCHEMA_PATH)


class DeployBundleRunsTest(unittest.TestCase):
    """번들을 실제로 만들어 그 안에서 돌린다. 선언이 아니라 실행이다."""

    def test_the_bundle_can_load_the_schema_without_the_repo_root(self) -> None:
        # ⚠ 번들은 **git 추적 파일**로 만든다. `copytree` 로 디렉터리를 통째로
        #   복사하면 로컬에만 있는 것들(`.venv` 40MB, `.pytest_cache`)까지 들어가
        #   느려지고, 무엇보다 **배포가 실제로 받는 것과 달라진다** — Vercel 은
        #   git 체크아웃을 받는다. 다른 것을 재면 이 검사가 무엇을 지키는지 흐려진다.
        tracked = subprocess.run(
            ["git", "-c", "core.quotepath=false", "ls-files", "services/ingest"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout.split()
        self.assertGreater(len(tracked), 5, f"추적 파일이 {len(tracked)}개뿐이다")

        with tempfile.TemporaryDirectory() as tmp:
            # 저장소 루트가 안 보이는 자리에 번들을 만든다
            bundle = Path(tmp) / "deploy" / "ingest"
            for rel in tracked:
                inside = Path(rel).relative_to("services/ingest")
                if inside.parts and inside.parts[0] in EXCLUDED_DIRS:
                    continue  # vercel.json 의 excludeFiles 와 같은 뜻
                target = bundle / inside
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REPO_ROOT / rel, target)
            self.assertFalse(
                (bundle.parents[2] / "schemas").exists(),
                "번들 위에 schemas/ 가 있으면 이 검사가 아무것도 확인하지 못한다",
            )

            probe = (
                "import json, sys\n"
                "from app.two_pass import schema_path, CANONICAL_SCHEMA_PATH, BUNDLED_SCHEMA_PATH\n"
                "assert not CANONICAL_SCHEMA_PATH.exists(), '정본이 번들에 딸려 왔다'\n"
                "path = schema_path()\n"
                "assert path == BUNDLED_SCHEMA_PATH, path\n"
                "schema = json.loads(path.read_text(encoding='utf-8'))\n"
                "assert 'ratio_rules' in schema['required']\n"
                "print('ok')\n"
            )
            result = subprocess.run(
                [sys.executable, "-c", probe],
                cwd=bundle,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertEqual(
                result.returncode,
                0,
                f"번들 안에서 스키마를 못 읽는다 — 배포하면 4중 방어 ②가 프로덕션에서 "
                f"터진다.\nstdout: {result.stdout}\nstderr: {result.stderr}",
            )

    def test_the_bundle_carries_the_entrypoint_vercel_looks_for(self) -> None:
        """Vercel 은 `app/main.py` 의 top-level `app` 을 진입점으로 찾는다."""
        config = json.loads(VERCEL_JSON.read_text(encoding="utf-8"))
        keys = list(config.get("functions", {}))
        self.assertEqual(keys, ["app/main.py"], f"vercel.json 의 함수 키: {keys}")
        entry = INGEST_ROOT / keys[0]
        self.assertTrue(entry.exists(), f"진입점 파일이 없다: {entry}")
        self.assertIn(
            "\napp = FastAPI(",
            entry.read_text(encoding="utf-8"),
            "진입점에 top-level `app` 이 없다 — Vercel 이 ASGI 앱을 못 찾는다",
        )

    def test_the_excludes_do_not_drop_anything_the_runtime_needs(self) -> None:
        """제외 목록이 넓어지면 런타임 파일이 조용히 빠진다."""
        config = json.loads(VERCEL_JSON.read_text(encoding="utf-8"))
        patterns = config["functions"]["app/main.py"]["excludeFiles"]
        for needed in ("app/main.py", "app/two_pass.py", "app/parsing.py", "app/schemas.py"):
            with self.subTest(needed=needed):
                self.assertNotIn(needed, patterns)
        for dropped in EXCLUDED_DIRS:
            with self.subTest(dropped=dropped):
                self.assertIn(dropped, patterns, f"{dropped} 이 제외 목록에서 빠졌다")


class PythonVersionTest(unittest.TestCase):
    def test_the_declared_version_is_one_vercel_supports(self) -> None:
        declared = PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
        self.assertIn(
            declared,
            VERCEL_PYTHON_VERSIONS,
            f"Vercel 파이썬 런타임이 {declared} 를 지원하지 않는다. "
            f"받아 주는 것: {sorted(VERCEL_PYTHON_VERSIONS)} (3.11 은 없다).",
        )

    def test_ci_runs_the_version_we_deploy(self) -> None:
        """다른 버전으로 테스트하면 '선언과 실행이 갈라진' 상태가 된다."""
        declared = PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
        ci = CI_YML.read_text(encoding="utf-8")
        self.assertIn(
            f'python-version: "{declared}"',
            ci,
            f"ci.yml 이 {declared} 로 안 돈다. 배포본과 다른 버전으로 테스트하는 것이다.",
        )


if __name__ == "__main__":
    unittest.main()
