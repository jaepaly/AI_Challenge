/**
 * policyRatio — **카드의 유지비율이 계산을 구동하는가** (#67 A-1 · #64 P0-1).
 * ---------------------------------------------------------------------------
 * 이 파일이 지키는 결함:
 *   엔진은 r 을 `ledger.requiredRatio` 하나에서만 뽑았고, 카드의 `ratio_rules[].ratio`
 *   는 처분 수량을 막는 데만 쓰였다. D 실측:
 *       카드만 1.5 · 원장 1.4    부족액 300,000    ← 카드를 바꿔도 안 따라온다
 *       원장만 1.5 · 카드 1.4    부족액 900,000    ← 원장이 단독 구동
 *   *"AI 가 약관을 읽고 엔진이 계산한다"* 가 우리 주장인데 **읽은 값이 계산에 닿지
 *   않았다.** 아래 왕복 검사가 그 배선을 지킨다.
 *
 * 완료 기준(#67 원문): *"스냅숏 카드의 `ratio_rules[].ratio` 만 1.4 → 1.5 로 바꾸면
 * 부족액·임계가·λ*·4경로가 함께 바뀐다. 되돌리면 원래 값으로 돌아온다."*
 */
import { describe, it, expect } from "vitest";
import { TEST_EVIDENCE } from "./evidence-fixture";
import {
  assembleRiskResult,
  narrowRatioRules,
  policyRatio,
  PolicyRatioUnresolvedError,
  ratioAgreement,
  shortfall,
} from "../src/index";
import type { ConditionCard, Position, RatioRule } from "../src/index";

const ASSUMED_F = 0.008;
const LOAN = 6_000_000;
const QTY = 1_000;

function rule(ratio: number, over: Partial<RatioRule> = {}): RatioRule {
  return {
    product_type: "신용융자",
    collateral_type: "현금",
    symbol_group: "일반",
    ratio,
    evidence: TEST_EVIDENCE,
    ...over,
  };
}

/** 유지비율 조항만 갈아 끼우는 카드 — 다른 축은 전부 고정한다 */
function card(rules: RatioRule[]): ConditionCard {
  return {
    broker: "한국투자증권",
    ratio_rules: rules,
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
      { threshold_ratio: 1.4, day_counting: "D+2 미해소 시 D+3 개장", evidence: TEST_EVIDENCE },
    ],
    ratio_source: "clause",
    doc_version: { review_no: "제2026-0001호" },
    status: "verified",
    verified_at: "2026-08-01",
  };
}

const at = (prevClose: number, group?: string): Position[] => [
  { symbol: "000001", qty: QTY, prevClose, ...(group !== undefined ? { group } : {}) },
];

/**
 * 임계가 — 관통이 시작되는 최저 호가. `landing.tsx` 의 이분탐색과 같은 정의다.
 * 화면이 크게 찍는 숫자라 왕복 검사에 넣는다.
 */
function thresholdPrice(r: number): number {
  let lo = 5_000;
  let hi = 12_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2 / 10) * 10;
    if (mid <= lo) break;
    if (shortfall(QTY * mid, LOAN, r) === 0) hi = mid;
    else lo = mid + 10;
  }
  return hi;
}

/**
 * 카드 하나로 산출 묶음을 만든다 — 카드 말고는 아무것도 바꾸지 않는다.
 *
 * ⚠ **원장 r 을 카드에서 파생시킨다.** (다) 채택 뒤 `ledger.requiredRatio` 는 구동값이
 *   아니라 **제2 의견**이고, 합성 계좌에는 독립적인 제2 의견이 없다. 1.4 로 박아 두면
 *   카드를 1.5 로 바꾸는 순간 `ratioAgreement` 가 어긋남으로 보고 수량을 영구 차단한다
 *   — 심사위원이 1.5 짜리 약관을 올리면 업로드 데모가 그 자리에서 죽는다.
 *   `apps/web` 의 `ledger()` 도 같은 규약으로 가야 한다(#67 A-1 → D-1).
 *
 *   대조 게이트를 접은 것이 아니다 — 아래 "원장은 더 이상 구동하지 않는다" 가
 *   **일부러 어긋난 원장**을 넣어 게이트가 살아 있음을 확인한다.
 */
function assemble(c: ConditionCard, prevClose = 8_100) {
  const p = policyRatio(c);
  return assembleRiskResult({
    positions: at(prevClose),
    ledger: { loan: LOAN, cash: 0, requiredRatio: p.resolved ? p.ratio : Number.NaN },
    card: c,
    f: ASSUMED_F,
  });
}

