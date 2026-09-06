# -*- coding: utf-8 -*-
"""제출 hwpx 를 **다시 만들 수 있는가** — 그리고 만든 것이 온전한가.

2026-09-02 까지 채운 양식은 손으로 만든 것이었고, 그래서 세 번 틀렸다.

    ① 표 안내 줄 `[표] …` 이 그대로 남아 PDF 에 인쇄될 상태였다
    ② 문단 속성 없이 넣어 절마다 vertpos 가 겹쳐 글자가 포개졌다
    ③ §7 «(자유타이틀 기재)» 자리를 안 바꾸고 본문에 제목을 더 붙여 «7.» 이 둘이 됐다

셋 다 «사람이 한글에서 한 일» 이라 되돌리거나 확인할 방법이 없었다. 그래서
`submission/build_hwpx.py` 로 **원본 양식 + `submission/paste/` 원고에서 생성**하게
바꿨고, 이 검사가 그 생성을 CI 에서 돌린다.

⚠ **양식이 갱신되면 이 검사가 깨진다. 그게 의도다.** 삽입 위치를 문단 번호로 잡으므로
주최측이 지시문을 한 줄 늘리면 어긋난다. 깨졌을 때 할 일은 번호를 맞추는 것이고,
그때 본문도 함께 봐야 한다.

⚠ 결과물(`.hwpx`)은 저장소에 두지 않는다 — 한글 편집 중 이진 파일이라 저장마다
통째로 갈아엎힌다(`submission/filled/README.md`). 이 검사는 **임시 폴더에** 만든다.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "submission"))

NEWLINE = chr(10)
INDENT = NEWLINE + "  "


class HwpxBuilderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import os

        import build_hwpx

        cls.cwd = os.getcwd()
        os.chdir(REPO_ROOT)
        cls.tmp = tempfile.mkdtemp(prefix="hwpx-")
        cls.tables = build_hwpx.build_all(cls.tmp)
        cls.files = sorted(Path(cls.tmp).glob("*.hwpx"))

    @classmethod
    def tearDownClass(cls) -> None:
        import os
        import shutil

        os.chdir(cls.cwd)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _section(self, path: Path) -> str:
        with zipfile.ZipFile(path) as z:
            return z.read("Contents/section0.xml").decode("utf-8")

    def test_both_forms_are_generated(self) -> None:
        self.assertEqual(len(self.files), 2, "양식 두 개가 나와야 한다")

    def test_the_xml_parses(self) -> None:
        """깨진 XML 은 한글이 아예 안 연다."""
        for path in self.files:
            with self.subTest(form=path.name):
                ET.fromstring(self._section(path))

    def test_every_table_is_self_consistent(self) -> None:
        """`rowCnt`/`colCnt` 가 실제 `<hp:tr>`/`<hp:tc>` 수와 맞는가.

        ⚠ 양식 자신의 표는 병합 셀(`colSpan`)을 쓰므로 `tc != 행×열` 이다.
          우리가 만든 표만 본다 — id 를 1.5e9 부터 쓴다.
        """
        wrong: list[str] = []
        for path in self.files:
            body = self._section(path)
            for m in re.finditer(
                r'<hp:tbl id="(\d+)"[^>]*rowCnt="(\d+)"[^>]*colCnt="(\d+)"', body
            ):
                if int(m.group(1)) < 1_500_000_000:
                    continue
                seg = body[m.start() : body.find("</hp:tbl>", m.start())]
                rows, cols = int(m.group(2)), int(m.group(3))
                tr = len(re.findall(r"<hp:tr>", seg))
                tc = len(re.findall(r"<hp:tc\b", seg))
                if tr != rows or tc != rows * cols:
                    wrong.append(
                        "{0} {1}행{2}열: tr={3} tc={4}".format(
                            path.name, rows, cols, tr, tc
                        )
                    )
        self.assertFalse(wrong, "표가 자기 선언과 다르다:" + INDENT + INDENT.join(wrong))

    def test_column_widths_add_up_to_the_table_width(self) -> None:
        """칸 폭 합이 표 너비와 다르면 한글이 마지막 열을 잘라 그린다."""
        wrong: list[str] = []
        for path in self.files:
            body = self._section(path)
            for m in re.finditer(r'<hp:tbl id="(\d+)"[^>]*colCnt="(\d+)"', body):
                if int(m.group(1)) < 1_500_000_000:
                    continue
                seg = body[m.start() : body.find("</hp:tbl>", m.start())]
                total = int(re.search(r'<hp:sz width="(\d+)"', seg).group(1))
                first = [
                    int(v) for v in re.findall(r'<hp:cellSz width="(\d+)"', seg)
                ][: int(m.group(2))]
                if sum(first) != total:
                    wrong.append(
                        "{0}: 폭합 {1} / 표 {2}".format(path.name, sum(first), total)
                    )
        self.assertFalse(wrong, "칸 폭 합이 표 너비와 다르다:" + INDENT + INDENT.join(wrong))

    def test_no_paste_instruction_reaches_the_form(self) -> None:
        """`[표] …` 안내는 원고에만 있어야 한다 — 양식에 들어가면 인쇄된다."""
        for path in self.files:
            with self.subTest(form=path.name):
                self.assertNotIn("[표]", self._section(path))

    def test_the_free_title_replaces_the_placeholder(self) -> None:
        """§7 은 자리를 **바꾸는** 것이다 — 제목을 하나 더 붙이면 «7.» 이 둘이 된다."""
        plan = [p for p in self.files if p.name.startswith("(첨부1)")][0]
        body = self._section(plan)
        self.assertNotIn("(자유타이틀 기재)", body, "자유 제목 자리를 안 바꿨다")
        heads = re.findall(r"<hp:t>(7\. [^<]*)</hp:t>", body)
        self.assertEqual(len(heads), 1, "«7.» 로 시작하는 제목이 둘 이상이다: {0}".format(heads))

    def test_one_extra_paragraph_in_the_form_stops_the_build(self) -> None:
        """양식에 문단이 **하나** 늘면 생성이 **멈춰야** 한다.

        🔴 처음엔 번호만 보고 «범위 안이면 통과» 였다. 그래서 양식에 문단이 늘어도
           생성이 **성공하고** 원고가 앞 칸으로 밀렸다 — 그러고도 XML·표·`[표]`·§7·
           들여쓰기 검사가 **전부 통과했다.** A 가 `#105` 에서 탐침으로 증명했다.

        *"양식이 갱신되면 이 검사가 깨진다"* 고 적어 놓고 **fail-open** 이었다.
        조용히 잘못된 제출물을 만드는 경로였고, 그게 제일 나쁜 종류다.

        이제 앵커가 **가리키는 문단의 텍스트까지** 확인하고 어긋나면 `FormChanged` 로
        멈춘다. 이 검사가 그 멈춤을 지킨다.
        """
        import os
        import shutil

        import build_hwpx

        for tag, anchors in build_hwpx.FORMS:
            with self.subTest(form=tag):
                name = [
                    n for n in os.listdir("data/forms") if n.startswith("(%s)" % tag)
                ][0]
                work = tempfile.mkdtemp(prefix="hwpx-drift-")
                try:
                    hurt = Path(work) / name
                    src = Path("data/forms") / name
                    with zipfile.ZipFile(src) as zin:
                        items = [(i, zin.read(i.filename)) for i in zin.infolist()]
                    with zipfile.ZipFile(hurt, "w") as z:
                        for info, data in items:
                            if info.filename == "Contents/section0.xml":
                                body = data.decode("utf-8")
                                # 첫 앵커보다 **앞**에 문단 하나를 끼운다
                                first = anchors[0][0]
                                spans = [
                                    m.end()
                                    for m in re.finditer(
                                        r"<hp:p\b.*?</hp:p>", body, re.S
                                    )
                                ]
                                cut = spans[first - 1]
                                body = (
                                    body[:cut]
                                    + '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" '
                                    'pageBreak="0" columnBreak="0" merged="0">'
                                    '<hp:run charPrIDRef="16"><hp:t>주최측이 끼운 '
                                    "안내 한 줄</hp:t></hp:run></hp:p>"
                                    + body[cut:]
                                )
                                data = body.encode("utf-8")
                            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                            zi.compress_type = info.compress_type
                            z.writestr(zi, data)

                    with self.assertRaises(
                        build_hwpx.FormChanged,
                        msg="양식에 문단이 늘었는데 생성이 성공했다 — "
                        "원고가 앞 칸으로 조용히 밀린다",
                    ):
                        build_hwpx.build(
                            str(hurt), anchors, str(Path(work) / "out.hwpx")
                        )
                finally:
                    shutil.rmtree(work, ignore_errors=True)

    def test_indentation_is_a_paragraph_property(self) -> None:
        """들여쓰기가 **선행 공백**이 아니라 문단 속성으로 들어가야 한다.

        처음 이 검사는 *"`<hp:t>` 가 공백으로 시작하면 안 된다"* 였는데 **틀렸다.**
        칸 맞춤 블록(`paraPr=3`)은 공통 들여쓰기만 벗기고 **안쪽 정렬을 일부러
        남긴다** — 전부 벗기면 `우리 상한   4,194,304` 의 열이 무너진다.

        재는 것은 이것이다: **들여쓰기 0 단계(`paraPr=0`) 문단이 공백으로 들여써져
        있으면 안 된다.** 그게 처음의 결함(전부 한 종류 + 공백 들여쓰기)의 모양이다.
        """
        for path in self.files:
            with self.subTest(form=path.name):
                body = self._section(path)
                flat = re.findall(
                    r'<hp:p id="0" paraPrIDRef="0"[^>]*>'
                    r'<hp:run charPrIDRef="\d+"><hp:t>( +)[^<]',
                    body,
                )
                self.assertFalse(
                    flat,
                    "들여쓰기 0 단계인데 공백으로 들여쓴 문단 %d개 — "
                    "문단 속성을 써야 한다" % len(flat),
                )
                used = set(re.findall(r'<hp:p id="0" paraPrIDRef="(\d+)"', body))
                self.assertTrue(
                    {"2", "3"} & used,
                    "들여쓰기 단계를 하나도 안 썼다 — 전부 한 종류면 구조가 없다",
                )


if __name__ == "__main__":
    unittest.main()
