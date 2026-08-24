"""정본 JSON Schema 를 배포 번들용 사본으로 복사한다.

배포 루트가 `services/ingest` 라 번들에 저장소 루트가 들어오지 않는다. 그러면
런타임이 `schemas/condition_card.schema.json` 을 못 읽어 4중 방어 ②(JSON Schema
검증)가 **프로덕션에서만** 터진다 — 로컬·CI 에서는 루트가 있어 끝까지 안 보인다.

    정본   schemas/condition_card.schema.json
    사본   services/ingest/app/_bundled/condition_card.schema.json

**사본을 손으로 고치지 마라.** 정본을 고치고 이 스크립트를 돌려라::

    python scripts/sync_bundled_schema.py

두 파일이 갈라지면 `test_deployable.test_bundled_schema_matches_canonical` 이
먼저 넘어진다. 그 검사가 이 스크립트를 대신 지키는 장치다.
"""

from __future__ import annotations

from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
CANONICAL = REPO_ROOT / "schemas" / "condition_card.schema.json"
BUNDLED = REPO_ROOT / "services" / "ingest" / "app" / "_bundled" / "condition_card.schema.json"


def main() -> int:
    if not CANONICAL.exists():
        print(f"정본이 없다: {CANONICAL}", file=sys.stderr)
        return 1

    source = CANONICAL.read_bytes()
    if BUNDLED.exists() and BUNDLED.read_bytes() == source:
        print(f"이미 같다 ({len(source)} bytes)")
        return 0

    BUNDLED.parent.mkdir(parents=True, exist_ok=True)
    BUNDLED.write_bytes(source)
    print(f"복사했다 {CANONICAL.relative_to(REPO_ROOT)} → {BUNDLED.relative_to(REPO_ROOT)} ({len(source)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
