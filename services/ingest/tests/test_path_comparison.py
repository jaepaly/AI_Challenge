import unittest
from copy import deepcopy
from pathlib import Path

from benchmarks.path_comparison import _pdf_branch_decision, compare_local_paths


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

    def test_2048_result_is_preserved_as_truncated_evidence(self) -> None:
        result = self.comparison["raw_pdf_document"]

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["transport"], "message_batches")
        self.assertEqual(result["max_tokens_per_document"], 2048)
        self.assertEqual(result["saturated_document_count"], 5)
        self.assertEqual(result["measurement_status"], "truncated_output_limit")
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
        for document in result["documents"]:
            self.assertEqual(document["stop_reason"], "max_tokens")
            self.assertEqual(
                document["stop_reason_source"],
                "inferred_from_output_tokens_equal_max_tokens",
            )
            self.assertTrue(document["output_limit_reached"])
            self.assertEqual(document["usage"]["output_tokens"], 2048)

    def test_untruncated_8192_result_controls_the_branch_decision(self) -> None:
        result = self.comparison["raw_pdf_document_untruncated"]

        self.assertEqual(result["status"], "completed_summary")
        self.assertEqual(result["max_tokens_per_document"], 8192)
        self.assertEqual(result["thinking"], "disabled")
        self.assertEqual(result["saturated_document_count"], 0)
        self.assertEqual(result["recovered"], 13)
        self.assertEqual(result["total"], 13)
        self.assertEqual(result["verbatim_recovered"], 9)
        for document in result["documents"]:
            self.assertLess(document["output_tokens"], 8192)
            self.assertFalse(document["output_limit_reached"])

        decision = self.comparison["branch_decision"]
        self.assertIn("pypdf_text", decision["pdf"])
        self.assertIn("재현율은 13/13 동률", decision["pdf"])
        self.assertIn("축자는 11/13 대 9/13", decision["pdf"])
        self.assertIn("비용", decision["pdf"])
        self.assertIn("flattened_sha256", decision["pdf"])
        self.assertEqual(
            decision["pdf_conditions"]["raw_pdf_document"]["source_commit"],
            "20489104b87d045673b666bdd26cc0c80dd3d90d",
        )

    def test_branch_decision_refuses_a_saturated_result(self) -> None:
        raw_pdf_result = deepcopy(
            self.comparison["raw_pdf_document_untruncated"]
        )
        raw_pdf_result["documents"][0]["output_tokens"] = 8192
        raw_pdf_result["documents"][0]["output_limit_reached"] = True
        raw_pdf_result["saturated_document_count"] = 1

        decision = _pdf_branch_decision(
            self.results["pypdf_text"], raw_pdf_result
        )

        self.assertEqual(
            decision,
            "pending: 출력 상한에 닿은 결과로는 경로 분기를 결정하지 않음",
        )


if __name__ == "__main__":
    unittest.main()
