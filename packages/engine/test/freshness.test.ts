/**
 * 신선도 게이트 테스트 — 30일 경계를 박제한다.
 * verified_at="2026-08-01" 기준: asOf 8/31(만 30일) = FRESH, 9/1(만 31일) = STALE.
 * 기준일이 검증일인 이유(README §5-A): 수집일 기준이면 심사 주간(9/7~9/11)에
 * 우리 스스로를 차단한다 — 심사 주간 시나리오로 함께 고정.
 */
import { describe, it, expect } from "vitest";
import { TEST_EVIDENCE } from "./evidence-fixture";
import { assessCardFreshness } from "../src/freshness";
import type { ConditionCard } from "../src/types";

/** ConditionCard 필수 필드를 전부 채운 픽스처 — 한투 골든 계좌 조건 기반 */
function makeCard(overrides: Partial<ConditionCard> = {}): ConditionCard {
  return {
    broker: "한국투자증권",
    ratio_rules: [
      { product_type: "신용융자", collateral_type: "현금", symbol_group: "일반", ratio: 1.4, evidence: TEST_EVIDENCE },
    ],
    account_aggregation: "max",
    disposal_price_rules: [
      {
        trigger: "담보부족 미해소",
        symbol_group: "일반",
        discount_basis: "prev_close_pct",
        discount_rate: 0.15,
        source_confidence: "explicit",
        evidence: TEST_EVIDENCE,
      },
    ],
    execution_schedule: [
      { threshold_ratio: 1.4, day_counting: "D일 15:40 평가 → D+2 미해소 시 D+3 개장 집행", evidence: TEST_EVIDENCE },
    ],
    ratio_source: "clause",
    doc_version: { review_no: "제2026-0001호" },
    status: "verified",
    verified_at: "2026-08-01",
    ...overrides,
  };
}

describe("30일 경계 — verified_at=2026-08-01", () => {
  it("asOf 8/31(만 30일) → FRESH, 계산 허용", () => {
    expect(assessCardFreshness(makeCard(), "2026-08-31")).toEqual({
      calculable: true,
      mode: "calculated",
      reason: "FRESH",
      ageDays: 30,
    });
  });

  it("asOf 9/1(만 31일) → STALE, 참고 모드 강등", () => {
    expect(assessCardFreshness(makeCard(), "2026-09-01")).toEqual({
      calculable: false,
      mode: "reference",
      reason: "STALE",
      ageDays: 31,
    });
  });

  it("검증 당일(만 0일) → FRESH", () => {
    const v = assessCardFreshness(makeCard(), "2026-08-01");
    expect(v.reason).toBe("FRESH");
    expect(v.ageDays).toBe(0);
  });
});

describe("심사 주간 시나리오 — 검증일 기준이라 우리를 차단하지 않는다", () => {
  it("8월 말(8/30) 검증 → 심사 주간 전일정(9/7~9/11) FRESH 유지", () => {
    const card = makeCard({ verified_at: "2026-08-30" });
    for (const asOf of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
      const v = assessCardFreshness(card, asOf);
      expect(v.calculable).toBe(true);
      expect(v.reason).toBe("FRESH");
    }
    // 심사 마지막 날 만 12일 — 30일 한도까지 여유
    expect(assessCardFreshness(card, "2026-09-11").ageDays).toBe(12);
  });

  it("대조: 7월 말(7/28) 수집분을 그대로 기준 삼았다면 심사 주간에 STALE", () => {
    const v = assessCardFreshness(makeCard({ verified_at: "2026-07-28" }), "2026-09-11");
    expect(v).toMatchObject({ calculable: false, reason: "STALE", ageDays: 45 });
  });
});

