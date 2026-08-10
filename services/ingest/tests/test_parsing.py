import unittest
from hashlib import sha256
from pathlib import Path

from app.parsing import _HTMLTextParser, _normalize_html_text, parse_document


REPO_ROOT = Path(__file__).resolve().parents[3]
HANKOOK_TERMS = REPO_ROOT / "data/terms/한국투자_신용거래설명서_20260707.htm"


class HankookHTMLSpikeTest(unittest.TestCase):
    def test_table_rows_and_cells_survive_whitespace_normalization(self) -> None:
        html = """
        <p>문장   공백</p>
        <table>
          <tr><th>항목</th><th>값</th></tr>
          <tr><td>담보 유지</td><td>140%</td></tr>
        </table>
        """

        parser = _HTMLTextParser()
        parser.feed(html)
        text = _normalize_html_text(parser.parts)

        self.assertEqual(text, "문장 공백\n항목\t값\n담보 유지\t140%")

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


if __name__ == "__main__":
    unittest.main()
