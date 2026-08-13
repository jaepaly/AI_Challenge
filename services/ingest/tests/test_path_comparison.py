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

    def test_raw_pdf_result_records_measured_recall_and_selects_pypdf(self) -> None:
        result = self.comparison["raw_pdf_document"]

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["transport"], "message_batches")
        self.assertEqual(len(result["documents"]), 5)
        self.assertEqual(result["recovered"], 8)
        self.assertEqual(result["total"], 13)
        self.assertEqual(result["verbatim_recovered"], 6)
        self.assertEqual(
            result["missing_fact_ids"],
            [
                "meritz-required-309",
                "mirae-required-195",
                "shinhan-grade-discounts",
                "kiwoom-unpaid-lower-limit",
                "kiwoom-next-open",
            ],
        )
        self.assertLess(result["actual_cost_krw"], result["approved_max_cost_krw"])
        self.assertIn("pypdf_text", self.comparison["branch_decision"]["pdf"])


if __name__ == "__main__":
    unittest.main()
