from pathlib import Path
import unittest

from app.parsing import parse_document


REPO_ROOT = Path(__file__).resolve().parents[3]
HANKOOK_TERMS = REPO_ROOT / "data/terms/한국투자_신용거래설명서_20260707.htm"


class HankookHTMLSpikeTest(unittest.TestCase):
    def test_key_terms_survive_html_parsing(self) -> None:
        document = parse_document(HANKOOK_TERMS)
        text = document.units[0].text

        self.assertEqual(document.source_type, "html")
        self.assertEqual(document.units[0].locator, "document")
        self.assertGreater(document.table_count, 0)
        self.assertIn("최저담보유지비율 140%", text)
        self.assertIn("전일종가(8,100원) 대비 15% 하락한 가격(6,890원)", text)
        self.assertIn("195주 반대매매 필요", text)


if __name__ == "__main__":
    unittest.main()
