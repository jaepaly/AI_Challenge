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
# 이스케이프를 소스에 쓰지 않는다 — 이 파일을 스크립트로 고칠 때 백슬래시가
# 뭉개져 두 번 사고가 났다(2026-08-25·26, test_deployable.py 와 같은 이유).
NEWLINE = chr(10)
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

    def test_the_draft_still_names_what_the_deployed_url_cannot_do(self) -> None:
        """제출물이 배포본보다 **많이 약속하지 않는지** 본다.

        ⚠ 이 검사는 2026-08-26 에 **판정 대상을 바꿨다.** 그전에는
          *"«배포돼 있지 않다» 가 초안에 있는가"* 를 봤다 — `POST /api/ingest` 가
          404 이던 시절의 사실이다. 그날 배포가 붙었고 **배포 URL 로 업로드를 끝까지
          돌렸다**(200 · 31.3초 · 카드 `한국투자증권 · status=draft`). 그래서 그 문장은
          **적으면 안 되는 문장**이 됐다.

          문장 하나를 다른 문장으로 바꿔 고정하면 같은 일이 또 난다. 그래서 지금은
          **«못 하는 것 목록이 살아 있는가»** 만 본다 — 목록의 내용은 사실이 바뀔 때마다
          손으로 고치되, **목록 자체가 사라지는 것**은 기계가 막는다.

        ⚠ **한계 목록이 비면 그것이 사고다.** 이 제품은 *"모르는 것을 모른다고 말한다"* 를
          파는데, 기획서에서 그러지 않으면 그 주장이 성립하지 않는다(§7 머리말이 그렇게
          적고 있다).
        """
        self.assertIn(
            "지금 못 하는 것",
            self.text,
            "§7 의 «지금 못 하는 것» 절이 사라졌다 — 한계를 적는 것이 이 제품의 주장이다.",
        )
        # ⚠ **절 경계에서 끊는다.** `self.text[start:]` 로 문서 끝까지 세면 «§7 의 항목»
        #   이 아니라 «그 지점 이후 아무 데나 있는 `- ` 줄» 을 센다. 지금 초록인 이유는
        #   §7 이 **마침 마지막 절이기 때문**이고, 뒤에 절이 하나 붙는 순간 그 전제가
        #   깨진다 — A 가 뮤테이션으로 보였다(§7 을 비우고 부록 절을 붙이면 18 passed).
        #   제출 12일 전이고 첨부1 은 아직 손보는 중이라 충분히 있을 법한 변경이다.
        start = self.text.index("지금 못 하는 것")
        section = self.text[start:]
        end = section.find(NEWLINE + "## ")
        if end != -1:
            section = section[:end]
        items = [line for line in section.splitlines() if line.startswith("- ")]
        self.assertGreaterEqual(
            len(items),
            4,
            f"«지금 못 하는 것» 이 {len(items)}개뿐이다. 항목이 줄었다면 그것이 "
            f"**사실이 바뀌어서인지 지운 것인지** 확인하라 — 지운 것이면 되돌려라.",
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

    # ── `test_undeployed_features_are_not_marked_done` 은 2026-08-26 지웠다 ──────
    #
    # 그 검사는 *"배포에 없는 기능을 §2 가 «완료» 로 적지 않는지"* 를 봤고, 문서주석에
    # 이렇게 적어 두었다::
    #
    #     배포가 따라잡히면 그 행을 완료로 바꾸게 되고 이 검사가 **그때 넘어진다**.
    #     그게 의도다. 넘어지면 배포를 실제로 확인한 뒤 이 검사를 지우고 왜인지
    #     적어라. **지우는 것이 곧 «이제 배포됐다»는 선언이다.**
    #
    # 그날이 왔다. 지우는 근거는 **문서가 아니라 배포 URL 실측**이다 — 심사위원과 같은
    # 경로(브라우저가 보내는 UTF-8 multipart)로 한국투자 원문을 올렸다::
    #
    #     POST https://marginguard-web.vercel.app/api/ingest   ->  200 · 31.3초
    #       파싱 21.6ms · 1패스 17.6s · 2패스 12.4s · claude-sonnet-5
    #       카드  broker=한국투자증권  status=draft
    #             ratio 전체 1.4 [5252:5272] html · disposal prev_close_pct 0.15
    #             근거 스팬 3개 · 중복 0 · 좌표계 character
    #
    # ⚠ **같은 실측에서 4중 방어 ①이 프로덕션에서 도는 것도 확인했다.** 122바이트
    #   발췌를 먼저 올리니 *"역할별 최소 native citation이 부족합니다"* 로 거부했다.
    #   «200 이 나온다» 와 «아무거나 받아 준다» 는 다른 말이고, 둘 다 확인했다.
    #
    # 이 자리를 비워 두는 대신 주석으로 남기는 이유는, 다음 사람이 «업로드가 완료로
    # 적혀 있는데 그걸 지키는 검사가 없네» 로 읽지 않게 하기 위해서다. 지금 그 행을
    # 지키는 것은 검사가 아니라 **위 실측**이고, 배포가 다시 깨지면 검사가 아니라
    # `/api/ingest` 가 먼저 말한다(§5 ①의 심사 절차가 그것을 두드린다).

TERMS_README = REPO_ROOT / "data" / "terms" / "README.md"
PLAN = REPO_ROOT / "submission" / "attachment1-plan.md"

NEWLINE = chr(10)
INDENT = NEWLINE + "  "


def _table_rows(text: str, after: str) -> list[list[str]]:
    """`after` 뒤 첫 표의 **데이터 행만** 낸다.

    ⚠ 구분선(`|---|`) **뒤**부터 모은다. 머리행을 «파일명» 으로 세면 검사가 자기가
    읽은 제목을 데이터로 착각한다 — 실제로 처음에 `파일 = 판본` 을 한 건으로 셌다.
    """
    if after not in text:
        return []
    rows: list[list[str]] = []
    seen_separator = False
    for line in text.split(after, 1)[1].splitlines():
        line = line.strip()
        if not line.startswith("|"):
            if seen_separator:
                break
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and cells[0] and set(cells[0]) <= set("-:"):
            seen_separator = True
            continue
        if seen_separator and cells and cells[0]:
            rows.append(cells)
    return rows


class PlanCitesTheSameDocumentsTest(unittest.TestCase):
    """제출문(첨부1 §5-1)이 정본(`data/terms/README.md`)과 같은 판본을 가리키는가.

    한국투자 원문이 2026-08-25 개정되어 카드를 현행본으로 옮겼는데, 첨부1 §5-1 표는
    **개정 전 판본만** 적고 있었다. 재추출 PR 이 닫힐 때까지 아무것도 알려주지 않았다 —
    사람이 눈으로 옮겨 적은 표라서다.

    `test_current_edition_is_cited` 가 **코드**를 현행본에 묶었고, 이 검사는 **제출문**을
    같은 정본에 묶는다. 심사자가 읽는 것은 저장소가 아니라 제출문이다.
    """

    def _canonical(self) -> dict[str, str]:
        rows = _table_rows(TERMS_README.read_text(encoding="utf-8"), "| 파일 |")
        out: dict[str, str] = {}
        for cells in rows:
            name = cells[0].strip("`").strip()
            if "." not in name:
                continue
            out[name.rsplit(".", 1)[0]] = cells[1].strip("*").strip()
        return out

    def _plan(self) -> dict[str, str]:
        rows = _table_rows(PLAN.read_text(encoding="utf-8"), "### 5-1.")
        return {
            cells[0].strip("`").strip(): cells[1].strip("*").strip()
            for cells in rows
            if len(cells) >= 2
        }

    def test_the_plan_lists_every_document_we_keep(self) -> None:
        """정본에 있는 문서는 제출문 표에도 있어야 한다."""
        canonical, plan = self._canonical(), self._plan()
        self.assertTrue(canonical, "정본 표를 읽지 못했다 — 이 검사가 무엇도 안 보고 있다")
        self.assertTrue(plan, "첨부1 §5-1 표를 읽지 못했다 — 이 검사가 무엇도 안 보고 있다")
        missing = sorted(set(canonical) - set(plan))
        self.assertFalse(
            missing,
            "정본(`data/terms/README.md`)에 있는데 첨부1 §5-1 표에 없다:"
            + INDENT + INDENT.join(missing),
        )

    def test_the_plan_does_not_invent_documents(self) -> None:
        """제출문이 정본에 없는 문서를 적지 않는다."""
        canonical, plan = self._canonical(), self._plan()
        extra = sorted(k for k in plan if k not in canonical)
        self.assertFalse(
            extra,
            "첨부1 §5-1 표에는 있는데 정본에 없다:" + INDENT + INDENT.join(extra),
        )

    def test_the_current_edition_is_marked_current_in_both(self) -> None:
        """정본이 **현행**이라 한 것을 제출문도 **현행**이라 해야 한다.

        목록에 들어 있는 것만으로는 부족하다 — 보존본을 현행으로 적으면 심사자가
        없어진 판본을 받아적는다.
        """
        canonical, plan = self._canonical(), self._plan()
        wrong = [
            "{0}: 정본={1} / 첨부1={2}".format(k, v, plan[k])
            for k, v in canonical.items()
            if k in plan and ("현행" in v) != ("현행" in plan[k])
        ]
        self.assertFalse(
            wrong, "판본 표시가 정본과 어긋난다:" + INDENT + INDENT.join(wrong)
        )


PASTE_DIR = REPO_ROOT / "submission" / "paste"
TAB = chr(9)


class PasteCopyStaysPasteableTest(unittest.TestCase):
    """붙여넣기 원고가 «붙여넣을 수 있는» 상태로 남는가.

    최종 제출물은 `.hwpx` 양식을 채운 PDF 다. 초안은 마크다운이라 그대로 붙이면
    `**굵게**` · `| 표 |` · 코드펜스가 **기호 그대로** 나온다. 그걸 9/7 아침에
    손으로 지우게 되면 그때가 제일 틀리기 쉬운 시점이다.

    ⚠ 이 검사는 **문체를 보지 않는다.** 한글에 붙였을 때 깨지는 것만 본다.
    """

    #: 한글에 그대로 붙으면 기호가 글자로 나오는 것들.
    MARKDOWN = (
        ("**", "굵게 표시"),
        ("```", "코드펜스"),
        ("~~", "취소선"),
    )

    def _paste_files(self) -> list[Path]:
        return sorted(PASTE_DIR.glob("*.txt"))

    def test_every_required_section_has_a_paste_file(self) -> None:
        """양식의 절마다 붙여넣을 원고가 하나씩 있어야 한다.

        절이 늘거나(주최측이 양식을 고치면) 원고가 빠지면 여기서 걸린다.
        """
        have = {p.stem for p in self._paste_files()}
        want = {"첨부1-{0}".format(i) for i in range(1, len(PLAN_SECTIONS) + 1)}
        want |= {"첨부2-{0}".format(i) for i in range(1, len(SPEC_SECTIONS) + 1)}
        self.assertTrue(have, "붙여넣기 원고가 하나도 없다 — 이 검사가 무엇도 안 본다")
        self.assertFalse(
            sorted(want - have),
            "양식에 절이 있는데 붙여넣을 원고가 없다:"
            + INDENT + INDENT.join(sorted(want - have)),
        )

    def test_no_markdown_survives_into_the_paste_copy(self) -> None:
        """마크다운 기호가 원고에 남아 있지 않다."""
        found: list[str] = []
        for path in self._paste_files():
            text = path.read_text(encoding="utf-8")
            for token, label in self.MARKDOWN:
                if token in text:
                    found.append("{0}: {1} ({2})".format(path.name, label, token))
            for line in text.splitlines():
                if line.startswith("|"):
                    found.append("{0}: 표를 파이프로 그렸다".format(path.name))
                    break
        self.assertFalse(
            found, "한글에 붙이면 기호가 글자로 나온다:" + INDENT + INDENT.join(found)
        )

    def test_every_table_marker_is_followed_by_tabs(self) -> None:
        """`[표]` 다음 줄은 **탭으로 나뉜** 데이터여야 한다.

        한글의 «표로 변환»이 탭을 기준으로 자른다. 표시만 있고 탭이 없으면
        심사 전날 표가 한 덩어리 문단으로 들어간다.
        """
        broken: list[str] = []
        for path in self._paste_files():
            lines = path.read_text(encoding="utf-8").splitlines()
            for i, line in enumerate(lines):
                if not line.startswith("[표]"):
                    continue
                nxt = lines[i + 1] if i + 1 < len(lines) else ""
                if TAB not in nxt:
                    broken.append("{0}:{1} 다음 줄에 탭이 없다".format(path.name, i + 1))
        self.assertFalse(
            broken, "[표] 표시가 탭 데이터를 안 데리고 있다:" + INDENT + INDENT.join(broken)
        )


INGEST_ROUTE = REPO_ROOT / "apps" / "web" / "app" / "api" / "ingest" / "route.ts"
SPEC_S5 = REPO_ROOT / "submission" / "attachment2-s5-verification.md"
PASTE_S5 = PASTE_DIR / "첨부2-5.txt"


class DocsMatchWhatTheCodeDoesTest(unittest.TestCase):
    """제출문이 적은 사실이 코드·정본과 어긋나지 않는가.

    아래 둘은 C 가 `#102` 리뷰에서 **손으로** 찾아낸 것들이다. 둘 다 기계가 볼 수
    있는 종류였는데 아무 검사도 안 보고 있었다.

        문서 "우리 상한을 넘으면 400"      코드 `route.ts` 는 413 을 낸다
        정본 "한국투자 현행본(2026-0265호)"  0265 는 **보존본** 번호다

    ⚠ 두 번째는 `PlanCitesTheSameDocumentsTest` 가 못 잡았다 — 그 검사는 정본의
    **첫 표**만 읽고, 이 오류는 같은 파일 **아래쪽 표**에 있었다. 검사가 어디까지
    보는지를 검사 자신이 말해 주지 않는다는 것을 여기 적어 둔다.
    """

    #: `심사필 제2026-0265호` · `심의필 제25-125호` 에서 숫자 토큰만.
    EDITION_TOKEN = re.compile(r"[0-9]{2,4}-[0-9]{3,5}")

    def test_the_docs_quote_the_status_the_code_returns(self) -> None:
        """상한 초과 응답 코드를 문서가 코드에서 베껴 적는다."""
        source = INGEST_ROUTE.read_text(encoding="utf-8")
        head = source.split("file.size > MAX_UPLOAD_BYTES", 1)
        self.assertEqual(len(head), 2, "route.ts 에서 상한 검사를 못 찾았다")
        found = re.search(r"status:\s*(\d{3})", head[1])
        self.assertIsNotNone(found, "상한 검사 뒤에서 status 를 못 찾았다")
        status = found.group(1)

        wrong: list[str] = []
        for path in (SPEC_S5, PASTE_S5):
            for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if "우리 상한을 넘으면" in line and status not in line:
                    wrong.append("{0}:{1}  코드는 {2}".format(path.name, no, status))
        self.assertFalse(
            wrong,
            "상한 초과 응답 코드가 코드와 다르게 적혀 있다:" + INDENT + INDENT.join(wrong),
        )

    def test_no_table_row_calls_a_preserved_edition_current(self) -> None:
        """정본의 어느 표에서도 **보존본**을 «현행»이라 부르지 않는다.

        ⚠ 표 행(`|` 로 시작)만 본다. 산문은 옛 판본을 **이야기할** 수 있어야 한다.
        """
        text = TERMS_README.read_text(encoding="utf-8")
        preserved: set[str] = set()
        for cells in _table_rows(text, "| 파일 |"):
            if len(cells) >= 3 and "보존" in cells[1]:
                preserved |= set(self.EDITION_TOKEN.findall(cells[2]))
        self.assertTrue(preserved, "보존본 판본 번호를 못 읽었다 — 이 검사가 무엇도 안 본다")

        wrong = [
            "{0}행: {1}".format(no, token)
            for no, line in enumerate(text.splitlines(), 1)
            if line.startswith("|") and "현행" in line
            for token in preserved
            if token in line
        ]
        self.assertFalse(
            wrong,
            "보존본 번호를 «현행»이라 적은 표 행:" + INDENT + INDENT.join(wrong),
        )

FILLED_DIR = REPO_ROOT / "submission" / "filled"

#: 붙여넣기 원고와 양식의 짝. 원고의 문장이 양식 안에 있으면 원본을 채운 것이다.
PASTE_PREFIX = {PLAN_FORM: "첨부1-", SPEC_FORM: "첨부2-"}

#: 이 길이 아래는 대조에 쓰지 않는다 — "한 줄" 같은 짧은 머리말이 우연히 겹친다.
DISTINCTIVE = 30


def _paragraphs_at(path: Path) -> list[str]:
    """`_paragraphs` 와 같은데 `data/forms/` 밖의 파일도 읽는다."""
    with zipfile.ZipFile(path) as archive:
        section = archive.read("Contents/section0.xml")
    lines: list[str] = []
    for para in ET.fromstring(section).iter(f"{{{HWPML_PARAGRAPH}}}p"):
        text = "".join(
            run.text or "" for run in para.iter(f"{{{HWPML_PARAGRAPH}}}t")
        ).strip()
        if text:
            lines.append(text)
    return lines


class FilledFormIsSubmittableTest(unittest.TestCase):
    """채운 양식이 그대로 PDF 로 나가도 되는가.

    `data/forms/` 는 **주최측 배포 원본**이다(`data/terms/` 의 약관과 같은 취급).
    한글로 열어 채우면 그 자리에서 덮어써지는데, 그러면 둘을 한꺼번에 잃는다.

        ① 주최측이 양식을 고쳤는지 대조할 기준
        ② `SubmissionFormTest` 가 보는 절 구조 — §7 은 자유 제목이라 채우면 깨진다

    2026-08-29 드라이런에서 실제로 그렇게 됐다(②가 빨간불이 됐다). 채운 것은
    `submission/filled/` 에 두고 원본은 되돌린다.
    """

    def test_the_pristine_forms_are_byte_identical_to_git(self) -> None:
        """`data/forms/` 는 **바이트 그대로**여야 한다 — 어떤 편집이든 잡는다.

        ⚠ **이것은 로컬 가드다.** CI 는 항상 깨끗한 체크아웃이라 여기서 안 걸린다.
          한글로 원본을 여는 것은 사람의 기계에서 일어나므로 그 자리에서 잡는다.
        """
        changed = subprocess.run(
            ["git", "-c", "core.quotepath=false", "status", "--porcelain", "--", "data/forms"],
            cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout.strip()
        self.assertFalse(
            changed,
            "data/forms/ 원본이 바뀌었다 — 주최측 배포본이라 손대지 않는다."
            + NEWLINE + "`git checkout -- data/forms/` 로 되돌리고 "
            "채운 것은 submission/filled/ 에서 작업하라." + NEWLINE + changed,
        )

    def test_no_form_contains_its_own_paste_copy(self) -> None:
        """양식마다 **자기 붙여넣기 원고**의 문장이 들어가 있지 않다.

        ⚠ 처음엔 첨부1 §1 의 한 문장만 들고 **두 양식 다** 에 대고 있었다. 그러면
          첨부2 를 채워도 통과한다 — A 가 `#104` 리뷰에서 인메모리 탐침으로 잡았다.
          `SubmissionFormTest` 도 못 받친다: 첨부2 원고에는 `숫자.` 로 시작하는 줄이
          하나도 없어서 절 구조가 그대로 남는다.

        그래서 짝을 맞춰 본다 — 첨부1 은 `첨부1-*.txt`, 첨부2 는 `첨부2-*.txt`.
        커밋된 양식까지 보므로 CI 에서도 돈다(위 git 검사와 역할이 다르다).
        """
        for form, prefix in PASTE_PREFIX.items():
            with self.subTest(form=form):
                wanted = {
                    line.strip()
                    for path in PASTE_DIR.glob(prefix + "*.txt")
                    for line in path.read_text(encoding="utf-8").splitlines()
                    if len(line.strip()) >= DISTINCTIVE
                }
                self.assertTrue(
                    wanted, "{0} 짝 원고에서 대조할 문장을 못 골랐다".format(prefix)
                )
                found = sorted(wanted & set(_paragraphs(form)))
                self.assertFalse(
                    found,
                    "{0} 에 {1} 원고 문장이 들어 있다 — 원본을 채웠다:".format(form, prefix)
                    + INDENT + INDENT.join(found[:3]),
                )

    def test_no_paste_instruction_survives_into_the_filled_form(self) -> None:
        """`[표] …` 안내 줄이 남아 있으면 그대로 PDF 에 인쇄된다.

        원고(`submission/paste/`)에 일부러 넣은 표시라 한글이 지워 주지 않는다.
        표로 변환한 **뒤에** 사람이 지워야 하고, 안 지우면 심사자가 우리 작업
        지시를 읽는다.

        ⚠ **채운 양식은 저장소에 없다** — 한글로 편집 중인 이진 파일이라 커밋하면
          매 저장마다 갈아엎힌다. 그래서 파일이 없으면 이 검사는 **건너뛴다.**
          «통과» 로 세지 않는 이유는, 검사가 아무것도 안 보고 있을 때 그 사실이
          보여야 하기 때문이다.
        """
        forms = sorted(FILLED_DIR.glob("*.hwpx")) if FILLED_DIR.exists() else []
        if not forms:
            self.skipTest("submission/filled/ 에 채운 양식이 없다 — 한글 작업 전이다")

        left: list[str] = []
        for path in forms:
            for no, text in enumerate(_paragraphs_at(path), 1):
                if text.startswith("[표]"):
                    left.append("{0}  문단 {1}".format(path.name, no))
        self.assertFalse(
            left,
            "채운 양식에 붙여넣기 안내가 남아 있다 — 표로 변환한 뒤 지워라:"
            + INDENT + INDENT.join(left),
        )


if __name__ == "__main__":
    unittest.main()
