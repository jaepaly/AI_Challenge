import base64
from pathlib import Path
from types import SimpleNamespace
import unittest

from benchmarks.path_comparison import PDF_TEXT_FACTS
from benchmarks.raw_pdf_comparison import (
    DEFAULT_MAX_TOKENS,
    RAW_PDF_INPUT_TOKENS,
    build_document_message,
    build_dry_run_plan,
    estimate_max_cost_krw,
    extract_page_citations,
    run_comparison,
)


REPO_ROOT = Path(__file__).resolve().parents[3]


class FakeMessages:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        document = kwargs["messages"][0]["content"][0]
        filename = document["title"]
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
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[{"type": "text", "text": "근거", "citations": citations}],
            usage={
                "input_tokens": 10,
                "cache_creation_input_tokens": 20,
                "cache_read_input_tokens": 0,
                "output_tokens": 5,
            },
        )


class FakeClient:
    def __init__(self) -> None:
        self.messages = FakeMessages()


class RawPdfComparisonTest(unittest.TestCase):
    def test_document_message_uses_pdf_citations_and_cache_control(self) -> None:
        fixture = Path(__file__)
        content = build_document_message(fixture)

        document = content[0]
        self.assertEqual(document["source"]["type"], "base64")
        self.assertEqual(document["source"]["media_type"], "application/pdf")
        self.assertEqual(
            base64.standard_b64decode(document["source"]["data"]),
            fixture.read_bytes(),
        )
        self.assertEqual(document["citations"], {"enabled": True})
        self.assertEqual(document["cache_control"], {"type": "ephemeral"})

    def test_dry_run_makes_no_network_request_and_reports_cost_ceiling(self) -> None:
        plan = build_dry_run_plan(REPO_ROOT)

        self.assertEqual(plan["status"], "dry_run")
        self.assertEqual(plan["network_requests"], 0)
        self.assertEqual(plan["max_tokens_per_document"], 8192)
        self.assertEqual(plan["thinking"], "disabled")
        self.assertEqual(len(plan["documents"]), 5)
        self.assertGreater(plan["estimated_max_cost_krw"], 0)
        self.assertNotIn("ANTHROPIC_API_KEY", str(plan["documents"]))

    def test_cost_guard_rejects_before_any_api_call(self) -> None:
        client = FakeClient()
        with self.assertRaisesRegex(ValueError, "승인 한도"):
            run_comparison(
                REPO_ROOT,
                client=client,
                approved_max_krw=0,
            )

        self.assertEqual(client.messages.calls, [])

    def test_fake_api_citations_recover_all_pdf_facts(self) -> None:
        client = FakeClient()
        ceiling = estimate_max_cost_krw(
            RAW_PDF_INPUT_TOKENS,
            max_tokens=DEFAULT_MAX_TOKENS,
        )

        result = run_comparison(
            REPO_ROOT,
            client=client,
            approved_max_krw=ceiling,
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["recovered"], 13)
        self.assertEqual(result["verbatim_recovered"], 13)
        self.assertEqual(result["missing_fact_ids"], [])
        self.assertEqual(result["saturated_document_count"], 0)
        self.assertEqual(len(client.messages.calls), 5)
        self.assertEqual(result["usage"]["cache_creation_input_tokens"], 100)
        for call in client.messages.calls:
            self.assertNotIn("temperature", call)
            self.assertEqual(call["thinking"], {"type": "disabled"})
            self.assertEqual(call["timeout"], 120.0)
        self.assertTrue(
            all(document["stop_reason"] == "end_turn" for document in result["documents"])
        )

    def test_non_page_citation_is_rejected(self) -> None:
        message = SimpleNamespace(
            content=[
                {
                    "type": "text",
                    "text": "근거",
                    "citations": [
                        {
                            "type": "char_location",
                            "cited_text": "140%",
                            "start_char_index": 0,
                            "end_char_index": 4,
                        }
                    ],
                }
            ]
        )

        with self.assertRaisesRegex(ValueError, "page_location"):
            extract_page_citations(message)


if __name__ == "__main__":
    unittest.main()