describe("강등 경로 — 모르면 차단", () => {
  it("draft → reference/DRAFT (신선해도 계산 금지), ageDays는 계산값", () => {
    const v = assessCardFreshness(makeCard({ status: "draft" }), "2026-08-11");
    expect(v).toEqual({ calculable: false, mode: "reference", reason: "DRAFT", ageDays: 10 });
  });

  it("draft + verified_at 부재 → DRAFT 우선, ageDays null", () => {
    const v = assessCardFreshness(makeCard({ status: "draft", verified_at: undefined }), "2026-08-11");
    expect(v).toEqual({ calculable: false, mode: "reference", reason: "DRAFT", ageDays: null });
  });

  it("verified인데 verified_at 부재 → reference/NO_VERIFIED_AT, ageDays null", () => {
    const v = assessCardFreshness(makeCard({ verified_at: undefined }), "2026-08-11");
    expect(v).toEqual({
      calculable: false,
      mode: "reference",
      reason: "NO_VERIFIED_AT",
      ageDays: null,
    });
  });
});

describe("입력 오류 — 조용히 강등하지 않고 throw", () => {
  it("asOf 파싱 불가(문자열·Invalid Date 객체) → TypeError", () => {
    expect(() => assessCardFreshness(makeCard(), "이건-날짜가-아니다")).toThrow(TypeError);
    expect(() => assessCardFreshness(makeCard(), new Date("invalid"))).toThrow(TypeError);
  });

  it("verified_at 비ISO 표기 → TypeError ('심사필-2026' 연도 오파싱 함정 포함)", () => {
    // ※ "심사필-2026"은 V8 레거시 파서가 연도만 뽑아 파싱해버린다(NaN 아님) —
    //   ISO 날짜(YYYY-MM-DD) 정규식 입구 검증으로 해소됨, 커밋 96ffb95.
    //   파서에 도달하기 전에 던진다.
    expect(() =>
      assessCardFreshness(makeCard({ verified_at: "심사필-2026" }), "2026-08-11"),
    ).toThrow(TypeError);
    expect(() =>
      assessCardFreshness(makeCard({ verified_at: "검증일-미상" }), "2026-08-11"),
    ).toThrow(TypeError);
    // 시간 성분이 붙어도 거부 — verified_at 표기는 날짜만
    expect(() =>
      assessCardFreshness(makeCard({ verified_at: "2026-08-01T00:00:00Z" }), "2026-08-11"),
    ).toThrow(TypeError);
    // draft라도 비ISO 표기는 입구에서 동일하게 던진다
    expect(() =>
      assessCardFreshness(makeCard({ status: "draft", verified_at: "심사필-2026" }), "2026-08-11"),
    ).toThrow(TypeError);
  });

  it("verified_at이 asOf보다 하루 넘게 미래(데이터 오염) → TypeError", () => {
    expect(() => assessCardFreshness(makeCard({ verified_at: "2026-09-05" }), "2026-08-11")).toThrow(
      TypeError,
    );
    // 정확히 하루 미래(차이 = −1일)도 오염으로 본다
    expect(() => assessCardFreshness(makeCard({ verified_at: "2026-08-02" }), "2026-08-01")).toThrow(
      TypeError,
    );
  });
});

describe("타임존 스큐 클램프", () => {
  it("같은 날인데 verified_at(UTC 자정)이 asOf(KST 자정)보다 9시간 뒤 → ageDays 0, FRESH", () => {
    // verified_at "2026-08-01" = 8/1 00:00Z, asOf 8/1 00:00 KST = 7/31 15:00Z → 차이 −9시간
    const v = assessCardFreshness(makeCard(), "2026-08-01T00:00:00+09:00");
    expect(v).toEqual({ calculable: true, mode: "calculated", reason: "FRESH", ageDays: 0 });
  });
});

describe("결정론", () => {
  it("동일 입력 → 동일 출력, string과 동치 Date 인자도 동일", () => {
    const card = makeCard();
    const first = assessCardFreshness(card, "2026-08-31");
    expect(assessCardFreshness(card, "2026-08-31")).toEqual(first);
    expect(assessCardFreshness(card, new Date("2026-08-31T00:00:00Z"))).toEqual(first);
  });
});
