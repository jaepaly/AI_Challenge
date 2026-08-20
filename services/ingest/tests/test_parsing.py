import unittest
from hashlib import sha256
from pathlib import Path

from app.parsing import (
    _HTMLTextParser,
    _normalize_html_text,
    parse_document,
    parse_document_bytes,
    parse_pdf_text,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
HANKOOK_TERMS = REPO_ROOT / "data/terms/한국투자_신용거래설명서_20260707.htm"
MERITZ_TERMS = REPO_ROOT / "data/terms/메리츠_신용거래설명서_20250421.pdf"


class HankookHTMLSpikeTest(unittest.TestCase):
    def test_table_rows_and_cells_survive_whitespace_normalization(self) -> None:
        html = """
        <p>문장   공백</p>
        <table>
          <tr>
            <th><p>항목</p></th>
            <th><p>값</p></th>
          </tr>
          <tr>
            <td><p>담보 <strong>유지</strong></p></td>
            <td><p>140%</p></td>
          </tr>
        </table>
        """

        parser = _HTMLTextParser()
        parser.feed(html)
        text = _normalize_html_text(parser.parts)

        self.assertEqual(text, "문장 공백\n항목\t값\n담보 유지\t140%")

    def test_html_rejects_reserved_structural_sentinels(self) -> None:
        for injected in ("\x1d", "\x1e", "\x1f"):
            with self.subTest(injected=repr(injected)):
                parser = _HTMLTextParser()
                with self.assertRaisesRegex(ValueError, "구조 센티널"):
                    parser.feed(f"<p>정상{injected}가짜 셀</p>")

    def test_numeric_control_reference_cannot_create_structural_boundary(self) -> None:
        parser = _HTMLTextParser()
        parser.feed("<p>정상&#30;가짜 셀</p>")

        self.assertNotIn("\x1e", "".join(parser.parts))
        self.assertEqual(_normalize_html_text(parser.parts), "정상가짜 셀")

    def test_key_terms_survive_html_parsing(self) -> None:
        document = parse_document(HANKOOK_TERMS)
        text = document.units[0].text

        self.assertEqual(document.source_type, "html")
        self.assertEqual(document.units[0].locator, "document")
        self.assertEqual(
            document.flattened_sha256,
            sha256(text.encode("utf-8")).hexdigest(),
        )
        self.assertEqual(len(document.flattened_sha256 or ""), 64)
        self.assertGreater(document.table_count, 0)
        self.assertIn("\n", text)
        self.assertIn("\t", text)
        self.assertIn("최저담보유지비율 140%", text)
        self.assertIn("전일종가(8,100원) 대비 15% 하락한 가격(6,890원)", text)
        self.assertIn("195주 반대매매 필요", text)
        self.assertIn(
            "날짜\t주식가격\t계좌평가금액\t담보평가비율\t비고",
            text,
        )
        self.assertIn(
            "D일 장중\t10,000원\t10,000,000원\t167%",
            text,
        )
        self.assertIn(
            "D+2일\t6,150원\t6,150,000원\t103%\t추가담보 미납(225만원 담보부족)",
            text,
        )
        self.assertEqual(text.count("\t"), 228)
        self.assertEqual(sum("\t" in line for line in text.splitlines()), 108)

    def test_key_terms_survive_pypdf_text_parsing(self) -> None:
        document = parse_pdf_text(MERITZ_TERMS)
        text = document.units[0].text

        self.assertEqual(document.source_type, "text")
        self.assertEqual(document.units[0].locator, "document")
        self.assertEqual(
            document.flattened_sha256,
            sha256(text.encode("utf-8")).hexdigest(),
        )
        self.assertIn("전일 종가 대비 20% 할인/할증된 가격", text)
        self.assertIn("309주 반대매매 필요", text)

    def test_parse_document_dispatches_pdf_to_text_path(self) -> None:
        self.assertEqual(parse_document(MERITZ_TERMS).source_type, "text")

    def test_parse_document_bytes_matches_path_parser(self) -> None:
        from_path = parse_document(HANKOOK_TERMS)
        from_bytes = parse_document_bytes(HANKOOK_TERMS.read_bytes(), ".htm")

        self.assertEqual(from_bytes, from_path)


if __name__ == "__main__":
    unittest.main()
