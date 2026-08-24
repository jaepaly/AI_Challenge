"""공모전 공식 양식의 절 구조를 고정한다.

README §5-D: **작년 유일한 부적격 사유가 "양식 미작성"** 이다. 그런데 절 제목·순서는
주최측 파일 안에만 있고, 우리는 그걸 사람 눈으로 옮겨 적어 왔다. 옮겨 적은 것이
원본과 어긋나도 아무것도 알려주지 않는다 — `data/terms/README.md`의 한투 sha 가
여덟 달 넘게 틀린 값으로 있던 것과 같은 종류다(#49).

이 검사는 원본 `.hwpx`에서 절 제목을 **직접 뽑아** 우리가 적어 둔 목록과 대조한다.

hwpx 는 XML 을 담은 zip 이고 본문은 `Contents/section0.xml` 의 `<hp:t>` 에 있다.
읽기 전용이므로 한글(HWP)이 없어도 CI 에서 돈다.

⚠ **양식이 갱신되면 이 검사가 깨진다. 그게 의도다.** 주최측이 절을 바꾸면 우리가
쓰던 본문 구조가 통째로 틀리게 되므로, 조용히 지나가면 안 된다. 깨졌을 때 할 일은
목록을 낮추는 것이 아니라 **새 양식을 받아 `data/forms/`를 갱신하고 본문을 맞추는 것**이다.
"""

from __future__ import annotations

from pathlib import Path
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET
import zipfile


REPO_ROOT = Path(__file__).resolve().parents[3]
FORMS_DIR = REPO_ROOT / "data" / "forms"

HWPML_PARAGRAPH = "http://www.hancom.co.kr/hwpml/2011/paragraph"

PLAN_FORM = "(첨부1) 2026 금융 AI Challenge 공모전 기획서.hwpx"
SPEC_FORM = "(첨부2) 2026 금융 AI Challenge 기능명세서.hwpx"

# 우리가 쓰는 초안. 양식이 바뀌면 초안도 함께 깨져야 한다.
PLAN_DRAFT = "submission/attachment1-plan.md"
# 첨부2 는 두 파일로 나뉘어 있다 — §5 를 먼저 쓴 이유는 그 파일 머리말에 적혀 있다.
SPEC_DRAFTS = (
    "submission/attachment2-s1-s4.md",
    "submission/attachment2-s5-verification.md",
)

# 이 파일 자신이 옛 형태(`기획서 4-2`)를 문서화로 담고 있다 — 왜 막는지 적으려면 적어야 한다.
SELF_PATH = "services/ingest/tests/test_submission_forms.py"

# 첨부1 — 1~6 필수(*), 7 자유
PLAN_SECTIONS = [
    "1. 서비스 명칭*",
    "2. 아이디어 기획 핵심내용(요약)*",
    "3. 문제 정의 및 제안 배경*",
    "4. 서비스 컨셉 및 차별성*",
    "5. 활용 데이터 및 생성형 AI 모델 적용 방안*",
    "6. 기대 효과 및 확장 가능성*",
    "7. (자유타이틀 기재)",
]

# 첨부2 — 5절 전부 필수
SPEC_SECTIONS = [
    "1. MVP 구현 범위*",
    "2. 주요 기능 목록*",
    "3. 사용자 이용 흐름*",
    "4. AI 및 데이터 처리 방식*",
    "5. MVP 검증 방법*",
]


def _paragraphs(form: str) -> list[str]:
    """양식 본문의 문단 텍스트를 순서대로 낸다."""
    with zipfile.ZipFile(FORMS_DIR / form) as archive:
        section = archive.read("Contents/section0.xml")
    root = ET.fromstring(section)

    lines: list[str] = []
    for para in root.iter(f"{{{HWPML_PARAGRAPH}}}p"):
        text = "".join(
            run.text or "" for run in para.iter(f"{{{HWPML_PARAGRAPH}}}t")
        ).strip()
        if text:
            lines.append(text)
    return lines


def _numbered_sections(form: str) -> list[str]:
    """`N.` 으로 시작하는 절 제목만, 원본 순서대로.

    표 안에 같은 문자열이 통째로 한 번 더 나오므로(머리 요약 셀) 중복을 접는다.
    """
    seen: list[str] = []
    for line in _paragraphs(form):
        if len(line) > 2 and line[0].isdigit() and line[1] == "." and line not in seen:
            seen.append(line)
    return seen


