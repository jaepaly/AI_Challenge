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


if __name__ == "__main__":
    unittest.main()
