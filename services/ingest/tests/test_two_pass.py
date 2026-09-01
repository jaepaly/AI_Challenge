import copy
import asyncio
from base64 import urlsafe_b64decode
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
from app.schemas import ConditionCard
from app.two_pass import (
    _REVIEW_NO_PATTERN,
    CitationSpan,
    IngestPipelineError,
    TwoPassIngestService,
    _broker_from_filename,
    _example_intervals,
    _is_example_span,
    _maintenance_citation_bindings,
    _maintenance_row_bindings,
    _role_citations,
    _structured_output_schema,
    _validate_evidence_role_binding,
    prompt_sha256,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
# ⚠ **보존본이다 — 현행본(_20260825)으로 옮기지 마라.**
#
#   2026-08-25 개정본은 pdf2htmlEX 산출물이라 **탭·개행이 하나도 없다**(옛 228·246개).
#   여기 검사들이 재는 것은 «한투 현행본이 어떻게 생겼나» 가 아니라 «표 구분자가 있는
#   문서를 우리 파서·인제스트가 어떻게 다루나» 이고, 그 재료는 이 판본에만 있다.
#   현행본으로 옮기면 검사는 다시 쓸 수 있어도 **재던 성질이 사라진다.**
#
#   카드가 인용하는 판본은 현행본이다(apps/web/lib/marginguard/snapshot.ts).
#   구분자 없는 렌더에서 무엇이 달라지는지는 test_flat_render_narrowing.py 가 고정한다.
HANKOOK_TERMS = REPO_ROOT / "data/terms/한국투자_신용거래설명서_20260707.htm"
EUGENE_TERMS = REPO_ROOT / "data/terms/유진_반대매매안내_수집20260805.html"
ATTEMPT6_RESULT = (
    REPO_ROOT
    / "services"
    / "ingest"
    / "benchmarks"
    / "results"
    / "hankook_two_pass_attempt6_failed.json"
)


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
        cls.ratio_quote = "담보유지 비율\t융자\t융자금의 140%"
        cls.discount_quote = (
            "반대매매는 한국거래소를 통해 진행되며 수량은 한국거래소(KRX) 전일종가 "
            "대비 15% 하락한 가격을 기준으로 산정되고, 전일종가의 하한가로 처분될 수 "
            "있으며 처분 금액은 담보부족금액을 상회할 수 있습니다."
        )
        execution_start = cls.text.index(cls.ratio_quote)
        schedule_quote = "임의상환정리(반대매매)\t담보부족발생(D일) + 2일"
        execution_end = cls.text.index(schedule_quote, execution_start) + len(
            schedule_quote
        )
        cls.execution_quote = cls.text[execution_start:execution_end]
        cls.review_quote = "한국투자증권 소비자보호 총괄책임자 심사필 제2026-0265(2026-07-03)"

    def setUp(self) -> None:
        citations = [
            _citation(self.text, self.ratio_quote),
            _citation(self.text, self.discount_quote),
            _citation(self.text, self.execution_quote),
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
        execution_evidence = self._evidence(self.execution_quote)
        self.card = {
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
                    "day_counting": "담보부족발생(D일) + 2일",
                    "evidence": execution_evidence,
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

    def _parsed_card_and_roles(self, card: dict[str, object]):
        complete = copy.deepcopy(card)
        complete.setdefault("broker", "테스트증권")
        complete.setdefault("doc_version", {"content_sha256": "0" * 64})
        parsed = ConditionCard.model_validate(complete)

        def citation_for(rule) -> CitationSpan:
            evidence = rule.evidence
            return CitationSpan(
                source_format=evidence.source_format,
                char_start=evidence.char_start,
                char_end=evidence.char_end,
                flattened_sha256=evidence.flattened_sha256,
                quote=evidence.quote,
            )

        return parsed, {
            "ratio_rules": tuple(citation_for(rule) for rule in parsed.ratio_rules),
            "disposal_price_rules": tuple(
                citation_for(rule) for rule in parsed.disposal_price_rules
            ),
            "execution_schedule": tuple(
                citation_for(rule) for rule in parsed.execution_schedule
            ),
        }

    def test_hankook_runs_two_passes_and_returns_valid_draft_card(self) -> None:
        response, fake = self._post()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["broker"], "한국투자증권")
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
        self.assertEqual(
            response.headers["x-ingest-evidence-coordinate-mode"], "character"
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-character-span-count"], "3"
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-non-character-span-count"], "0"
        )
        self.assertIn("x-ingest-evidence-max-span", response.headers)
        self.assertIn("x-ingest-evidence-min-span", response.headers)
        self.assertEqual(
            response.headers["x-ingest-evidence-max-span"],
            str(len(self.execution_quote)),
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-duplicate-spans"], "0"
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-ambiguous-percent-spans"], "1"
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-all-single-percent"], "false"
        )
        self.assertEqual(
            response.headers[
                "x-ingest-evidence-all-numeric-bindings-single-percent"
            ],
            "true",
        )

    def test_sixth_run_broad_native_citations_complete_with_server_subspans(
        self,
    ) -> None:
        recorded = json.loads(ATTEMPT6_RESULT.read_text(encoding="utf-8"))
        native_spans = tuple(
            CitationSpan(
                source_format="html",
                char_start=candidate["char_start"],
                char_end=candidate["char_end"],
                flattened_sha256=self.document.flattened_sha256 or "",
                quote=self.text[candidate["char_start"] : candidate["char_end"]],
            )
            for candidate in recorded["citation_candidates"]
        )
        roles = _role_citations(native_spans, self.text)
        pass1 = copy.deepcopy(self.pass1)
        pass1.content[0].citations = [
            SimpleNamespace(
                type="char_location",
                start_char_index=span.char_start,
                end_char_index=span.char_end,
                cited_text=span.quote,
                document_index=0,
                document_title=HANKOOK_TERMS.name,
            )
            for span in native_spans
        ]
        card = copy.deepcopy(self.card)
        card["ratio_rules"][0]["evidence"] = min(
            roles["ratio_rules"], key=lambda item: len(item.quote)
        ).as_dict()
        card["disposal_price_rules"][0]["evidence"] = min(
            roles["disposal_price_rules"], key=lambda item: len(item.quote)
        ).as_dict()
        card["execution_schedule"][0]["evidence"] = min(
            roles["execution_schedule"], key=lambda item: len(item.quote)
        ).as_dict()

        response, fake = self._post(card=card, pass1=pass1)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(fake.messages.calls), 2)
        self.assertEqual(
            response.headers["x-ingest-evidence-duplicate-spans"], "0"
        )
        self.assertEqual(
            response.headers[
                "x-ingest-evidence-all-numeric-bindings-single-percent"
            ],
            "true",
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-all-single-percent"],
            "false",
        )
        self.assertLessEqual(
            int(response.headers["x-ingest-evidence-max-span"]), 192
        )
        spans = json.loads(
            urlsafe_b64decode(
                response.headers["x-ingest-evidence-spans"]
            ).decode("ascii")
        )
        execution = next(
            span for span in spans if span["role"] == "execution_schedule"
        )
        self.assertEqual(
            (execution["char_start"], execution["char_end"]),
            (5252, 5444),
        )
        self.assertEqual(
            (
                execution["parent_char_start"],
                execution["parent_char_end"],
            ),
            (4444, 6065),
        )
        self.assertTrue(execution["derived_from_parent"])
        self.assertEqual(execution["bound_percent_values"], [140.0])

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
        catalog = json.loads(content.split("\n", 1)[1])
        self.assertEqual(catalog["ratio_rules"][0]["quote"], self.ratio_quote)
        self.assertEqual(len(catalog["ratio_rules"]), 1)
        self.assertEqual(
            catalog["execution_schedule"][0]["quote"], self.execution_quote
        )
        self.assertEqual(
            set(catalog),
            {"ratio_rules", "disposal_price_rules", "execution_schedule"},
        )
        self.assertNotIn("citations", request)
        schema = request["output_config"]["format"]["schema"]
        self.assertEqual(schema["properties"]["status"]["enum"], ["draft"])
        self.assertNotIn("PageEvidenceSpan", schema["$defs"])
        self.assertNotIn("doc_version", schema["properties"])
        self.assertNotIn("doc_version", schema["required"])
        self.assertNotIn("broker", schema["properties"])
        self.assertNotIn("broker", schema["required"])

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
        pass1.content[0].citations = pass1.content[0].citations[:-1]

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

    def test_rejects_model_supplied_broker_identity(self) -> None:
        card = copy.deepcopy(self.card)
        card["broker"] = "다른증권"

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("broker를 생성할 수 없습니다", response.json()["detail"])

    def test_unknown_broker_filename_fails_before_paid_calls(self) -> None:
        fake = FakeAnthropicClient(self.pass1, self.card)
        service = TwoPassIngestService(fake)
        app.dependency_overrides[get_ingest_service] = lambda: service

        response = TestClient(app).post(
            "/ingest",
            files={"file": ("알수없음_약관.htm", self.raw, "text/html")},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("발행사 하나", response.json()["detail"])
        self.assertEqual(fake.messages.calls, [])

    def test_broker_filename_allowlist_covers_the_terms_corpus(self) -> None:
        expected = {
            "한국투자_신용거래설명서_20260707.htm": "한국투자증권",
            "메리츠_신용거래설명서_20250421.pdf": "메리츠증권",
            "미래에셋_신용거래설명서_20250324.pdf": "미래에셋증권",
            "삼성_신용거래핵심설명서_20240822.pdf": "삼성증권",
            "신한_신용거래설명서_20260330.pdf": "신한투자증권",
            "유진_반대매매안내_수집20260805.html": "유진투자증권",
            "키움_국내주식핵심설명서_20260612.pdf": "키움증권",
        }
        for filename, broker in expected.items():
            with self.subTest(filename=filename):
                self.assertEqual(_broker_from_filename(filename), broker)

        with self.assertRaises(IngestPipelineError):
            _broker_from_filename("삼성_신한_혼합문서.pdf")

    def test_example_filter_uses_overlap_and_stops_before_later_clauses(self) -> None:
        intervals = _example_intervals(self.text)
        first_example = self.text.index("투자사례")
        overlapping = CitationSpan(
            source_format="html",
            char_start=max(0, first_example - 10),
            char_end=first_example + 10,
            flattened_sha256=self.document.flattened_sha256 or "",
            quote=self.text[max(0, first_example - 10) : first_example + 10],
        )
        self.assertTrue(_is_example_span(overlapping, intervals))

        labelled_example = self.text.index("투자사례(가,나)")
        later_item = next(
            end for start, end in intervals if start == labelled_example
        )
        later_clause = CitationSpan(
            source_format="html",
            char_start=later_item,
            char_end=later_item + 2,
            flattened_sha256=self.document.flattened_sha256 or "",
            quote=self.text[later_item : later_item + 2],
        )
        self.assertFalse(_is_example_span(later_clause, intervals))

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
        self.assertIn("native citation 기반 허용 후보", response.json()["detail"])

    def test_rejects_numeric_quote_mismatch(self) -> None:
        card = copy.deepcopy(self.card)
        card["disposal_price_rules"][0]["discount_rate"] = 0.20

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("Pydantic 검증 실패", response.json()["detail"])

    def test_rejects_schedule_only_citation_before_paid_second_pass(self) -> None:
        schedule_only = "추가담보납부 요구일의 다음 영업일까지 추가담보를 납입하지 않아 그 다음 영업일에 임의처분"
        pass1 = copy.deepcopy(self.pass1)
        pass1.content[0].citations = [
            citation
            for citation in pass1.content[0].citations
            if citation.cited_text != self.execution_quote
        ]
        pass1.content[0].citations.append(_citation(self.text, schedule_only))

        response, fake = self._post(pass1=pass1)

        self.assertEqual(response.status_code, 422)
        self.assertIn("execution_schedule", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 1)
        candidates = json.loads(
            urlsafe_b64decode(
                response.headers["x-ingest-citation-candidates"]
            ).decode("ascii")
        )
        self.assertTrue(
            any(
                candidate["length"] == len(schedule_only)
                and candidate["percent_values"] == []
                and candidate["eligible_roles"] == []
                for candidate in candidates
            )
        )
        self.assertEqual(response.headers["x-ingest-pass2-output-tokens"], "0")

    def test_narrows_ratio_row_but_rejects_missing_execution_before_second_pass(self) -> None:
        table_start = self.text.index("담보유지 비율")
        table_end = self.text.index("상환방법", table_start)
        ambiguous = self.text[table_start:table_end]
        pass1 = copy.deepcopy(self.pass1)
        pass1.content[0].citations = [
            citation
            for citation in pass1.content[0].citations
            if citation.cited_text not in {self.ratio_quote, self.execution_quote}
        ]
        pass1.content[0].citations.append(_citation(self.text, ambiguous))

        response, fake = self._post(pass1=pass1)

        self.assertEqual(response.status_code, 422)
        self.assertNotIn("ratio_rules", response.json()["detail"])
        self.assertIn("execution_schedule", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 1)

    def test_rejects_evidence_selected_from_another_role(self) -> None:
        card = copy.deepcopy(self.card)
        card["execution_schedule"][0]["evidence"] = self._evidence(
            self.ratio_quote
        )
        card["execution_schedule"][0]["day_counting"] = "담보유지 비율"

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("execution_schedule evidence", response.json()["detail"])

    def test_rejects_day_counting_not_present_in_execution_evidence(self) -> None:
        card = copy.deepcopy(self.card)
        card["execution_schedule"][0]["day_counting"] = "모델이 만든 임의 일정"

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("day_counting", response.json()["detail"])

    def test_rejects_ratio_product_that_does_not_match_evidence_row(self) -> None:
        card = copy.deepcopy(self.card)
        card["ratio_rules"][0]["product_type"] = "신용대주"

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("상품 종류", response.json()["detail"])

    def test_eugene_narrow_citation_binds_product_from_source_row(self) -> None:
        document = parse_document(EUGENE_TERMS)
        text = document.units[0].text
        quote = "담보유지비율이 일정비율(140%)미만으로 하락한 경우"
        start = text.index(quote)
        citation = CitationSpan(
            source_format="html",
            char_start=start,
            char_end=start + len(quote),
            flattened_sha256=document.flattened_sha256 or "",
            quote=quote,
        )

        self.assertEqual(_maintenance_row_bindings(quote), ())
        self.assertEqual(
            _maintenance_citation_bindings(citation, text),
            (("융자", 140.0),),
        )
        self.assertEqual(text[citation.char_start : citation.char_end], quote)

        tampered = CitationSpan(
            source_format="html",
            char_start=start,
            char_end=start + len(quote),
            flattened_sha256=document.flattened_sha256 or "",
            quote=quote.replace("140", "120"),
        )
        self.assertEqual(_maintenance_citation_bindings(tampered, text), ())

    def test_eugene_actual_document_binds_loan_and_rejects_short_sale(self) -> None:
        raw = EUGENE_TERMS.read_bytes()
        document = parse_document(EUGENE_TERMS)
        text = document.units[0].text
        ratio_quote = "담보유지비율이 일정비율(140%)미만으로 하락한 경우"
        execution_quote = (
            "담보유지비율이 일정비율(140%)미만으로 하락한 경우에는 추가로 담보를 징구, "
            "추가납부기한 익일 자동반대매매"
        )
        disposal_quote = "반대매매수량 계산시 기준가격은 하한가로 계산"

        def citation(quote: str):
            start = text.index(quote)
            return SimpleNamespace(
                type="char_location",
                start_char_index=start,
                end_char_index=start + len(quote),
                cited_text=quote,
                document_index=0,
                document_title=EUGENE_TERMS.name,
            )

        pass1 = SimpleNamespace(
            stop_reason="end_turn",
            content=[
                SimpleNamespace(
                    type="text",
                    text="유진 규칙 근거",
                    citations=[
                        citation(ratio_quote),
                        citation(disposal_quote),
                        citation(execution_quote),
                    ],
                )
            ],
            usage=_usage(3000, 300),
        )

        def evidence(quote: str) -> dict[str, object]:
            start = text.index(quote)
            return {
                "source_format": "html",
                "char_start": start,
                "char_end": start + len(quote),
                "flattened_sha256": document.flattened_sha256,
                "quote": quote,
            }

        card = {
            "ratio_rules": [
                {
                    "product_type": "신용융자",
                    "collateral_type": "주식",
                    "symbol_group": "전체",
                    "ratio": 1.4,
                    "evidence": evidence(ratio_quote),
                }
            ],
            "account_aggregation": "max",
            "disposal_price_rules": [
                {
                    "trigger": "담보부족 미해소",
                    "symbol_group": "전체",
                    "discount_basis": "lower_limit",
                    "source_confidence": "explicit",
                    "evidence": evidence(disposal_quote),
                }
            ],
            "execution_schedule": [
                {
                    "threshold_ratio": 1.4,
                    "day_counting": "추가납부기한 익일 자동반대매매",
                    "evidence": evidence(execution_quote),
                }
            ],
            "ratio_source": "website_notice",
            "status": "draft",
        }
        def post(product_type: str):
            candidate = copy.deepcopy(card)
            candidate["ratio_rules"][0]["product_type"] = product_type
            fake = FakeAnthropicClient(pass1, candidate)
            app.dependency_overrides[get_ingest_service] = (
                lambda: TwoPassIngestService(fake)
            )
            response = TestClient(app).post(
                "/ingest",
                files={"file": (EUGENE_TERMS.name, raw, "text/html")},
            )
            return response, fake

        for product_type in ("신용융자", "융자"):
            with self.subTest(product_type=product_type):
                response, fake = post(product_type)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["broker"], "유진투자증권")
                self.assertEqual(response.json()["status"], "draft")
                self.assertNotIn(
                    "evidence_product_binding",
                    response.json()["ratio_rules"][0],
                )
                self.assertEqual(
                    response.json()["doc_version"],
                    {"content_sha256": sha256(raw).hexdigest()},
                )
                self.assertEqual(len(fake.messages.calls), 2)

        for product_type in ("신용대주", "대주"):
            with self.subTest(product_type=product_type):
                response, fake = post(product_type)
                self.assertEqual(response.status_code, 422)
                self.assertIn("상품 종류", response.json()["detail"])
                self.assertEqual(len(fake.messages.calls), 2)

    def test_two_product_words_are_rejected_before_second_pass(self) -> None:
        ambiguous_ratio = CitationSpan(
            source_format="html",
            char_start=473,
            char_end=498,
            flattened_sha256="0" * 64,
            quote="담보유지비율 융자·대주 140%",
        )
        disposal = CitationSpan(
            source_format="html",
            char_start=700,
            char_end=718,
            flattened_sha256="0" * 64,
            quote="반대매매 기준가격은 하한가로 계산",
        )
        execution = CitationSpan(
            source_format="html",
            char_start=800,
            char_end=850,
            flattened_sha256="0" * 64,
            quote="담보유지비율 140% 미만이면 추가납부기한 익일 자동반대매매",
        )

        with self.assertRaisesRegex(IngestPipelineError, "ratio_rules"):
            _role_citations((ambiguous_ratio, disposal, execution))

    def test_rejects_two_product_words_even_with_one_ratio(self) -> None:
        card = copy.deepcopy(self.card)
        card["ratio_rules"][0]["evidence"] = {
            "source_format": "html",
            "char_start": 473,
            "char_end": 495,
            "flattened_sha256": self.document.flattened_sha256,
            "quote": "담보유지비율 융자·대주 140%",
        }
        parsed, roles = self._parsed_card_and_roles(card)

        with self.assertRaisesRegex(IngestPipelineError, "상품 종류"):
            _validate_evidence_role_binding(parsed, roles)

    def test_meritz_multi_axis_table_stays_fail_closed(self) -> None:
        quote = (
            "구분 담보유지비율"
            "신용거래융자기본형∙투자형A∙B군 140% C∙D군 150%"
            "신용거래대주A∙B군 120%"
        )

        self.assertEqual(_maintenance_row_bindings(quote), ())

    def test_rejects_execution_not_bound_to_declared_ratio_product(self) -> None:
        card = copy.deepcopy(self.card)
        card["broker"] = "한국투자증권"
        card["doc_version"] = {"review_no": "2026-0265"}
        execution = card["execution_schedule"][0]
        execution["day_counting"] = "D+2"
        execution["evidence"] = {
            "source_format": "html",
            "char_start": 6000,
            "char_end": 6040,
            "flattened_sha256": self.document.flattened_sha256,
            "quote": "담보유지 비율\t대주\t140%\n임의상환정리(반대매매)\tD+2",
        }
        parsed = ConditionCard.model_validate(card)

        def citation_for(rule) -> CitationSpan:
            evidence = rule.evidence
            return CitationSpan(
                source_format=evidence.source_format,
                char_start=evidence.char_start,
                char_end=evidence.char_end,
                flattened_sha256=evidence.flattened_sha256,
                quote=evidence.quote,
            )

        roles = {
            "ratio_rules": (citation_for(parsed.ratio_rules[0]),),
            "disposal_price_rules": (
                citation_for(parsed.disposal_price_rules[0]),
            ),
            "execution_schedule": (
                citation_for(parsed.execution_schedule[0]),
            ),
        }
        with self.assertRaisesRegex(IngestPipelineError, "임계비율·상품"):
            _validate_evidence_role_binding(parsed, roles)

    def test_rejects_lower_limit_when_quote_has_explicit_discount(self) -> None:
        card = copy.deepcopy(self.card)
        disposal = card["disposal_price_rules"][0]
        disposal["discount_basis"] = "lower_limit"
        disposal.pop("discount_rate")

        response, _ = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("직접 할인율", response.json()["detail"])

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
        card["account_aggregation"] = "invalid"

        response, fake = self._post(card=card)

        self.assertEqual(response.status_code, 422)
        self.assertIn("account_aggregation", response.json()["detail"])
        self.assertEqual(len(fake.messages.calls), 2)
        self.assertEqual(response.headers["x-ingest-pass2-output-tokens"], "700")
        self.assertIn("x-ingest-total-ms", response.headers)
        self.assertEqual(
            response.headers["x-ingest-evidence-coordinate-mode"], "character"
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-character-span-count"], "3"
        )
        self.assertEqual(
            response.headers["x-ingest-evidence-duplicate-spans"], "0"
        )
        self.assertIn("x-ingest-evidence-spans", response.headers)
        self.assertIn("x-ingest-evidence-max-span", response.headers)

    def test_prompt_contract_has_stable_sha256(self) -> None:
        self.assertEqual(
            prompt_sha256(),
            "c7b6effc566eabd1fc915be5f860a958d7c1e9add470f7f261553c872e15194e",
        )

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
                        "start_char_index": self.text.index(self.execution_quote),
                        "end_char_index": self.text.index(self.execution_quote)
                        + len(self.execution_quote),
                        "cited_text": self.execution_quote,
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