class SubmissionFormTest(unittest.TestCase):
    def test_both_forms_are_present_and_readable(self) -> None:
        """양식이 저장소 밖에 있으면 누구도 절 구조를 확인할 수 없다."""
        for form in (PLAN_FORM, SPEC_FORM):
            with self.subTest(form=form):
                path = FORMS_DIR / form
                self.assertTrue(path.exists(), f"{form} 이 data/forms 에 없다")
                self.assertTrue(
                    zipfile.is_zipfile(path),
                    f"{form} 이 정상 hwpx(zip)가 아니다 — 내려받기가 깨졌을 수 있다",
                )

    def test_plan_form_sections_match_what_we_recorded(self) -> None:
        self.assertEqual(_numbered_sections(PLAN_FORM), PLAN_SECTIONS)

    def test_spec_form_sections_match_what_we_recorded(self) -> None:
        self.assertEqual(_numbered_sections(SPEC_FORM), SPEC_SECTIONS)

    def test_required_marker_is_the_asterisk(self) -> None:
        """`*` 가 필수 표시다 — 첨부1은 6개, 첨부2는 5개 전부."""
        self.assertEqual(sum(s.endswith("*") for s in PLAN_SECTIONS), 6)
        self.assertEqual(sum(s.endswith("*") for s in SPEC_SECTIONS), 5)
        # 양식 안에 그 규약이 실제로 적혀 있는지도 본다
        for form in (PLAN_FORM, SPEC_FORM):
            with self.subTest(form=form):
                self.assertIn("( * 필수항목)", _paragraphs(form))

    def test_spec_form_demands_an_implementation_status_column(self) -> None:
        """§2가 기능마다 '구현 상태'를 요구하고 §1이 미구현을 금지한다.

        이 둘이 함께 걸려 있다는 사실이 우리 일정의 근거다 — 본문을 W5(8/25~)에
        쓰는 이유가 "그때 동작하는 것만 적을 수 있어서"다. 양식이 이 요구를
        버리면 그 근거도 사라지므로 여기서 본다.
        """
        lines = _paragraphs(SPEC_FORM)
        self.assertTrue(
            any("구현 상태" in line for line in lines),
            "§2의 '구현 상태' 요구가 사라졌다",
        )
        self.assertTrue(
            any("미구현 또는 향후 구현 예정 기능은 제외" in line for line in lines),
            "§1의 미구현 제외 요구가 사라졌다",
        )

    def test_spec_form_is_written_around_the_deployed_url(self) -> None:
        """§3·§5가 배포 URL을 전제로 쓰인다 — 배포는 부록이 아니다."""
        lines = _paragraphs(SPEC_FORM)
        self.assertTrue(any("배포 URL 접속 후" in line for line in lines))
        self.assertTrue(any("배포 URL에서" in line for line in lines))


