/**
 * RiskResult 조립 골든 — 계기판이 소비하는 단일 진입점을 고정한다.
 * 신선도 케이스는 #10 리뷰의 약속 이행이다: 스냅숏 카드 verified_at=2026-08-09가
 * 심사 3일차(9/9)에 STALE이 되는 시나리오를 테스트로 박제한다.
 */
import { describe, it, expect } from "vitest";
import { TEST_EVIDENCE } from "./evidence-fixture";
import { assembleRiskResult, disposalDiscountRate } from "../src/index";
import type { ConditionCard, CreditLedger, DisposalPriceRule, Position } from "../src/index";

const ASSUMED_F = 0.008;

function positions(prevClose: number, qty = 1_000): Position[] {
  return [{ symbol: "000001", qty, prevClose }];
}
function ledger(loan = 6_000_000, cash = 0): CreditLedger {
  return { loan, cash, requiredRatio: 1.4 };
}
function makeCard(p: {
  rules?: DisposalPriceRule[];
  status?: "verified" | "draft";
  verified_at?: string;
}): ConditionCard {
  return {
    broker: "테스트",
    ratio_rules: [
      { product_type: "신용융자", collateral_type: "주식", symbol_group: "일반", ratio: 1.4, evidence: TEST_EVIDENCE },
    ],
    account_aggregation: "max",
    disposal_price_rules: p.rules ?? [
      {
        trigger: "margin_call",
        symbol_group: "일반",
        discount_basis: "prev_close_pct",
        discount_rate: 0.15,
        source_confidence: "explicit",
        evidence: TEST_EVIDENCE,
      },
    ],
    execution_schedule: [{ threshold_ratio: 1.4, day_counting: "D+2", evidence: TEST_EVIDENCE }],
    ratio_source: "clause",
    doc_version: { review_no: "TEST" },
    status: p.status ?? "verified",
    ...(p.verified_at !== undefined ? { verified_at: p.verified_at } : {}),
  };
}
const hantoo = () => makeCard({ verified_at: "2026-08-09" });

describe("조립 — 한투 골든 계좌 한 번 호출로 계기판 입력 전체", () => {
  it("8,100원 관통: D 30만 / 비율 135 / 195주 / 4경로 / λ*=0 / verified", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: hantoo(),
      f: ASSUMED_F,
    });
    expect(r.shortfall).toBe(300_000);
    expect(r.marginRatioPct).toBe(135); // 사사오입 계층 — 표시 내림(134)은 UI의 일
    expect(r.liquidation).toMatchObject({ mode: "PARTIAL", qty: 195, k: 0.19 });
    expect(r.paths).toMatchObject({
      deposit: 300_000,
      repay: 214_286,
      collateral: null,
      voluntarySellQty: 96,
    });
    expect(r.equalShockLambda).toBe(0); // 이미 관통
    expect(r.cardStatus).toBe("verified");
    expect(r.liquidationSkipped).toBeUndefined(); // 값이 있으면 사유는 없다
  });

  it("10,000원 안전: D 0 → liquidation·paths null, λ* 0.16, 비율 167", () => {
    const r = assembleRiskResult({
      positions: positions(10_000),
      ledger: ledger(),
      card: hantoo(),
      f: ASSUMED_F,
    });
    expect(r.shortfall).toBe(0);
    expect(r.liquidation).toBeNull();
    expect(r.liquidationSkipped).toBe("NO_SHORTFALL");
    expect(r.paths).toBeNull();
    expect(r.marginRatioPct).toBe(167);
    expect(r.equalShockLambda).toBeCloseTo(0.16, 10);
  });

  it("6,000원(#21 경계): 자발 매도는 전량으로도 해소 불가 — null/QTY_EXCEEDED가 조립을 관통한다", () => {
    const r = assembleRiskResult({
      positions: positions(6_000),
      ledger: ledger(),
      card: hantoo(),
      f: ASSUMED_F,
    });
    expect(r.paths?.voluntarySellQty).toBeNull();
    expect(r.paths?.voluntarySellReason).toBe("QTY_EXCEEDED");
    expect(r.liquidation).toMatchObject({ mode: "FULL", reason: "QTY_EXCEEDED", qty: 1_000 });
  });
});

