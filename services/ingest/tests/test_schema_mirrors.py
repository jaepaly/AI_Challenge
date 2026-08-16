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


if __name__ == "__main__":
    unittest.main()
