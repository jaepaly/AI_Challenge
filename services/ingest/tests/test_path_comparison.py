import unittest
from pathlib import Path

from benchmarks.path_comparison import compare_local_paths


REPO_ROOT = Path(__file__).resolve().parents[3]


class PathComparisonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.comparison = compare_local_paths(REPO_ROOT)
        cls.results = {
            result["path"]: result for result in cls.comparison["results"]
        }

    def test_html_flatten_recovers_all_fixed_facts_with_table_delimiters(self) -> None:
        result = self.results["html_flatten"]

        self.assertEqual(result["recovered"], 6)
        self.assertEqual(result["total"], 6)
        self.assertEqual(result["rate"], 1.0)
        self.assertEqual(result["missing_fact_ids"], ())
        self.assertEqual(result["verbatim_recovered"], 6)
        self.assertEqual(result["verbatim_rate"], 1.0)
        self.assertEqual(result["verbatim_missing_fact_ids"], ())
        self.assertEqual(result["delimiter_count"], 263)
        self.assertEqual(result["delimiter_rows"], 115)

    def test_benchmark_records_the_measured_environment(self) -> None:
        environment = self.comparison["environment"]

        self.assertEqual(environment["html_documents"], 2)
        self.assertEqual(environment["pdf_documents"], 5)
        self.assertTrue(environment["pypdf_version"])

    def test_pypdf_recovers_fixed_facts_but_not_explicit_cell_delimiters(self) -> None:
        result = self.results["pypdf_text"]

        self.assertEqual(result["recovered"], 13)
        self.assertEqual(result["total"], 13)
        self.assertEqual(result["rate"], 1.0)
        self.assertEqual(result["missing_fact_ids"], ())
        self.assertEqual(result["verbatim_recovered"], 11)
        self.assertAlmostEqual(result["verbatim_rate"], 11 / 13)
        self.assertEqual(len(result["verbatim_missing_fact_ids"]), 2)
        self.assertEqual(result["delimiter_count"], 0)
        self.assertEqual(result["delimiter_rows"], 0)

    def test_raw_pdf_claim_is_backed_by_a_real_run(self) -> None:
        """원래 이 테스트는 '안 돌린 경로를 돌렸다고 주장하지 마라'였다.

        2026-08-13에 실제로 돌렸으므로 가드를 없애지 않고 옮긴다 — 이제는
        '주장이 있으면 근거가 함께 있어야 한다'를 지킨다. status만 completed로
        바꾸고 측정값 없이 통과하는 경로를 막는 것이 이 테스트의 일이다.
        """
        raw = self.comparison["raw_pdf_document"]
        self.assertEqual(raw["status"], "completed")

        # 근거: 문서 5건 각각이 sha와 사용량을 달고 있어야 한다.
        self.assertEqual(len(raw["documents"]), 5)
        for document in raw["documents"]:
            self.assertEqual(len(document["document_sha256"]), 64)
            self.assertGreater(document["usage"]["output_tokens"], 0)
            # 상한에 닿은 응답은 잘린 것이고, 잘린 재현율은 재현율이 아니다.
            # 첫 실행(max_tokens=2048)에서 5건 전부 정확히 상한에서 끝나
            # 9/13으로 보였다. 8192에서 13/13이 됐다.
            self.assertLess(document["usage"]["output_tokens"], 8192)

        self.assertEqual(raw["recovered"], raw["total"])

        # 결과가 생겼으므로 분기 결정이 더 이상 보류가 아니어야 한다.
        decision = self.comparison["branch_decision"]["pdf"]
        self.assertNotIn("pending", decision)
        self.assertIn("pypdf_text", decision)


if __name__ == "__main__":
    unittest.main()
