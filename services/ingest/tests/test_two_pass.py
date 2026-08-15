import copy
import asyncio
from hashlib import sha256
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import anthropic
from fastapi.testclient import TestClient
import httpx

from app.main import app, get_ingest_service
from app.parsing import parse_document
from app.two_pass import _REVIEW_NO_PATTERN, TwoPassIngestService, prompt_sha256


REPO_ROOT = Path(__file__).resolve().parents[3]
HANKOOK_TERMS = REPO_ROOT / "data/terms/한국투자_신용거래설명서_20260707.htm"


def _usage(input_tokens: int, output_tokens: int, *, cache_write: int = 0, cache_read: int = 0):
    return SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_creation_input_tokens=cache_write,
        cache_read_input_tokens=cache_read,
    )


def _citation(text: str, quote: str):
    start = text.index(quote)
    return SimpleNamespace(
        type="char_location",
        start_char_index=start,
        end_char_index=start + len(quote),
        cited_text=quote,
        document_index=0,
        document_title=HANKOOK_TERMS.name,
    )


class FakeMessages:
    def __init__(
        self,
        pass1,
        card: dict[str, object],
        *,
        pass2_stop_reason: str = "end_turn",
    ):
        self.pass1 = pass1
        self.card = card
        self.pass2_stop_reason = pass2_stop_reason
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            return self.pass1
        return SimpleNamespace(
            stop_reason=self.pass2_stop_reason,
            content=[SimpleNamespace(type="text", text=json.dumps(self.card, ensure_ascii=False))],
            usage=_usage(1200, 700),
        )


class FakeAnthropicClient:
    def __init__(
        self,
        pass1,
        card: dict[str, object],
        *,
        pass2_stop_reason: str = "end_turn",
    ):
        self.messages = FakeMessages(
            pass1,
            card,
            pass2_stop_reason=pass2_stop_reason,
        )


class TwoPassIngestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = HANKOOK_TERMS.read_bytes()
        cls.document = parse_document(HANKOOK_TERMS)
        cls.text = cls.document.units[0].text
        cls.ratio_quote = "최저담보유지비율 140%"
        cls.discount_quote = "전일종가(8,100원) 대비 15% 하락한 가격(6,890원)"
        cls.review_quote = "한국투자증권 소비자보호 총괄책임자 심사필 제2026-0265(2026-07-03)"

    def setUp(self) -> None:
        citations = [
            _citation(self.text, self.ratio_quote),
            _citation(self.text, self.discount_quote),
            _citation(self.text, self.review_quote),
        ]
        self.pass1 = SimpleNamespace(
            stop_reason="end_turn",
            content=[
                SimpleNamespace(
                    type="text",
                    text="필요한 규칙의 원문 근거입니다.",
                    citations=citations,
                )
            ],
            usage=_usage(43000, 500, cache_write=42900),
        )
        ratio_evidence = self._evidence(self.ratio_quote)
        discount_evidence = self._evidence(self.discount_quote)
        self.card = {
            "broker": "한국투자증권",
            "ratio_rules": [
                {
                    "product_type": "신용융자",
                    "collateral_type": "주식",
                    "symbol_group": "전체",
                    "ratio": 1.4,
                    "evidence": ratio_evidence,
                }
            ],
            "account_aggregation": "max",
            "disposal_price_rules": [
                {
                    "trigger": "담보부족 미해소",
                    "symbol_group": "전체",
                    "discount_basis": "prev_close_pct",
                    "discount_rate": 0.15,
                    "source_confidence": "explicit",
                    "evidence": discount_evidence,
                }
            ],
            "execution_schedule": [
                {
                    "threshold_ratio": 1.4,
                    "day_counting": "추가담보 납부기한 경과 후",
                    "evidence": ratio_evidence,
                }
            ],
            "ratio_source": "clause",
            "status": "draft",
        }

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _evidence(self, quote: str) -> dict[str, object]:
        start = self.text.index(quote)
        return {
            "source_format": "html",
            "char_start": start,
            "char_end": start + len(quote),
            "flattened_sha256": self.document.flattened_sha256,
            "quote": quote,
        }

    def _post(
        self,
        card: dict[str, object] | None = None,
        pass1=None,
        *,
        pass2_stop_reason: str = "end_turn",
    ):
        fake = FakeAnthropicClient(
            pass1 or self.pass1,
            card or self.card,
            pass2_stop_reason=pass2_stop_reason,
        )
        service = TwoPassIngestService(fake)
        app.dependency_overrides[get_ingest_service] = lambda: service
        response = TestClient(app).post(
            "/ingest",
            files={"file": (HANKOOK_TERMS.name, self.raw, "text/html")},
        )
        return response, fake

    def test_hankook_runs_two_passes_and_returns_valid_draft_card(self) -> None:
        response, fake = self._post()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "draft")
        self.assertEqual(
            response.json()["disposal_price_rules"][0]["discount_rate"], 0.15
        )
        self.assertEqual(
            response.json()["doc_version"], {"review_no": "2026-0265"}
        )
        self.assertEqual(len(fake.messages.calls), 2)
        self.assertEqual(response.headers["x-ingest-model"], "claude-sonnet-5")
        self.assertEqual(response.headers["x-ingest-pass1-input-tokens"], "43000")
        self.assertEqual(response.headers["x-ingest-pass1-cache-write-tokens"], "42900")
        self.assertIn("x-ingest-pass1-ms", response.headers)
        self.assertIn("x-ingest-pass2-ms", response.headers)

    def test_first_pass_uses_citations_cache_and_no_sampling_parameters(self) -> None:
        response, fake = self._post()
        self.assertEqual(response.status_code, 200, response.text)

        request = fake.messages.calls[0]
        document = request["messages"][0]["content"][0]
        self.assertEqual(document["source"]["type"], "text")
        self.assertEqual(document["source"]["data"], self.text)
        self.assertEqual(document["citations"], {"enabled": True})
        self.assertEqual(
            document["cache_control"], {"type": "ephemeral", "ttl": "5m"}
        )
        self.assertEqual(request["thinking"], {"type": "disabled"})
        self.assertNotIn("temperature", request)

    def test_second_pass_uses_only_citation_catalog_and_structured_output(self) -> None:
        response, fake = self._post()
        self.assertEqual(response.status_code, 200, response.text)

        request = fake.messages.calls[1]
        content = request["messages"][0]["content"]
        self.assertNotIn(self.text, content)
        self.assertIn(self.ratio_quote, content)
        self.assertNotIn("citations", request)
        schema = request["output_config"]["format"]["schema"]
        self.assertEqual(schema["properties"]["status"]["enum"], ["draft"])
        self.assertNotIn("PageEvidenceSpan", schema["$defs"])
        self.assertNotIn("doc_version", schema["properties"])
        self.assertNotIn("doc_version", schema["required"])

    def test_prompts_distinguish_maintenance_ratio_from_valuation_ratio(self) -> None:
        response, fake = self._post()
        self.assertEqual(response.status_code, 200, response.text)

        first = fake.messages.calls[0]
        first_instruction = first["messages"][0]["content"][1]["text"]
        self.assertIn("담보증권 평가비율", first["system"])
        self.assertIn("수집하지 않는다", first["system"])
        self.assertIn("후자는 제외", first_instruction)

        second = fake.messages.calls[1]
        second_instruction = second["messages"][0]["content"]
        self.assertIn("모든 citation을 사용할 필요는 없", second["system"])
        self.assertIn("88%·68%·98%", second["system"])
        self.assertIn("평가비율을 담보유지비율로 분류하지 마세요", second_instruction)

    def test_uses_raw_document_sha_when_review_number_has_no_citation(self) -> None:
        pass1 = copy.deepcopy(self.pass1)
        pass1.content[0].citations = pass1.content[0].citations[:2]

        response, _ = self._post(pass1=pass1)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json()["doc_version"],
            {"content_sha256": sha256(self.raw).hexdigest()},
        )

    def test_review_number_normalization_matches_six_document_corpus(self) -> None:
        expected = {
            "한국투자_신용거래설명서_20260707.htm": {"2026-0265"},
            "메리츠_신용거래설명서_20250421.pdf": {"25-125"},
            "삼성_신용거래핵심설명서_20240822.pdf": {"24-0104"},
            "신한_신용거래설명서_20260330.pdf": {"26-00486-511"},
            "키움_국내주식핵심설명서_20260612.pdf": {"26-0363"},
            "미래에셋_신용거래설명서_20250324.pdf": set(),
        }

        for filename, expected_numbers in expected.items():
            with self.subTest(filename=filename):
                document = parse_document(REPO_ROOT / "data" / "terms" / filename)
                flattened_text = "\n".join(unit.text for unit in document.units)
                actual = {
                    match.group("review_no")
                    for match in _REVIEW_NO_PATTERN.finditer(flattened_text)
                }
                self.assertEqual(actual, expected_numbers)

    def test_optional_nulls_from_structured_output_are_omitted(self) -> None:
        card = copy.deepcopy(self.card)
        card["contract_vintage"] = None
        card["verified_at"] = None

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("contract_vintage", response.json())
        self.assertNotIn("verified_at", response.json())

    def test_rejects_asset_valuation_ratio_instead_of_silently_dropping_it(self) -> None:
        valuation_quote = "88%"
        pass1 = copy.deepcopy(self.pass1)
        pass1.content[0].citations.append(_citation(self.text, valuation_quote))
        card = copy.deepcopy(self.card)
        card["ratio_rules"].append(
            {
                "product_type": "신용거래대주",
                "collateral_type": "KOSPI200 구성종목",
                "symbol_group": "전체",
                "ratio": 0.88,
                "evidence": self._evidence(valuation_quote),
            }
        )

        response, _ = self._post(card=card, pass1=pass1)

        self.assertEqual(response.status_code, 422)
        self.assertIn("ratio_rules.1.ratio", response.json()["detail"])
        self.assertIn("less than the minimum of 1.0", response.json()["detail"])

    def test_rejects_model_supplied_document_identity(self) -> None:
        card = copy.deepcopy(self.card)
        card["doc_version"] = {"review_no": "제9999-9999호"}

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("doc_version을 생성할 수 없습니다", response.json()["detail"])

    def test_rejects_citation_that_does_not_match_source_slice(self) -> None:
        citation = _citation(self.text, self.ratio_quote)
        citation.cited_text = "위조된 인용 140%"
        pass1 = copy.deepcopy(self.pass1)
        pass1.content[0].citations = [citation]

        response, fake = self._post(pass1=pass1)

        self.assertEqual(response.status_code, 422)
        self.assertIn("평탄화 원문 좌표", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 1)

    def test_rejects_evidence_not_returned_by_first_pass(self) -> None:
        card = copy.deepcopy(self.card)
        card["ratio_rules"][0]["evidence"]["char_start"] += 1

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("1패스 native citation", response.json()["detail"])

    def test_rejects_numeric_quote_mismatch(self) -> None:
        card = copy.deepcopy(self.card)
        card["disposal_price_rules"][0]["discount_rate"] = 0.20

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("Pydantic 검증 실패", response.json()["detail"])

    def test_rejects_verified_status_and_formula_contamination(self) -> None:
        verified = copy.deepcopy(self.card)
        verified["status"] = "verified"
        response, _ = self._post(card=verified)
        self.assertEqual(response.status_code, 422)
        self.assertIn("draft", response.json()["detail"])

        formula = copy.deepcopy(self.card)
        formula["disposal_price_rules"][0]["trigger"] = "8100000-1.4*6000000=300000"
        response, _ = self._post(card=formula)
        self.assertEqual(response.status_code, 422)
        self.assertIn("산식", response.json()["detail"])

    def test_rejects_truncated_passes_without_retry(self) -> None:
        truncated = copy.deepcopy(self.pass1)
        truncated.stop_reason = "max_tokens"

        response, fake = self._post(pass1=truncated)

        self.assertEqual(response.status_code, 422)
        self.assertIn("완결되지", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 1)

    def test_truncated_second_pass_returns_usage_and_timing_headers(self) -> None:
        response, fake = self._post(pass2_stop_reason="max_tokens")

        self.assertEqual(response.status_code, 422)
        self.assertIn("완결되지", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 2)
        self.assertEqual(response.headers["x-ingest-pass1-input-tokens"], "43000")
        self.assertEqual(response.headers["x-ingest-pass2-output-tokens"], "700")
        self.assertIn("x-ingest-total-ms", response.headers)

    def test_schema_failure_after_second_pass_keeps_usage_headers(self) -> None:
        card = copy.deepcopy(self.card)
        card["broker"] = None

        response, fake = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("broker", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 2)
        self.assertEqual(response.headers["x-ingest-pass2-output-tokens"], "700")
        self.assertIn("x-ingest-total-ms", response.headers)

    def test_prompt_contract_has_stable_sha256(self) -> None:
        self.assertRegex(prompt_sha256(), r"^[0-9a-f]{64}$")

    def test_real_sdk_serializes_both_requests_without_network(self) -> None:
        request_bodies: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            request_bodies.append(body)
            if len(request_bodies) == 1:
                citations = [
                    {
                        "type": "char_location",
                        "start_char_index": self.text.index(self.ratio_quote),
                        "end_char_index": self.text.index(self.ratio_quote)
                        + len(self.ratio_quote),
                        "cited_text": self.ratio_quote,
                        "document_index": 0,
                        "document_title": HANKOOK_TERMS.name,
                    },
                    {
                        "type": "char_location",
                        "start_char_index": self.text.index(self.discount_quote),
                        "end_char_index": self.text.index(self.discount_quote)
                        + len(self.discount_quote),
                        "cited_text": self.discount_quote,
                        "document_index": 0,
                        "document_title": HANKOOK_TERMS.name,
                    },
                    {
                        "type": "char_location",
                        "start_char_index": self.text.index(self.review_quote),
                        "end_char_index": self.text.index(self.review_quote)
                        + len(self.review_quote),
                        "cited_text": self.review_quote,
                        "document_index": 0,
                        "document_title": HANKOOK_TERMS.name,
                    },
                ]
                text = "검증된 약관 인용"
            else:
                citations = None
                text = json.dumps(self.card, ensure_ascii=False)
            content = {"type": "text", "text": text}
            if citations is not None:
                content["citations"] = citations
            return httpx.Response(
                200,
                json={
                    "id": f"msg_{len(request_bodies)}",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-sonnet-5",
                    "content": [content],
                    "stop_reason": "end_turn",
                    "stop_sequence": None,
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                },
            )

        async def run():
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler)
            ) as http_client:
                sdk = anthropic.AsyncAnthropic(
                    api_key="sk-ant-test",
                    base_url="https://anthropic.invalid",
                    http_client=http_client,
                    max_retries=0,
                )
                return await TwoPassIngestService(sdk).ingest(
                    filename=HANKOOK_TERMS.name,
                    data=self.raw,
                )

        result = asyncio.run(run())

        self.assertEqual(result.card.status, "draft")
        self.assertEqual(len(request_bodies), 2)
        self.assertNotIn("temperature", request_bodies[0])
        self.assertEqual(request_bodies[0]["thinking"], {"type": "disabled"})
        self.assertIn("output_config", request_bodies[1])
        self.assertNotIn("citations", request_bodies[1])


if __name__ == "__main__":
    unittest.main()