class PlanDraftCoversTheFormTest(unittest.TestCase):
    """초안이 양식의 절을 실제로 덮는가.

    양식 구조 검사(`test_plan_form_sections_match_what_we_recorded`)는 **주최측이
    바꿨는지**를 본다. 이 검사는 그 다음이다 — **우리가 그 구조대로 썼는지.**
    둘을 갈라 두는 이유는 실패 원인이 다르기 때문이다: 앞은 양식이 갱신된 것이고,
    뒤는 우리가 절을 빠뜨린 것이다.

    ⚠ 내용의 질은 못 본다. **빠진 절이 없는지**만 본다 — 작년 유일한 부적격 사유가
      "양식 미작성"이었고, 그건 기계가 지킬 수 있는 종류다.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.path = REPO_ROOT / PLAN_DRAFT
        cls.text = cls.path.read_text(encoding="utf-8") if cls.path.exists() else ""

    def test_the_draft_exists(self) -> None:
        self.assertTrue(
            self.path.exists(),
            f"{PLAN_DRAFT} 이 없다. 첨부1은 1~6 이 전부 필수라 초안 없이는 제출할 수 없다.",
        )

    def test_every_required_section_appears_verbatim(self) -> None:
        """필수 절(`*`)은 **양식의 제목 그대로** 있어야 한다.

        제목을 바꿔 적으면 심사자가 절을 못 찾는다. 작년 부적격 사유가 그 종류다.
        """
        required = [s for s in PLAN_SECTIONS if s.endswith("*")]
        self.assertEqual(len(required), 6, "첨부1 필수 절은 6개다")
        missing = [s for s in required if s.rstrip("*") not in self.text]
        self.assertEqual(
            missing,
            [],
            f"초안이 덮지 않은 필수 절: {missing}. 양식이 갱신됐다면 초안도 함께 고쳐라.",
        )

    def test_the_free_section_exists_but_its_title_is_ours(self) -> None:
        """7절은 양식이 `(자유타이틀 기재)` 라 제목을 우리가 정한다.

        그래서 제목 정확일치로 보면 안 된다 — 번호만 본다. 비워 두는 것도 양식상
        가능하지만, 우리는 한계를 적는 자리로 쓰기로 했다(§7).
        """
        free = [s for s in PLAN_SECTIONS if not s.endswith("*")]
        self.assertEqual(free, ["7. (자유타이틀 기재)"], "자유 절 구조가 바뀌었다")
        self.assertIn(
            "## 7.",
            self.text,
            "7절이 초안에 없다. 비워 둘 거라면 이 검사를 지우고 왜인지 적어라.",
        )

    def test_references_to_the_draft_point_at_sections_that_exist(self) -> None:
        """저장소가 이 초안의 절을 가리킬 때, **그 절이 실제로 있어야 한다.**

        2026-08-24 까지 두 곳이 존재하지 않는 문서를 절 번호로 참조하고 있었다::

            apps/landing-proto/README.md   "기획서 4-2 표시 순서 규약"
            data/terms/README.md           "기획서 §3-3과 같은 함정"

        `README:6` 이 *"팀 공유 폴더가 정본"* 이라 적어 두었는데 **그 폴더가 없었다.**
        가리키는 곳이 없는 참조는 다음 사람을 같은 자리로 보낸다. 이제 참조가 실재하는
        파일을 가리키므로, **번호까지 실재하는지**를 여기서 지킨다.

        절을 지우거나 번호를 바꾸면 참조가 먼저 빨간불이 된다 — 그게 의도다.
        """
        listing = subprocess.run(
            ["git", "-c", "core.quotepath=false", "ls-files", "--cached", "--others",
             "--exclude-standard"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout
        # 하위 절(`### 4-5.`)과 **최상위 절**(`## 7.`)을 모두 모은다. 최상위를 빼면
        # `§7`(자유 절) 참조가 앵커에 없어 조용히 지나간다(#77 리뷰, A).
        anchors = set(re.findall(r"^### (\d+-\d+)\.", self.text, re.MULTILINE))
        anchors |= set(re.findall(r"^## (\d+)\.", self.text, re.MULTILINE))
        self.assertGreater(len(anchors), 5, f"초안에서 절 앵커를 {len(anchors)}개만 찾았다")

        dangling: list[str] = []
        unmarked: list[str] = []
        for rel in listing.splitlines():
            if not rel or rel in (PLAN_DRAFT, SELF_PATH):
                continue
            try:
                lines = (REPO_ROOT / rel).read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for lineno, line in enumerate(lines, start=1):
                if "attachment1-plan.md" not in line:
                    continue
                for section in re.findall(r"§\s*(\d+(?:-\d+)?)", line):
                    if section not in anchors:
                        dangling.append(f"{rel}:{lineno} → §{section}")
                # ⚠ `§` 없이 쓴 참조도 잡는다. **원래 깨져 있던 것이 그 형태였다** —
                #   `"기획서 4-2 표시 순서 규약"` 에는 `§` 가 없다. `§` 붙은 것만 보면
                #   다음 사람이 같은 문법으로 쓸 때 가드가 침묵한다(#77 리뷰, A).
                #   연도·날짜(`2026-08`)를 피하려고 한두 자리로 좁힌다 — 틀리는 방향이
                #   헛경보여야 하고, 헛경보는 `§` 를 붙이면 바로 사라진다.
                for bare in re.findall(r"(?<![§\d-])(\d{1,2}-\d{1,2})(?![\d-])", line):
                    unmarked.append(f"{rel}:{lineno} → {bare}")

        self.assertEqual(
            dangling,
            [],
            "초안에 없는 절을 가리키는 참조:\n  " + "\n  ".join(dangling) +
            f"\n초안에 있는 절: {sorted(anchors)}",
        )
        self.assertEqual(
            unmarked,
            [],
            "초안을 가리키면서 `§` 없이 절 번호를 적었다:\n  " + "\n  ".join(unmarked) +
            "\n`§` 를 붙여라 — 붙지 않은 번호는 위 검사가 존재 여부를 못 본다.",
        )

    def test_nothing_still_points_at_the_document_that_never_existed(self) -> None:
        """`기획서 N-M` 형태는 **아무 데도 남아 있으면 안 된다.**

        그 문서는 존재한 적이 없다(`README:6` 의 "팀 공유 폴더"는 없는 폴더였다).
        이름이 `submission/attachment1-plan.md` 로 정해졌으므로, 옛 형태가 남아 있으면
        다음 사람을 다시 없는 곳으로 보낸다.

        위 검사와 겹치지 않는다 — 저건 *"가리키는 절이 있는가"* 이고 이건
        *"가리키는 문서가 있는가"* 다.
        """
        listing = subprocess.run(
            ["git", "-c", "core.quotepath=false", "ls-files", "--cached", "--others",
             "--exclude-standard"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout
        stale: list[str] = []
        for rel in listing.splitlines():
            if not rel or rel in (PLAN_DRAFT, SELF_PATH):
                continue
            try:
                lines = (REPO_ROOT / rel).read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for lineno, line in enumerate(lines, start=1):
                if re.search(r"기획서\s*§?\s*\d", line):
                    stale.append(f"{rel}:{lineno}  {line.strip()[:70]}")
        self.assertEqual(
            stale,
            [],
            "존재한 적 없는 문서를 절 번호로 가리킨다:\n  " + "\n  ".join(stale) +
            "\n`submission/attachment1-plan.md` §N-M 으로 적어라.",
        )

    def test_the_draft_does_not_claim_the_upload_route_works(self) -> None:
        """배포본에 없는 기능을 제출물이 있다고 말하지 않는지 본다.

        2026-08-23 실측으로 `POST /api/ingest` 는 404 다(README §8). 인제스트
        파이프라인은 저장소 안에서 돌지만 어디에도 배포돼 있지 않다. 이 구분이
        흐려지면 심사자가 배포본을 열어 대조할 때 어긋난다.
        """
        self.assertIn(
            "배포돼 있지 않다",
            self.text,
            "초안이 인제스트 미배포 사실을 적지 않는다 — §7 한계 목록을 확인하라.",
        )


class SpecDraftCoversTheFormTest(unittest.TestCase):
    """첨부2 초안이 **양식의 다섯 절을 다 덮는지** 본다.

    `PlanDraftCoversTheFormTest` 와 같은 이유다 — 작년 유일한 부적격 사유가 "양식
    미작성"이었고 그건 기계가 지킬 수 있는 종류다. 첨부1 에만 그 가드가 있고 첨부2 에는
    없었다(2026-08-24). **없는 쪽이 더 위험했다**: 첨부2 는 5절이 **전부 필수**인데
    그중 §5 하나만 쓰여 있었다.

    ⚠ 내용의 질은 못 본다. 빠진 절이 없는지, 그리고 양식이 이름으로 요구한 것
      (§2 의 네 열, §3 의 배포 URL)이 있는지만 본다.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.paths = [REPO_ROOT / rel for rel in SPEC_DRAFTS]
        cls.text = "\n".join(
            path.read_text(encoding="utf-8") for path in cls.paths if path.exists()
        )

    def test_the_drafts_exist(self) -> None:
        missing = [rel for rel, path in zip(SPEC_DRAFTS, self.paths) if not path.exists()]
        self.assertEqual(
            missing,
            [],
            f"첨부2 초안이 없다: {missing}. 5절이 전부 필수라 초안 없이는 제출할 수 없다.",
        )

    def test_every_required_section_appears_verbatim(self) -> None:
        """다섯 절 제목이 **양식 그대로** 있어야 한다 — 두 파일에 나뉘어 있어도 된다.

        제목을 바꿔 적으면 심사자가 절을 못 찾는다. 첨부2 는 `*` 가 다섯 개 전부라
        하나라도 빠지면 그 자체로 부적격 사유다.
        """
        required = [s.rstrip("*") for s in SPEC_SECTIONS]
        self.assertEqual(len(required), 5, "첨부2 필수 절은 5개다")
        missing = [s for s in required if s not in self.text]
        self.assertEqual(
            missing,
            [],
            f"초안이 덮지 않은 필수 절: {missing}. 양식이 갱신됐다면 초안도 함께 고쳐라.",
        )

    # ── 표를 실제로 들여다보기 위한 보조 ──────────────────────────────────
    #
    # 부분문자열 검사는 **문서가 자기 산문으로 자기 검사를 만족시키는** 사고를 낸다.
    # 아래 둘은 §2 의 마크다운 표를 행 단위로 집어 그 사고를 막는다.

    def _feature_table_header(self) -> str:
        """§2 기능 표의 머리행. 못 찾으면 그 자체가 실패다."""
        for line in self.text.splitlines():
            stripped = line.strip()
            if stripped.startswith("|") and "기능명" in stripped:
                return stripped
        self.fail("§2 에서 '기능명' 을 머리로 갖는 표를 못 찾았다 — 표 구조가 바뀌었다")

    def _feature_rows(self) -> list[str]:
        """머리행 다음의 데이터 행들. 구분행(`|---|`)과 빈 줄은 뺀다."""
        lines = self.text.splitlines()
        header = self._feature_table_header()
        start = next(i for i, line in enumerate(lines) if line.strip() == header)
        rows: list[str] = []
        for line in lines[start + 1 :]:
            stripped = line.strip()
            if not stripped.startswith("|"):
                break
            if set(stripped) <= set("|- :"):
                continue  # 구분행
            rows.append(stripped)
        return rows

    def _draft_containing(self, needle: str) -> str:
        """`needle` 이 든 초안 **하나**의 본문. 합친 텍스트로 보면 다른 파일이 대신 만족시킨다."""
        for path in self.paths:
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            if needle in text:
                return text
        self.fail(f"어느 초안에도 {needle!r} 가 없다")

    def test_the_feature_table_carries_the_four_columns_the_form_demands(self) -> None:
        """§2 가 요구하는 것은 기능 목록이 아니라 **네 열**이다.

        양식 원문: *"기능명, 기능 설명, 관련 화면, 구현 상태 작성"*. 이 중 **구현 상태**
        가 빠지면 §1 의 *"미구현 또는 향후 구현 예정 기능은 제외"* 와 짝이 안 맞는다 —
        읽는 사람이 어느 것이 실제로 도는지 알 수 없다.

        ⚠ **본문 전체가 아니라 표의 머리행만 본다.** 처음엔 전체에서 부분문자열로 찾았는데,
          초안 산문에 *"기능명 · 기능 설명 · 관련 화면 · 구현 상태"* 라는 설명 한 줄이 있어
          **표에서 열을 지워도 검사가 초록이었다.** 검사가 자기 문서의 다른 문장에 속은
          것이다. 머리행으로 좁혀야 표를 실제로 지킨다.
        """
        header = self._feature_table_header()
        for column in ("기능명", "기능 설명", "관련 화면", "구현 상태"):
            with self.subTest(column=column):
                self.assertIn(
                    column,
                    header,
                    f"§2 표의 머리행에 '{column}' 열이 없다 — 양식이 이름으로 요구한다.\n"
                    f"머리행: {header}",
                )

    def test_the_flow_section_names_the_deployed_url(self) -> None:
        """§3 은 **배포 URL 을 연 심사자**를 상대로 쓰는 절이다.

        양식 원문이 *"사용자가 배포 URL 접속 후"* 다. URL 이 없으면 그 절은 읽는 사람이
        따라 할 수 없다.

        ⚠ **§3 이 있는 파일에서만 본다.** 두 초안을 합쳐서 보면 §5 쪽 URL 이 대신
          만족시켜 준다 — 그러면 §3 에서 URL 을 지워도 초록이다.
        """
        text = self._draft_containing("3. 사용자 이용 흐름")
        self.assertIn(
            "https://marginguard-web.vercel.app",
            text,
            "§3 이 배포 URL 을 적지 않는다 — 양식이 그 URL 접속을 전제로 쓰라고 요구한다.",
        )

    def test_undeployed_features_are_not_marked_done(self) -> None:
        """배포에 없는 기능을 §2 가 **완료로 적지 않는지** 본다.

        2026-08-24 실측: 배포는 `d218501` 로 main 보다 커밋 11개 뒤였고, 그래서
        `POST /api/ingest` 가 404 였다 — 업로드 화면 자체가 배포본에 없었다. 그 상태에서
        §2 가 업로드를 "완료"로 적으면 심사자가 배포본을 열어 대조할 때 어긋난다.

        ⚠ 이 검사는 **배포 상태를 재지 않는다**(네트워크를 쓰지 않는다). 초안이 그
          구분을 지키는지만 본다. 배포가 따라잡히면 그 행을 완료로 바꾸게 되고 이 검사가
          **그때 넘어진다** — 그게 의도다. 넘어지면 배포를 실제로 확인한 뒤 이 검사를
          지우고 왜인지 적어라. 지우는 것이 곧 "이제 배포됐다"는 선언이다.
        """
        rows = [row for row in self._feature_rows() if "업로드" in row]
        self.assertTrue(rows, "§2 에 업로드 기능 행이 없다 — 표 구조가 바뀌었다")
        claimed = [row for row in rows if "완료" in row]
        self.assertEqual(
            claimed,
            [],
            "배포되지 않은 업로드 기능이 §2 에서 '완료' 로 적혀 있다:\n"
            + "\n".join(claimed),
        )


if __name__ == "__main__":
    unittest.main()
