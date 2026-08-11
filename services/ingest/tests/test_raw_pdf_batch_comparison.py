from pathlib import Path
from types import SimpleNamespace
import unittest

from benchmarks.path_comparison import PDF_TEXT_FACTS
from benchmarks.raw_pdf_batch_comparison import (
    actual_batch_cost_krw,
    build_batch_dry_run_plan,
    build_batch_requests,
    collect_batch,
    estimate_batch_max_cost_krw,
    submit_batch,
)
from benchmarks.raw_pdf_comparison import RAW_PDF_INPUT_TOKENS


REPO_ROOT = Path(__file__).resolve().parents[3]


class FakeBatches:
    def __init__(self) -> None:
        self.create_calls: list[dict] = []
        self.retrieve_calls: list[tuple] = []
        self.results_calls: list[tuple] = []
        self.processing_status = "ended"

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return SimpleNamespace(id="batch_test", processing_status="in_progress")

    def retrieve(self, *args, **kwargs):
        self.retrieve_calls.append((args, kwargs))
        return SimpleNamespace(
            processing_status=self.processing_status,
            request_counts={
                "processing": 0 if self.processing_status == "ended" else 5,
                "succeeded": 5 if self.processing_status == "ended" else 0,
                "errored": 0,
                "canceled": 0,
                "expired": 0,
            },
        )

    def results(self, *args, **kwargs):
        self.results_calls.append((args, kwargs))
        files = sorted({fact.source_file for fact in PDF_TEXT_FACTS})
        for index, filename in enumerate(files, start=1):
            facts = [fact for fact in PDF_TEXT_FACTS if fact.source_file == filename]
            citations = [
                {
                    "type": "page_location",
                    "cited_text": fact.expected_text,
                    "start_page_number": 1,
                    "end_page_number": 2,
                    "document_index": 0,
                    "document_title": filename,
                }
                for fact in facts
            ]
            yield {
                "custom_id": f"pdf-{index:02d}",
                "result": {
                    "type": "succeeded",
                    "message": {
                        "content": [
                            {"type": "text", "text": "근거", "citations": citations}
                        ],
                        "usage": {
                            "input_tokens": RAW_PDF_INPUT_TOKENS[filename],
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 0,
                            "output_tokens": 10,
                        },
                    },
                },
            }


class FakeClient:
    def __init__(self) -> None:
        self.messages = SimpleNamespace(batches=FakeBatches())


class RawPdfBatchComparisonTest(unittest.TestCase):
    def test_batch_cost_ceiling_is_below_1500_won(self) -> None:
        ceiling = estimate_batch_max_cost_krw(
            RAW_PDF_INPUT_TOKENS,
            max_tokens=2048,
        )

        self.assertEqual(ceiling, 877.08)
        self.assertLess(ceiling, 1500)

    def test_dry_run_has_no_network_and_no_cache_writes(self) -> None:
        plan = build_batch_dry_run_plan(REPO_ROOT)

        self.assertEqual(plan["status"], "dry_run")
        self.assertEqual(plan["network_requests"], 0)
        self.assertEqual(plan["cache_control"], "disabled_distinct_documents")
        self.assertEqual(len(plan["documents"]), 5)

    def test_batch_requests_keep_pdf_citations_but_omit_cache_control(self) -> None:
        requests, mapping = build_batch_requests(REPO_ROOT)

        self.assertEqual(len(requests), 5)
        self.assertEqual(len(mapping), 5)
        for request in requests:
            document = request["params"]["messages"][0]["content"][0]
            self.assertEqual(document["citations"], {"enabled": True})
            self.assertNotIn("cache_control", document)

    def test_cost_guard_rejects_before_batch_submission(self) -> None:
        client = FakeClient()

        with self.assertRaisesRegex(ValueError, "Batch 예상 최대"):
            submit_batch(
                REPO_ROOT,
                client=client,
                approved_max_krw=500,
            )

        self.assertEqual(client.messages.batches.create_calls, [])

    def test_submit_then_collect_recovers_all_facts(self) -> None:
        client = FakeClient()
        submission = submit_batch(
            REPO_ROOT,
            client=client,
            approved_max_krw=1500,
        )
        result = collect_batch(
            REPO_ROOT,
            client=client,
            submission=submission,
        )

        self.assertEqual(submission["batch_id"], "batch_test")
        self.assertEqual(len(client.messages.batches.create_calls), 1)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["recovered"], 13)
        self.assertEqual(result["verbatim_recovered"], 13)
        self.assertEqual(result["missing_fact_ids"], [])
        self.assertLess(result["actual_cost_krw"], 1500)

    def test_pending_batch_does_not_fetch_results(self) -> None:
        client = FakeClient()
        submission = submit_batch(
            REPO_ROOT,
            client=client,
            approved_max_krw=1500,
        )
        client.messages.batches.processing_status = "in_progress"

        result = collect_batch(
            REPO_ROOT,
            client=client,
            submission=submission,
        )

        self.assertEqual(result["status"], "pending")
        self.assertEqual(client.messages.batches.results_calls, [])

    def test_actual_cost_uses_batch_discount(self) -> None:
        cost = actual_batch_cost_krw(
            {
                "input_tokens": 1_000_000,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
                "output_tokens": 0,
            }
        )

        self.assertEqual(cost, 2250.0)


if __name__ == "__main__":
    unittest.main()