describe("신선도 게이트 — #10 시한폭탄 박제 (verified_at=2026-08-09, 심사 9/7~9/11)", () => {
  it("심사 2일차(9/8, 만 30일): 아직 정식 산출 — 195주 유지", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: hantoo(),
      f: ASSUMED_F,
      asOf: "2026-09-08",
    });
    expect(r.liquidation?.qty).toBe(195);
  });

  it("심사 3일차(9/9, 만 31일): STALE — liquidation만 차단, 부족액·비율·λ*·4경로는 유지", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: hantoo(),
      f: ASSUMED_F,
      asOf: "2026-09-09",
    });
    expect(r.liquidation).toBeNull(); // README 5-A "계산 차단"
    expect(r.liquidationSkipped).toBe("CARD_NOT_FRESH"); // 화면 문구: 재검증 요구
    expect(r.shortfall).toBe(300_000); // 원장 유지비율만으로 정해지는 값 — 유지
    expect(r.marginRatioPct).toBe(135);
    expect(r.paths?.deposit).toBe(300_000); // 4경로는 카드 파라미터 무관 — 유지
    expect(r.cardStatus).toBe("verified"); // 상태는 그대로 — 강등 표시는 신선도 뷰의 몫
  });

  it("draft 카드는 asOf가 있어도 계산 유지 — 참고 모드는 배너이지 차단이 아니다(#30 합의)", () => {
    const card = makeCard({
      status: "draft",
      rules: [
        {
          trigger: "margin_call",
          symbol_group: "일반",
          discount_basis: "lower_limit",
          source_confidence: "inferred_from_formula",
          evidence: TEST_EVIDENCE,
        },
      ],
    });
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card,
      f: ASSUMED_F,
      asOf: "2026-09-09",
    });
    // 하한가형 h=0.30 등가 → k=-0.02 → 전량 폴백이 draft에서도 그대로 재현된다
    expect(r.liquidation).toMatchObject({ mode: "FULL", reason: "K_NON_POSITIVE", qty: 1_000 });
    expect(r.cardStatus).toBe("draft"); // UI 배너 신호
  });

  it("verified인데 verified_at 부재: 수량 차단 — 모르는 것을 신선하다고 보지 않는다", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: makeCard({}),
      f: ASSUMED_F,
      asOf: "2026-09-08",
    });
    expect(r.liquidation).toBeNull();
    expect(r.liquidationSkipped).toBe("CARD_NOT_FRESH");
    expect(r.shortfall).toBe(300_000);
  });

  it("오염된 verified_at은 조용히 강등하지 않고 throw", () => {
    expect(() =>
      assembleRiskResult({
        positions: positions(8_100),
        ledger: ledger(),
        card: makeCard({ verified_at: "심사필-2026" }),
        f: ASSUMED_F,
        asOf: "2026-09-08",
      }),
    ).toThrow(TypeError);
  });
});

describe("h를 못 뽑는 카드 — 수량만 내리지 않는다", () => {
  it("disposal_price_rules 빈 배열: liquidation null, 부족액·4경로 유지", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: makeCard({ rules: [] }),
      f: ASSUMED_F,
    });
    expect(r.liquidation).toBeNull();
    expect(r.liquidationSkipped).toBe("NO_DISCOUNT_RATE");
    expect(r.shortfall).toBe(300_000);
    expect(r.paths?.voluntarySellQty).toBe(96); // 자발 매도는 카드 무관(원장 r·f·가격)
  });

  it("disposalDiscountRate 조회 규약: 정상 0.15 / lower_limit 0.3 / 부재 null", () => {
    expect(disposalDiscountRate(hantoo())).toBe(0.15);
    expect(
      disposalDiscountRate(
        makeCard({
          rules: [
            {
              trigger: "t",
              symbol_group: "g",
              discount_basis: "lower_limit",
              source_confidence: "explicit",
              evidence: TEST_EVIDENCE,
            },
          ],
        }),
      ),
    ).toBe(0.3);
    expect(disposalDiscountRate(makeCard({ rules: [] }))).toBeNull();
    expect(
      disposalDiscountRate(
        makeCard({
          rules: [
            {
              trigger: "t",
              symbol_group: "g",
              discount_basis: "prev_close_pct",
              source_confidence: "explicit",
              evidence: TEST_EVIDENCE,
            },
          ],
        }),
      ),
    ).toBeNull(); // rate 없는 prev_close_pct — 추정하지 않는다
  });
});

describe("liquidationSkipped 우선순위", () => {
  it("신선하지 않고 h도 없으면 CARD_NOT_FRESH — 재검증이 선행 조치다", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: makeCard({ rules: [], verified_at: "2026-08-09" }),
      f: ASSUMED_F,
      asOf: "2026-09-09", // STALE + h 부재 동시
    });
    expect(r.liquidationSkipped).toBe("CARD_NOT_FRESH");
  });

  it("draft + h 있음 → 산출되므로 사유 없음 (참고 모드는 배너로)", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(),
      card: makeCard({ status: "draft" }),
      f: ASSUMED_F,
      asOf: "2026-09-09",
    });
    expect(r.liquidation).not.toBeNull();
    expect(r.liquidationSkipped).toBeUndefined();
  });
});

describe("입력 규약", () => {
  it("다종목이면 throw — #23 머지 후 확장, 있는 척하지 않는다", () => {
    const two: Position[] = [...positions(8_100), { symbol: "000002", qty: 1, prevClose: 100 }];
    expect(() =>
      assembleRiskResult({ positions: two, ledger: ledger(), card: hantoo(), f: ASSUMED_F }),
    ).toThrow();
  });

  it("marketPrice 기본값은 전일종가 — 명시해도 같은 입력이면 같은 답", () => {
    const base = { positions: positions(8_100), ledger: ledger(), card: hantoo(), f: ASSUMED_F };
    const a = assembleRiskResult(base);
    const b = assembleRiskResult({ ...base, marketPrice: 8_100 });
    expect(b).toEqual(a);
  });
});
