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
import re
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
        # ⚠ **개행을 정규화해 비교한다.** 두 파일 다 `.gitattributes` 의
        #   `*.json text eol=lf` 를 받아 **인덱스에는 LF 로 같은 바이트**가 들어간다.
        #   그런데 작업본은 브랜치를 오가면 한쪽만 다시 체크아웃돼 CRLF/LF 가 갈릴 수
        #   있다(2026-08-24 실제로 그랬다 — 정본 CRLF 150 / 사본 0). 그 상태는
        #   **커밋에 안 들어가는데** 로컬만 빨간불이 된다. 검사가 이유 없이 흔들리면
        #   다음 사람은 검사를 지운다.
        #
        #   개행 차이를 놓아 주는 대신, **개행 정책이 갈라지는 것**은 아래 검사가 막는다.
        normalize = lambda raw: raw.replace(b"\r\n", b"\n")  # noqa: E731
        self.assertEqual(
            normalize(BUNDLED.read_bytes()),
            normalize(CANONICAL.read_bytes()),
            "번들 사본이 정본과 다르다. **사본을 손으로 고치지 마라** — 정본을 고치고 "
            "`python scripts/sync_bundled_schema.py` 를 돌려라.",
        )

    def test_both_files_get_the_same_line_ending_policy(self) -> None:
        """정본과 사본의 `eol` 속성이 갈라지면 **커밋된 바이트**가 달라진다.

        위 비교가 개행을 정규화하므로, 그 구멍은 여기서 막는다. `data/terms/**` 처럼
        누가 `-text` 를 걸면 한쪽만 CRLF 로 저장되고 배포본이 다른 파일을 싣게 된다.
        """
        def eol_attr(path: Path) -> str:
            out = subprocess.run(
                ["git", "check-attr", "text", "eol", "--", str(path.relative_to(REPO_ROOT))],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            ).stdout
            return "\n".join(sorted(line.split(": ", 1)[1] for line in out.splitlines() if ": " in line))

        self.assertEqual(
            eol_attr(BUNDLED),
            eol_attr(CANONICAL),
            "정본과 번들 사본의 개행 속성이 다르다 — 커밋된 바이트가 갈라진다.",
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
                source = REPO_ROOT / rel
                if not source.exists():
                    # 인덱스에는 있는데 디스크에 없다 = 삭제를 아직 `git add` 안 했다.
                    # 그냥 건너뛰면 번들이 조용히 달라지므로, 무엇을 하라고 말한다.
                    self.fail(
                        f"{rel} 이 인덱스에는 있는데 디스크에 없다 — 삭제를 스테이지하지 "
                        "않았다. `git add -A` 한 뒤 다시 돌려라."
                    )
                target = bundle / inside
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
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


class DeployWorkflowTest(unittest.TestCase):
    """배포 잡이 **어느 디렉터리에서 CLI 를 도는지**를 고정한다.

    `deploy.yml` 은 Git 연동이 아니라 CLI + 토큰으로 배포한다(그 파일 머리글 참조).
    그래서 "프로젝트 루트가 어디인가"는 두 곳에서 정해질 수 있다:

        ① Vercel 대시보드의 Root Directory 설정   ← 저장소에 없다. 어긋나도 아무도 모른다
        ② CLI 를 도는 디렉터리                     ← 이 파일이 지키는 것

    ②로 못 박았다. 최초 링크도 같은 디렉터리에서 하므로 둘이 갈라질 자리가 없다.
    `working-directory` 가 빠지면 repo 루트에서 돌게 되고, 그 순간 ①에 몰래 의존한다.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.text = (REPO_ROOT / ".github" / "workflows" / "deploy.yml").read_text(
            encoding="utf-8"
        )

    def test_the_ingest_job_exists(self) -> None:
        self.assertIn("deploy-ingest:", self.text, "인제스트 배포 잡이 없다")

    def test_every_ingest_cli_step_runs_in_the_service_directory(self) -> None:
        """`vercel` 을 도는 스텝마다 working-directory 가 붙어 있어야 한다."""
        lines = self.text.splitlines()
        start = next(i for i, line in enumerate(lines) if line.strip() == "deploy-ingest:")
        job = lines[start:]

        missing: list[str] = []
        for index, line in enumerate(job):
            if "vercel pull" not in line and "vercel deploy" not in line:
                continue
            # 이 스텝(직전 `- name:` 부터)에 working-directory 가 있는가
            head = index
            while head > 0 and not job[head].lstrip().startswith("- name:"):
                head -= 1
            block = "\n".join(job[head:index])
            if "working-directory: services/ingest" not in block:
                missing.append(job[index].strip()[:60])
        self.assertEqual(
            missing,
            [],
            "working-directory 없이 vercel CLI 를 도는 스텝이 있다:\n  "
            + "\n  ".join(missing)
            + "\n repo 루트에서 돌면 Vercel 대시보드의 Root Directory 설정에 몰래 의존한다.",
        )

    def test_the_ingest_job_skips_without_its_own_secret(self) -> None:
        """Secret 이 없어도 CI 가 빨개지면 안 된다 — 붙이기 전에 머지할 수 있어야 한다."""
        self.assertIn("VERCEL_INGEST_PROJECT_ID", self.text)
        self.assertIn("인제스트 배포 건너뜀", self.text)

    def test_the_web_job_does_not_borrow_the_ingest_project_id(self) -> None:
        """두 잡이 같은 PROJECT_ID 를 쓰면 인제스트가 웹 URL 을 덮는다.

        제출 URL 이 바뀌는 사고라 여기서 막는다(deploy.yml 머리글의 경고와 같은 취지).
        """
        lines = self.text.splitlines()
        split = next(i for i, line in enumerate(lines) if line.strip() == "deploy-ingest:")
        web, ingest = "\n".join(lines[:split]), "\n".join(lines[split:])
        self.assertIn("secrets.VERCEL_PROJECT_ID", web)
        self.assertNotIn("secrets.VERCEL_PROJECT_ID }}", ingest.replace("VERCEL_INGEST_PROJECT_ID", ""))


class WorkflowTimeoutTest(unittest.TestCase):
    """**모든 잡에 `timeout-minutes` 가 있어야 한다.**

    2026-08-24, 이게 없어서 CI 전체가 멈췄다. `vercel` CLI 가 완료되지 않는 배포를
    기다렸고(Vercel Git 연동 때문에 Blocked 였다), 잡은 GitHub 기본값 **6시간**까지
    매달렸다. PR 마다 하나씩 생겨 하루에 8건이 300분 넘게 돌았다 — 합계 2,954분::

        02:43  배포  360.4분      02:58  배포  360.3분  ×2
        03:34  배포  464.8분      04:05  배포  360.3분
        04:19  배포  360.4분      …

    private 저장소 무료 한도가 월 2,000분이다. 소진되자 잡이 아예 안 떴다::

        The job was not started because recent account payments have failed
        or your spending limit needs to be increased.

    ⚠ **근본 원인은 매달린 것이지 타임아웃이 없는 것이 아니다.** 그건 Vercel 쪽에서
      고친다(Git 연동 해제). 타임아웃은 **같은 일이 또 나도 6시간이 아니라 20분에서
      끊기게** 하는 것이다 — 원인을 못 없앤 채로 심사 기간에 들어가지 않기 위해서다.
    """

    #: 잡별 상한(분). 넉넉하되 유한해야 한다 — 정상이면 전부 5분 안쪽이다.
    MAX_MINUTES = 60

    def _jobs(self, path: Path) -> dict[str, str]:
        """워크플로 YAML 에서 잡 이름 → 그 잡의 블록 텍스트.

        pyyaml 을 쓰지 않는다 — 선언 안 된 전이 의존이다(`test_dependency_bounds`
        가 지키는 규약). 잡 키는 `jobs:` 아래 2칸 들여쓰기라 그것으로 자른다.
        """
        text = path.read_text(encoding="utf-8")
        body = text[text.index("\njobs:") :]
        starts = [m for m in re.finditer(r"^  ([A-Za-z][\w-]*):\s*$", body, re.MULTILINE)]
        blocks: dict[str, str] = {}
        for index, match in enumerate(starts):
            end = starts[index + 1].start() if index + 1 < len(starts) else len(body)
            blocks[match.group(1)] = body[match.start() : end]
        return blocks

    def test_every_job_has_a_timeout(self) -> None:
        missing: list[str] = []
        for path in (CI_YML, REPO_ROOT / ".github" / "workflows" / "deploy.yml"):
            jobs = self._jobs(path)
            self.assertGreater(len(jobs), 0, f"{path.name} 에서 잡을 하나도 못 읽었다")
            for name, block in jobs.items():
                if "timeout-minutes:" not in block:
                    missing.append(f"{path.name}:{name}")
        self.assertEqual(
            missing,
            [],
            "timeout-minutes 가 없는 잡: " + ", ".join(missing) + "\n"
            "없으면 GitHub 기본값 6시간이다. 매달린 잡 하나가 무료 한도를 통째로 태운다.",
        )

    def test_timeouts_are_bounded(self) -> None:
        """`timeout-minutes: 360` 같은 값은 타임아웃이 아니다."""
        too_long: dict[str, int] = {}
        for path in (CI_YML, REPO_ROOT / ".github" / "workflows" / "deploy.yml"):
            for name, block in self._jobs(path).items():
                for value in re.findall(r"timeout-minutes:\s*(\d+)", block):
                    if int(value) > self.MAX_MINUTES:
                        too_long[f"{path.name}:{name}"] = int(value)
        self.assertEqual(too_long, {}, f"상한이 너무 길다(>{self.MAX_MINUTES}분): {too_long}")

    def test_deploy_does_not_run_on_every_pull_request(self) -> None:
        """PR 마다 프리뷰 배포를 돌리지 않는다 — 사고의 전량이 거기서 나왔다.

        프리뷰 URL 은 쓰지 않는다(`INGEST_BASE_URL` 은 프로덕션만, 프리뷰는 Deployment
        Protection 으로 SSO 에 막힌다). PR 의 빌드 검증은 `ci.yml` 이 한다.
        손으로 돌려야 하면 `workflow_dispatch` 가 있다.
        """
        text = (REPO_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        trigger = text[text.index("\non:") : text.index("\nconcurrency:")]
        self.assertNotIn(
            "\n  pull_request:",
            trigger,
            "deploy.yml 이 모든 PR 에서 돈다. 프리뷰 배포가 매달리면 그 수만큼 분이 탄다.",
        )
        self.assertIn("workflow_dispatch:", trigger, "손으로 돌릴 길은 남겨 둔다")


class BuilderInputsTest(unittest.TestCase):
    """Vercel 파이썬 빌더가 **무엇을 보고 무엇을 하는지** 고정한다."""

    def test_pyproject_is_absent_or_declares_a_project_table(self) -> None:
        """`pyproject.toml` 이 있으면 `[project]` 가 **반드시** 있어야 한다.

        2026-08-24 배포가 여기서 멈췄다(C 실측)::

            Failed to run "uv lock --python …/.venv/bin/python"
            error: No `project` table found in: /vercel/path0/pyproject.toml

        Vercel 빌더는 `pyproject.toml` 을 보면 PEP 621 프로젝트로 여기고 `uv lock` 을
        돌린다. 우리 파일에는 `[tool.pytest.ini_options]` 뿐이었다.

        그래서 pytest 설정을 `pytest.ini` 로 옮기고 이 파일을 없앴다. 누가 다시 만들면
        **의존성 선언이 두 곳**이 될 위험도 함께 생기므로(아래 검사), 여기서 막는다.
        """
        path = INGEST_ROOT / "pyproject.toml"
        if not path.exists():
            return
        self.assertIn(
            "[project]",
            path.read_text(encoding="utf-8"),
            "pyproject.toml 이 있는데 `[project]` 가 없다 — Vercel 의 `uv lock` 이 거부한다. "
            "pytest 설정만 담을 거라면 pytest.ini 를 써라.",
        )

    def test_dependencies_are_declared_in_exactly_one_place(self) -> None:
        """의존성 정본은 `requirements.txt` 하나다.

        `pyproject.toml` 에 `[project].dependencies` 를 적으면 `test_dependency_bounds`
        (축 A·B)와 `test_lockfile`(CI 설치 경로)이 **그 목록을 못 본다.** 상한이 한쪽에만
        붙어도 아무도 모르는 상태가 된다 — `#71` 이 정확히 그 모양이었다(선언은 있는데
        읽는 설치가 없었다).
        """
        path = INGEST_ROOT / "pyproject.toml"
        if not path.exists():
            return
        self.assertNotIn(
            "dependencies",
            path.read_text(encoding="utf-8"),
            "pyproject.toml 이 의존성을 선언한다 — requirements.txt 와 두 곳이 된다.",
        )

    def test_pytest_config_survives_somewhere(self) -> None:
        """`pythonpath` 가 사라지면 루트에서 돌릴 때 `app` 모듈을 못 찾는다(#26)."""
        candidates = [INGEST_ROOT / "pytest.ini", INGEST_ROOT / "pyproject.toml", INGEST_ROOT / "setup.cfg"]
        found = [c for c in candidates if c.exists() and "pythonpath" in c.read_text(encoding="utf-8")]
        self.assertNotEqual(
            found,
            [],
            "pytest 의 pythonpath 설정이 어디에도 없다 — 리포 루트에서 돌리면 "
            "`ModuleNotFoundError: No module named 'app'` 이 난다(#26).",
        )


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