describe("왕복 — 카드의 유지비율만 바꾸면 산출이 함께 바뀐다 (#67 완료 기준)", () => {
  it("1.4 → 1.5 → 1.4: 부족액·임계가·λ*·4경로가 따라오고, 되돌리면 원래 값이다", () => {
    const before = assemble(card([rule(1.4)]));
    const changed = assemble(card([rule(1.5)]));
    const restored = assemble(card([rule(1.4)]));

    // ── 부족액 ──
    expect(before.shortfall).toBe(300_000); // 1.4×6,000,000 − 8,100,000
    expect(changed.shortfall).toBe(900_000); // 1.5×6,000,000 − 8,100,000
    expect(restored.shortfall).toBe(before.shortfall);

    // ── 임계가 ──
    expect(thresholdPrice(1.4)).toBe(8_400);
    expect(thresholdPrice(1.5)).toBe(9_000);

    // ── λ* (관통 전 가격에서 재야 0 이 아니다) ──
    const lamBefore = assemble(card([rule(1.4)]), 9_500).equalShockLambda;
    const lamChanged = assemble(card([rule(1.5)]), 9_500).equalShockLambda;
    const lamRestored = assemble(card([rule(1.4)]), 9_500).equalShockLambda;
    expect(lamBefore).toBeGreaterThan(0);
    expect(lamChanged).toBeLessThan(lamBefore); // r 이 높을수록 여유가 준다
    expect(lamRestored).toBe(lamBefore);

    // ── 해소 4경로 ──
    expect(changed.paths).not.toEqual(before.paths);
    expect(restored.paths).toEqual(before.paths);

    // ── 처분 수량 ──
    expect(changed.liquidation!.qty).toBeGreaterThan(before.liquidation!.qty);
    expect(restored.liquidation).toEqual(before.liquidation);

    /**
     * ⚠ **묶어서 한 번 더 대조한다.** 위 개별 단언 중 하나가 나중에 지워지면
     *   "따라온다"가 조용히 부분적으로만 참이 된다. 통째 비교는 그걸 막는다.
     */
    const bundle = (x: ReturnType<typeof assemble>) => ({
      shortfall: x.shortfall,
      paths: x.paths,
      liquidation: x.liquidation,
      equalShockLambda: x.equalShockLambda,
    });
    expect(bundle(changed)).not.toEqual(bundle(before));
    expect(bundle(restored)).toEqual(bundle(before));

    /**
     * ⚠ 위 셋은 원장 r 을 카드에서 파생시켜 만든다(`assemble` 머리글). 그래서 이것만으로는
     *   *"카드가 구동한다"* 와 *"원장이 구동하는데 둘이 같아서 그렇게 보인다"* 를 못 가른다 —
     *   실제로 `const r = policy.ratio` 를 `p.ledger.requiredRatio` 로 되돌리는 뮤테이션이
     *   위 단언을 하나도 못 깨뜨렸다. **원장을 고정한 채** 카드만 바꿔서 그 자리를 막는다.
     */
    const cardDriven = assembleRiskResult({
      positions: at(8_100),
      ledger: { loan: LOAN, cash: 0, requiredRatio: 1.4 }, // 고정 — 카드만 1.5 다
      card: card([rule(1.5)]),
      f: ASSUMED_F,
    });
    expect(cardDriven.shortfall).toBe(900_000); // 원장 1.4 로 재면 300,000 이다
    expect(cardDriven.paths).toEqual(changed.paths);
    // 원장과 갈렸으므로 수량만 막힌다 — 부족액·4경로는 카드 값으로 그대로 나온다
    expect(cardDriven.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED");
  });

  it("원장은 더 이상 구동하지 않는다 — 원장만 바꿔도 부족액이 그대로다", () => {
    const c = card([rule(1.4)]);
    const withLedger14 = assembleRiskResult({
      positions: at(8_100),
      ledger: { loan: LOAN, cash: 0, requiredRatio: 1.4 },
      card: c,
      f: ASSUMED_F,
    });
    const withLedger17 = assembleRiskResult({
      positions: at(8_100),
      ledger: { loan: LOAN, cash: 0, requiredRatio: 1.7 },
      card: c,
      f: ASSUMED_F,
    });

    // 부족액은 카드가 정한다 — 원장이 달라도 같다
    expect(withLedger17.shortfall).toBe(withLedger14.shortfall);
    expect(withLedger17.paths).toEqual(withLedger14.paths);
    // 다만 원장은 **제2 의견**으로 살아 있다 — 갈리면 수량을 막는다 (#55 규약 유지)
    expect(withLedger14.liquidation).not.toBeNull();
    expect(withLedger17.liquidation).toBeNull();
    expect(withLedger17.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED");
  });
});

describe("policyRatio — 하나로 정해지는가", () => {
  it("한 줄이면 그 값. centi 격자로 정규화한다", () => {
    expect(policyRatio(card([rule(1.4)]))).toMatchObject({
      resolved: true,
      ratio: 1.4,
      centi: 140,
    });
  });

  it("같은 값이 두 줄이면 정해진다 — 길이가 아니라 **값의 갈림**으로 본다", () => {
    expect(policyRatio(card([rule(1.4), rule(1.404)]))).toMatchObject({
      resolved: true,
      centi: 140,
    });
  });

  it("좁힌 뒤에도 값이 갈리면 AMBIGUOUS — 그중 하나를 고르지 않는다", () => {
    const ambiguous = card([
      rule(1.4, { product_type: "신용융자A" }),
      rule(1.2, { product_type: "신용융자B" }),
    ]);
    expect(policyRatio(ambiguous)).toMatchObject({
      resolved: false,
      why: "AMBIGUOUS",
      candidates: [120, 140],
    });
  });

  it("조항이 없으면 NO_RULE, 비유한수면 NON_FINITE", () => {
    expect(policyRatio(card([]))).toMatchObject({ resolved: false, why: "NO_RULE" });
    expect(policyRatio(card([rule(Number.NaN)]))).toMatchObject({
      resolved: false,
      why: "NON_FINITE",
    });
  });

  it("고른 **조항 그 자체**를 내보낸다 — 화면이 계산과 다른 행을 찍지 않게", () => {
    const c = card([rule(1.2, { product_type: "대주" }), rule(1.4)]);
    const p = policyRatio(c, at(8_100, "일반")[0]);
    expect(p).toMatchObject({ resolved: true, centi: 140 });
    expect((p as { selected: RatioRule[] }).selected).toEqual([c.ratio_rules[1]]);
  });
});

describe("좁히기는 ratioAgreement 와 **같은 구현**이다", () => {
  /**
   * 두 벌로 두면 게이트가 고른 조항과 계산이 쓴 값이 갈릴 수 있다. 그건
   * `RatioAgreement.selected` 를 내보내면서까지 없앤 결함의 재판이다.
   * 값을 따로 비교하는 대신 **같은 좁히기 함수를 통과했는지**를 본다.
   */
  const cases: ConditionCard[] = [
    card([rule(1.4)]),
    card([rule(1.2, { product_type: "대주" }), rule(1.4)]),
    card([rule(1.4, { symbol_group: "전체" }), rule(1.5, { symbol_group: "일반" })]),
    card([rule(1.4, { product_type: "마진론" }), rule(1.2, { product_type: "Margin Loan" })]),
  ];

  it.each(cases.map((c, i) => [i, c] as const))("케이스 %i — selected 가 일치한다", (_i, c) => {
    const pos = at(8_100, "일반")[0]!;
    const narrowed = narrowRatioRules(c, pos);
    const agreement = ratioAgreement(c, 1.4, pos);
    const p = policyRatio(c, pos);

    expect(agreement.cardRatios).toEqual(narrowed.centis);
    expect(agreement.selected).toEqual(narrowed.selected);
    if (p.resolved) expect(p.selected).toEqual(narrowed.selected);
  });
});

describe("정하지 못하면 숫자를 내지 않는다", () => {
  const ambiguous = card([
    rule(1.4, { product_type: "신용융자A" }),
    rule(1.2, { product_type: "신용융자B" }),
  ]);

  it("AMBIGUOUS 카드로 조립하면 던진다 — 원장 리터럴로 메우지 않는다", () => {
    expect(() => assemble(ambiguous)).toThrow(PolicyRatioUnresolvedError);
    try {
      assemble(ambiguous);
      expect.unreachable("던졌어야 한다");
    } catch (error) {
      expect(error).toMatchObject({ code: "AMBIGUOUS", candidates: [120, 140] });
    }
  });

  it("조항이 없어도 던진다 — 빈 카드에서 조용히 원장으로 넘어가지 않는다", () => {
    expect(() => assemble(card([]))).toThrow(PolicyRatioUnresolvedError);
  });

  it("조회(policyRatio)는 던지지 않는다 — 화면이 문구를 고를 수 있어야 한다", () => {
    expect(() => policyRatio(card([]))).not.toThrow();
  });
});
