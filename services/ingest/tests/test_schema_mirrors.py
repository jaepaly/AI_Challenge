"""세 미러(TS / JSON Schema / Pydantic)가 같은 규약을 말하는지 검사한다.

같은 계약이 세 곳에 적혀 있다. 하나만 고치면 나머지 둘이 조용히 어긋나고,
그 상태에서 TS 타입체크와 Pydantic 검증이 서로 다른 카드를 통과시킨다.
실제로 그랬다 — `evidence`가 JSON Schema·Pydantic에서는 required인데 TS에서는
선택이라, 근거 좌표가 없는 카드가 타입체크를 통과하면서 스키마를 위반했다.
`doc_version`도 같았다(TS는 `{}`가 합법, 나머지 둘은 식별자 필수).

TS를 정규식으로 읽는 것은 취약하다. 그건 의도다 — 계약 문구가 바뀌면
이 검사가 시끄럽게 깨져야지, 조용히 통과하면 안 된다.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
import unittest

from app import schemas


REPO_ROOT = Path(__file__).resolve().parents[3]
TS_TYPES = REPO_ROOT / "packages" / "engine" / "src" / "types.ts"
JSON_SCHEMA = REPO_ROOT / "schemas" / "condition_card.schema.json"

# 근거 좌표를 필수로 갖는 세 룰 — 카드가 수치를 주장하는 자리 전부다
RULE_KEYS = ("ratio_rules", "disposal_price_rules", "execution_schedule")


class SchemaMirrorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ts = TS_TYPES.read_text(encoding="utf-8")
        cls.schema = json.loads(JSON_SCHEMA.read_text(encoding="utf-8"))

    # ── evidence ────────────────────────────────────────────────────────────
    def test_json_schema_requires_evidence_on_every_rule(self) -> None:
        for key in RULE_KEYS:
            required = self.schema["properties"][key]["items"]["required"]
            self.assertIn("evidence", required, f"{key}에 evidence가 required가 아니다")

    def test_pydantic_requires_evidence_on_every_rule(self) -> None:
        for model in (
            schemas.RatioRule,
            schemas.DisposalPriceRule,
            schemas.ExecutionScheduleRule,
        ):
            field = model.model_fields["evidence"]
            self.assertTrue(
                field.is_required(),
                f"{model.__name__}.evidence가 필수가 아니다",
            )

    def test_typescript_requires_evidence_on_every_rule(self) -> None:
        # `evidence?: EvidenceSpan` 이 하나라도 남아 있으면 TS만 느슨해진 것이다
        self.assertNotIn(
            "evidence?: EvidenceSpan",
            self.ts,
            "types.ts에 선택 evidence가 남아 있다 — 나머지 두 미러는 required다",
        )
        self.assertEqual(
            self.ts.count("evidence: EvidenceSpan;"),
            len(RULE_KEYS),
            f"types.ts의 필수 evidence가 {len(RULE_KEYS)}개가 아니다",
        )

    # ── doc_version ─────────────────────────────────────────────────────────
    def test_json_schema_requires_a_document_identifier(self) -> None:
        any_of = self.schema["properties"]["doc_version"]["anyOf"]
        required = {tuple(branch["required"]) for branch in any_of}
        self.assertEqual(required, {("review_no",), ("content_sha256",)})

    def test_pydantic_requires_a_document_identifier(self) -> None:
        with self.assertRaises(Exception):
            schemas.DocVersion()  # 식별자 없음 → require_document_identifier가 막아야 한다
        self.assertIsNotNone(schemas.DocVersion(review_no="2026-0265"))
        self.assertIsNotNone(schemas.DocVersion(content_sha256="0" * 64))

    def test_typescript_requires_a_document_identifier(self) -> None:
        # 판별 유니온이어야 한다 — interface 한 덩어리면 전 필드 선택이 되어
        # `doc_version: {}`이 타입체크를 통과한다(실제로 그랬다)
        self.assertNotIn(
            "export interface DocVersion",
            self.ts,
            "DocVersion이 interface로 돌아갔다 — {}가 합법이 된다",
        )
        # 유니온 갈래 안에도 `;`가 있어 첫 세미콜론까지 끊으면 안 된다 —
        # 선언이 끝나는 빈 줄까지 잡는다.
        block = re.search(r"export type DocVersion =(.+?)\n\n", self.ts, re.S)
        self.assertIsNotNone(block, "export type DocVersion 유니온을 찾지 못했다")
        body = block.group(1)
        self.assertIn("review_no: string;", body, "review_no 필수 갈래가 없다")
        self.assertIn("content_sha256: string;", body, "content_sha256 필수 갈래가 없다")


# ── 값 제약 미러 ──────────────────────────────────────────────────────────────
#
# 위 검사들은 **필수/선택**과 **타입 모양**을 본다. 값 제약(minLength·format 등)은
# 보지 않았고, 그래서 broker가 새어 나갔다 — JSON Schema는 `minLength: 1`을
# 요구하는데 Pydantic은 맨 `str`이라 2패스가 낸 `broker=""`를 통과시켰다(#47 7차).
# 세 층 중 한 층만 막은 것이고, #46이 "TS만 느슨하다"를 고친 것과 방향만 반대다.
#
# 아래는 구조 비교가 아니라 **실제로 위반 카드를 만들어 두 런타임 층에 넣는다.**
# 규약을 정규식으로 읽으면 표현이 바뀔 때 조용히 통과하기 때문이다.

_SPAN = {
    "quote": "담보유지 비율\t융자\t융자금의 140%",
    "source_format": "html",
    "char_start": 5252,
    "char_end": 5272,
    "flattened_sha256": "f454551cba8762c6bddd546050d2b1f1fdab444cc348308e37f0a358cbb8fde5",
}


def _card(**over) -> dict:
    card = {
        "broker": "한국투자증권",
        "ratio_rules": [
            {
                "product_type": "융자",
                "collateral_type": "주식",
                "symbol_group": "전체",
                "ratio": 1.4,
                "evidence": dict(_SPAN),
            }
        ],
        "account_aggregation": "max",
        "disposal_price_rules": [
            {
                "trigger": "담보부족",
                "symbol_group": "전체",
                "discount_basis": "lower_limit",
                "source_confidence": "explicit",
                "evidence": dict(_SPAN),
            }
        ],
        "execution_schedule": [
            {"threshold_ratio": 1.4, "day_counting": "D+2", "evidence": dict(_SPAN)}
        ],
        "ratio_source": "clause",
        "doc_version": {"review_no": "2026-0265"},
        "status": "draft",
    }
    card.update(over)
    return card


def _string_constraints(node, path="") -> dict[str, dict]:
    """JSON Schema 안의 문자열 값 제약을 전부 찾는다."""
    found: dict[str, dict] = {}
    if isinstance(node, dict):
        if node.get("type") == "string":
            keep = {k: v for k, v in node.items() if k in ("minLength", "pattern", "format")}
            if keep:
                found[path] = keep
        for key, value in node.items():
            child = path if key in ("properties", "items", "anyOf", "oneOf", "allOf") else (
                f"{path}.{key}" if path else key
            )
            found.update(_string_constraints(value, child))
    elif isinstance(node, list):
        for item in node:
            found.update(_string_constraints(item, path))
    return found


class ValueConstraintMirrorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(JSON_SCHEMA.read_text(encoding="utf-8"))

    def _pydantic_rejects(self, card: dict) -> bool:
        try:
            schemas.ConditionCard(**card)
        except Exception:
            return True
        return False

    def _json_schema_rejects(self, card: dict) -> bool:
        import jsonschema

        try:
            jsonschema.validate(card, self.schema)
        except jsonschema.ValidationError:
            return True
        return False

    def test_the_constrained_fields_are_the_ones_we_checked(self) -> None:
        """JSON Schema에 값 제약이 늘면 이 검사가 깨져야 한다.

        아래 검사들은 지금 존재하는 제약만 다룬다. 새 제약이 들어오면 그것도
        미러에 반영됐는지 누군가 확인해야 하는데, 목록을 고정해 두지 않으면
        조용히 지나간다.
        """
        found = _string_constraints(self.schema.get("properties", {}))
        self.assertEqual(
            found,
            {"broker": {"minLength": 1}, "verified_at": {"format": "date"}},
            "JSON Schema의 문자열 값 제약이 바뀌었다 — 아래 미러 검사도 같이 늘려라",
        )

    def test_empty_broker_is_rejected_by_both_runtime_layers(self) -> None:
        """7차(#47)가 낸 실제 실패 입력이다. 한 층만 막으면 이 검사가 깨진다."""
        bad = _card(broker="")
        self.assertTrue(self._json_schema_rejects(bad), "JSON Schema가 broker=''를 통과시킨다")
        self.assertTrue(self._pydantic_rejects(bad), "Pydantic이 broker=''를 통과시킨다")
        # 정상값은 양쪽 통과 — 검사가 죽은 게 아니다
        self.assertFalse(self._json_schema_rejects(_card()))
        self.assertFalse(self._pydantic_rejects(_card()))

    def test_whitespace_broker_passes_both_layers(self) -> None:
        """`minLength: 1`은 공백을 막지 않는다 — 통과가 아니라 **부재**를 기록한다.

        broker="   "는 두 층 다 통과한다. 위 검사가 초록이라고 해서 "발행사가
        채워졌다"가 보증되지는 않는다는 뜻이다. 막으려면 JSON Schema에
        pattern을 넣어야 하고 그건 경계 파일이라 전원 승인이 필요하다 —
        8/18~8/24 묶음 항목으로 올려뒀다(#51).
        """
        blank = _card(broker="   ")
        self.assertFalse(self._json_schema_rejects(blank))
        self.assertFalse(self._pydantic_rejects(blank))

    def test_verified_at_format_is_not_asserted_by_either_layer(self) -> None:
        """`format: "date"`는 두 인제스트 층 어디서도 단언되지 않는다.

        jsonschema는 FormatChecker를 넘겨야 format을 검사하는데 호출부
        (B 브랜치 `two_pass.py`의 `Draft7Validator(schema)`)가 넘기지 않는다.
        Pydantic 쪽은 `Optional[str]`이다.

        지금 이게 사고로 이어지지 않는 이유는 **엔진이 따로 막기 때문**이다
        (`packages/engine/src/freshness.ts`의 ISO_DATE_RE + Date.parse NaN 검사).
        즉 신선도 3단을 지키는 것은 인제스트가 아니라 엔진이다. 인제스트만 보고
        "날짜가 검증됐다"고 읽으면 안 된다.
        """
        for value in ("어제", "2026-13-45", "08/19/2026"):
            with self.subTest(verified_at=value):
                card = _card(status="verified", verified_at=value)
                self.assertFalse(self._json_schema_rejects(card))
                self.assertFalse(self._pydantic_rejects(card))


if __name__ == "__main__":
    unittest.main()
