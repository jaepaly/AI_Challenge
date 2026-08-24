/**
 * 유지비율 대조 — 카드 r ↔ 원장 r (RATIO_NOT_CONFIRMED).
 * ---------------------------------------------------------------------------
 * 이 파일이 지키는 결함:
 *   assembleRiskResult는 card와 ledger를 둘 다 받으면서 r은 ledger.requiredRatio
 *   하나에서만 뽑았다. card.ratio_rules[].ratio는 엔진 전체에서 한 줄도 읽히지
 *   않았고, 둘이 어긋나도 표식이 없었다. 실측:
 *       카드 1.4 / 원장 1.4 → D 300,000 · 135% · 195주
 *       카드 1.7 / 원장 1.4 → D 300,000 · 135% · 195주   ← 카드가 통째로 무시됨
 *       카드 1.7 / 원장 1.7 → D 2,100,000 · 135% · 583주
 *   담보비율이 V/L이라 세 경우 모두 135%로 같아 눈으로도 안 잡혔다.
 *
 * ⚠ **기존 픽스처로는 이 결함이 재현되지 않는다.** 엔진 테스트 픽스처 4개와 웹
 *   프리셋이 전부 카드 1.4 · 원장 1.4라, 대조를 throw로 넣든 사유코드로 넣든
 *   기존 75건은 하나도 깨지지 않는다. 그래서 어긋난 카드를 여기서 손으로 만든다 —
 *   이 파일이 없으면 고쳐도 회귀 가드가 서지 않는다.
 *
 * 규약: 어긋남에서 막는 것은 **처분 수량 하나**다. 부족액·담보비율·λ*·해소 4경로는
 * 원장 r만으로 정해지므로 그대로 나온다(접으면 throw와 같아진다 — #30·#33과 어긋난다).
 */
import { describe, it, expect } from "vitest";
import { TEST_EVIDENCE } from "./evidence-fixture";
import { assembleRiskResult, ratioAgreement } from "../src/index";
import type { ConditionCard, CreditLedger, Position, RatioRule } from "../src/index";

const ASSUMED_F = 0.008;

function positions(prevClose: number, qty = 1_000, group?: string): Position[] {
  return [{ symbol: "000001", qty, prevClose, ...(group !== undefined ? { group } : {}) }];
}
function ledger(requiredRatio: number, loan = 6_000_000, cash = 0): CreditLedger {
  return { loan, cash, requiredRatio };
}

/** 융자·주식·일반 한 줄짜리 룰 — 축을 명시할 때만 인자로 덮는다 */
function rule(p: {
  ratio: number;
  product_type?: string;
  symbol_group?: string;
  collateral_type?: string;
}): RatioRule {
  return {
    product_type: p.product_type ?? "신용거래융자",
    collateral_type: p.collateral_type ?? "주식",
    symbol_group: p.symbol_group ?? "일반",
    ratio: p.ratio,
    evidence: TEST_EVIDENCE,
  };
}

/** 카드 — ratio_rules와 threshold_ratio를 따로 준다(둘은 서로 다른 r이다) */
function makeCard(p: {
  rules: RatioRule[];
  thresholdRatio?: number;
  noDiscountRule?: boolean;
  status?: "verified" | "draft";
  verified_at?: string;
}): ConditionCard {
  return {
    broker: "테스트",
    ratio_rules: p.rules,
    account_aggregation: "max",
    disposal_price_rules: p.noDiscountRule
      ? []
      : [
          {
            trigger: "margin_call",
            symbol_group: "일반",
            discount_basis: "prev_close_pct",
            discount_rate: 0.15,
            source_confidence: "explicit",
            evidence: TEST_EVIDENCE,
          },
        ],
    execution_schedule: [
      { threshold_ratio: p.thresholdRatio ?? 1.4, day_counting: "D+2", evidence: TEST_EVIDENCE },
    ],
    ratio_source: "clause",
    doc_version: { review_no: "TEST" },
    status: p.status ?? "verified",
    ...(p.verified_at !== undefined ? { verified_at: p.verified_at } : {}),
  };
}

/** 카드 r 하나짜리 편의 생성자 */
const cardR = (ratio: number) => makeCard({ rules: [rule({ ratio })] });

describe("어긋남 — A가 실측한 3행 재현", () => {
  it("카드 1.4 / 원장 1.4: 통과 — 195주 그대로 (회귀)", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: cardR(1.4),
      f: ASSUMED_F,
    });
    expect(r.shortfall).toBe(300_000);
    expect(r.marginRatioPct).toBe(135);
    expect(r.liquidation).toMatchObject({ mode: "PARTIAL", qty: 195, k: 0.19 });
    expect(r.liquidationSkipped).toBeUndefined();
  });

  it("카드 1.7 / 원장 1.4: 처분 수량만 차단 — 195주를 내지 않는다", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: cardR(1.7),
      f: ASSUMED_F,
    });
    expect(r.liquidation).toBeNull();
    expect(r.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED");
  });

  it("카드 1.7 / 원장 1.4: 부족액·λ*·4경로가 **카드 r 로 나온다** (#67 A-1)", () => {
    const mismatch = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: cardR(1.7),
      f: ASSUMED_F,
    });
    const agreed = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: cardR(1.4),
      f: ASSUMED_F,
    });

    /**
     * ⚠ 이 단언은 **A-1(#67) 에서 뒤집혔다.** 전에는 *"넷은 원장 r 만으로 정해지므로
     *   어긋남이 하나도 바꾸지 않는다"* 였다. (다) 채택 뒤 r 은 카드에서 나오므로
     *   카드를 1.4 → 1.7 로 바꾸면 **넷이 함께 따라온다.** 그게 A-1 의 요점이다.
     *
     *   막는 것은 여전히 **처분 수량 하나**다 — 아래 `liquidation` 은 null 이다.
     */
    expect(mismatch.shortfall).toBe(2_100_000); // 1.7×6,000,000 − 8,100,000
    expect(mismatch.marginRatioPct).toBe(135); // V/L 이라 r 과 무관 — 유일하게 안 변한다
    expect(mismatch.equalShockLambda).toBe(0); // 이미 관통 — 두 r 모두 0
    expect(mismatch.paths).toMatchObject({
      deposit: 2_100_000,
      repay: 1_235_295,
      collateral: null,
      voluntarySellQty: 378,
    });

    // 카드가 실제로 구동한다는 증거 — 원장이 같은데 산출이 갈린다
    expect(agreed.shortfall).toBe(300_000);
    expect(agreed.paths).toMatchObject({ deposit: 300_000, repay: 214_286, voluntarySellQty: 96 });
    expect(mismatch.shortfall).not.toBe(agreed.shortfall);
    expect(mismatch.paths).not.toEqual(agreed.paths);
  });

  it("카드 1.7 / 원장 1.7: 통과 — 583주가 그대로 나온다(막는 것은 어긋남이지 값이 아니다)", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.7),
      card: cardR(1.7),
      f: ASSUMED_F,
    });
    expect(r.shortfall).toBe(2_100_000);
    expect(r.marginRatioPct).toBe(135); // V/L이라 세 경우 모두 같다 — 눈으로 안 잡히던 그것
    expect(r.liquidation).toMatchObject({ mode: "PARTIAL", qty: 583 });
    expect(r.liquidationSkipped).toBeUndefined();
  });
});

describe("우선순위 — RATIO_NOT_CONFIRMED > NO_SHORTFALL > CARD_NOT_FRESH > NO_DISCOUNT_RATE", () => {
  it("어긋남 + 관통 안 함: NO_SHORTFALL이 아니라 RATIO_NOT_CONFIRMED", () => {
    /**
     * 카드 1.4 로 재면 D=0 이다(8,500,000 ≥ 1.4×6,000,000). 그러니 사유코드를 값으로만
     * 고르면 NO_SHORTFALL 이 나간다 — 화면은 *"여유가 있다"* 고 말하고 원장 1.7 과의
     * 어긋남은 사유코드에서 통째로 사라진다.
     *
     * ⚠ A-1(#67) 전에는 방향이 반대였다(원장이 구동, 카드가 대조). 이제 카드가 구동하고
     *   원장이 제2 의견이라, 이 검사도 **카드 기준 D=0** 으로 다시 세웠다. 지키는 성질은
     *   같다: **하나로 맞추지 못한 상태에서 "관통하지 않는다"는 말 자체가 미정이다.**
     */
    const r = assembleRiskResult({
      positions: positions(8_500),
      ledger: ledger(1.7),
      card: cardR(1.4),
      f: ASSUMED_F,
    });
    expect(r.shortfall).toBe(0); // 카드 r 기준 산출은 그대로 낸다
    expect(r.liquidation).toBeNull();
    expect(r.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED");
  });

  it("어긋남 + STALE: CARD_NOT_FRESH가 아니라 RATIO_NOT_CONFIRMED", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: makeCard({ rules: [rule({ ratio: 1.7 })], verified_at: "2026-08-09" }),
      f: ASSUMED_F,
      asOf: "2026-09-09", // 만 31일 — STALE
    });
    expect(r.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED");
  });

  it("어긋남 + h 부재: NO_DISCOUNT_RATE가 아니라 RATIO_NOT_CONFIRMED", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: makeCard({ rules: [rule({ ratio: 1.7 })], noDiscountRule: true }),
      f: ASSUMED_F,
    });
    expect(r.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED");
  });

  it("일치하면 기존 셋의 상대 순서는 그대로 — STALE + h 부재는 여전히 CARD_NOT_FRESH", () => {
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: makeCard({
        rules: [rule({ ratio: 1.4 })],
        noDiscountRule: true,
        verified_at: "2026-08-09",
      }),
      f: ASSUMED_F,
      asOf: "2026-09-09",
    });
    expect(r.liquidationSkipped).toBe("CARD_NOT_FRESH");
  });
});

describe("ratioAgreement — 좁히기 규칙", () => {
  /** 한투 인용문에 실재하는 3행: 융자 140 / 대주 120 / 대주전용 105 */
  const hantooThreeRows = [
    rule({ ratio: 1.4, product_type: "신용거래융자", symbol_group: "전체" }),
    rule({ ratio: 1.2, product_type: "신용거래대주", symbol_group: "전체" }),
    rule({
      ratio: 1.05,
      product_type: "신용거래대주",
      collateral_type: "계좌",
      symbol_group: "전체",
    }),
  ];

  it("3행 완전추출 / 원장 1.4: 통과 — 융자행으로 좁혀 하나가 된다", () => {
    const a = ratioAgreement(makeCard({ rules: hantooThreeRows }), 1.4);
    expect(a).toEqual({
      agreed: true,
      cardRatios: [140],
      // 좁히기가 **어느 조항을 골랐는지**까지 내보낸다 — 근거 패널이 이 조항을 찍는다.
      // 값만 내보내면 화면은 ratio_rules[0](=대주 120%)을 좌표와 함께 크게 찍고,
      // 게이트가 본 융자행은 화면 어디에도 없게 된다.
      selected: [hantooThreeRows[0]],
      ledgerRatio: 140,
      why: "COMPARED",
    });
  });

  it("3행 완전추출 / 원장 1.2: **차단** — 집합 소속으로 보면 뚫리는 그 자리", () => {
    // 120이 카드 안에 있다고 통과시키면, 원장이 낡아 1.2일 때 D=0·NO_SHORTFALL이
    // 무표식으로 나간다(원장 1.4면 D=300,000). 부족액 100% 과소 + 완전 침묵.
    const a = ratioAgreement(makeCard({ rules: hantooThreeRows }), 1.2);
    expect(a.agreed).toBe(false);
    expect(a.cardRatios).toEqual([140]); // 대주행이 아니라 융자행으로 좁힌 결과
    expect(a.ledgerRatio).toBe(120);
    expect(a.why).toBe("COMPARED");
  });

  it("룰이 하나면 라벨을 아예 보지 않는다 — 통제 어휘가 없는 자유 문자열이다", () => {
    const odd = makeCard({
      rules: [rule({ ratio: 1.4, product_type: "Margin Loan", symbol_group: "A∙B군" })],
    });
    // 종목군도 상품유형도 안 맞지만 값이 하나뿐이라 좁힐 것이 없다 → 통과
    expect(ratioAgreement(odd, 1.4, positions(8_100, 1_000, "일반")[0]).agreed).toBe(true);
  });

  it("같은 값이 두 줄이면 통과 — 길이가 아니라 **값의 갈림**으로 판정한다", () => {
    const dup = makeCard({
      rules: [
        rule({ ratio: 1.4, symbol_group: "일반" }),
        rule({ ratio: 1.4, symbol_group: "관리" }),
      ],
    });
    const a = ratioAgreement(dup, 1.4);
    expect(a).toEqual({
      agreed: true,
      cardRatios: [140],
      selected: dup.ratio_rules, // 값이 같아 좁힐 이유가 없다 — 둘 다 남는다
      ledgerRatio: 140,
      why: "COMPARED",
    });
  });

  it("종목군이 맞으면 좁혀서 통과 — 메리츠 A∙B군 140 / C∙D군 150", () => {
    const meritz = makeCard({
      rules: [
        rule({ ratio: 1.4, symbol_group: "A∙B군" }),
        rule({ ratio: 1.5, symbol_group: "C∙D군" }),
      ],
    });
    const a = ratioAgreement(meritz, 1.4, positions(8_100, 1_000, "A∙B군")[0]);
    expect(a).toEqual({
      agreed: true,
      cardRatios: [140],
      selected: [meritz.ratio_rules[0]],
      ledgerRatio: 140,
      why: "COMPARED",
    });
  });

  it("종목군이 안 맞으면 좁히기를 버린다 — 비우지 않는다(보수 방향으로 AMBIGUOUS)", () => {
    // 포지션 group="일반"은 이 문서에 없는 어휘다. 걸러서 0으로 만들면 NO_RULE이
    // 되는데, 그건 "카드에 조항이 없다"는 틀린 말이다. 후보를 남기고 갈림을 말한다.
    const meritz = makeCard({
      rules: [
        rule({ ratio: 1.4, symbol_group: "A∙B군" }),
        rule({ ratio: 1.5, symbol_group: "C∙D군" }),
      ],
    });
    const a = ratioAgreement(meritz, 1.4, positions(8_100, 1_000, "일반")[0]);
    expect(a.agreed).toBe(false);
    expect(a.cardRatios).toEqual([140, 150]);
    expect(a.why).toBe("AMBIGUOUS");
  });

  it("포지션을 안 주면 종목군 축을 쓰지 않는다 — 없는 정보를 지어내지 않는다", () => {
    const meritz = makeCard({
      rules: [
        rule({ ratio: 1.4, symbol_group: "A∙B군" }),
        rule({ ratio: 1.5, symbol_group: "C∙D군" }),
      ],
    });
    expect(ratioAgreement(meritz, 1.4).why).toBe("AMBIGUOUS");
  });

  it("product_type에 '융자'가 없으면 tie-break가 죽는다 — 값이 갈리면 차단(보수)", () => {
    const noVocab = makeCard({
      rules: [
        rule({ ratio: 1.4, product_type: "마진론", symbol_group: "전체" }),
        rule({ ratio: 1.2, product_type: "Margin Short", symbol_group: "전체" }),
      ],
    });
    const a = ratioAgreement(noVocab, 1.4);
    expect(a.agreed).toBe(false);
    expect(a.cardRatios).toEqual([120, 140]);
    expect(a.why).toBe("AMBIGUOUS");
  });

  /**
   * 축의 순서 — 융자(관련성) → 종목군(선택).
   *
   * 종목군을 먼저 걸면 후보가 하나로 줄어드는 순간 융자 tie-break가 건너뛰어지고,
   * 그 하나가 대주행이면 카드의 융자행은 **한 번도 읽히지 않는다.** 그때 두 방향이
   * 모두 뒤집히는데, 나쁜 쪽은 낙관 방향이다 — 이 게이트가 집합소속 방식을 기각한
   * 근거가 정확히 "원장 1.2에서 D=0·NO_SHORTFALL이 무표식으로 나간다"였다.
   */
  describe("좁히기 축의 순서 — 관련성이 선택보다 먼저다", () => {
    /** 융자행은 종목군 라벨이 "전체", 대주행만 포지션의 "일반"과 글자가 같다 */
    const loanWide = makeCard({
      rules: [
        rule({ ratio: 1.4, product_type: "신용거래융자", symbol_group: "전체" }),
        rule({ ratio: 1.2, product_type: "신용거래대주", symbol_group: "일반" }),
      ],
    });
    const at = positions(8_100, 1_000, "일반")[0];

    it("대주행이 종목군과 맞아도 융자행으로 좁힌다 — 정상 카드를 막지 않는다", () => {
      const a = ratioAgreement(loanWide, 1.4, at);
      expect(a.cardRatios).toEqual([140]); // 대주 120이 아니다
      expect(a.agreed).toBe(true);
      expect(a.selected).toEqual([loanWide.ratio_rules[0]]);
    });

    it("**낙관 구멍**: 원장이 대주행과 우연히 같아도 통과시키지 않는다", () => {
      // 원장 1.2는 카드의 융자행 140%와 어긋난다. 대주행 120%로 좁혀 통과시키면
      // 어긋남의 흔적이 통째로 사라진다.
      const a = ratioAgreement(loanWide, 1.2, at);
      expect(a.cardRatios).toEqual([140]);
      expect(a.agreed).toBe(false);

      const r = assembleRiskResult({
        positions: positions(8_100, 1_000, "일반"),
        ledger: ledger(1.2),
        card: loanWide,
        f: ASSUMED_F,
        asOf: "2026-08-19",
      });
      // A-1(#67) 뒤: 카드가 정한 융자행 140%로 재므로 관통한다. 전에는 원장 1.2 로 재
      // D=0 이 나왔고, 그 침묵이 이 게이트가 없애려던 낙관 구멍 그 자체였다.
      expect(r.shortfall).toBe(300_000);
      expect(r.liquidationSkipped).toBe("RATIO_NOT_CONFIRMED"); // 그래도 침묵하지 않는다
    });

    it("포지션을 주는 것이 답을 나쁘게 만들지 않는다 — 안 줬을 때와 같다", () => {
      // 정보를 더 주면 좁혀지거나 그대로여야 한다. 관련 없는 조항으로 **갈아타면**
      // 안 된다 — 종목군을 먼저 걸던 때가 그랬다.
      for (const led of [1.4, 1.2, 1.7]) {
        expect(ratioAgreement(loanWide, led, at).cardRatios).toEqual(
          ratioAgreement(loanWide, led).cardRatios,
        );
      }
    });

    it("종목군 차등은 그대로 산다 — 융자끼리는 관련성이 갈리지 않는다", () => {
      // 두 행이 모두 융자면 ①은 no-op이고 ②가 판정한다(메리츠 A∙B군 140 / C∙D군 150).
      const meritz = makeCard({
        rules: [
          rule({ ratio: 1.4, symbol_group: "A∙B군" }),
          rule({ ratio: 1.5, symbol_group: "C∙D군" }),
        ],
      });
      expect(ratioAgreement(meritz, 1.5, positions(8_100, 1_000, "C∙D군")[0]).agreed).toBe(true);
      expect(ratioAgreement(meritz, 1.4, positions(8_100, 1_000, "C∙D군")[0]).agreed).toBe(false);
    });

    it("융자 좁히기 뒤에도 여럿이면 종목군이 이어서 좁힌다 — 축이 죽지 않는다", () => {
      const three = makeCard({
        rules: [
          rule({ ratio: 1.4, product_type: "신용거래융자", symbol_group: "A∙B군" }),
          rule({ ratio: 1.5, product_type: "신용거래융자", symbol_group: "C∙D군" }),
          rule({ ratio: 1.2, product_type: "신용거래대주", symbol_group: "전체" }),
        ],
      });
      const a = ratioAgreement(three, 1.5, positions(8_100, 1_000, "C∙D군")[0]);
      expect(a.cardRatios).toEqual([150]);
      expect(a.agreed).toBe(true);
    });
  });

  it("ratio_rules가 비면 NO_RULE — 맞춰 볼 값이 없는 것을 통과로 읽지 않는다", () => {
    const a = ratioAgreement(makeCard({ rules: [] }), 1.4);
    expect(a).toEqual({
      agreed: false,
      cardRatios: [],
      selected: [], // 고른 조항이 없다 — 화면이 찍을 근거도 없다
      ledgerRatio: 140,
      why: "NO_RULE",
    });
  });
});

describe("ratioAgreement — 범위와 격자", () => {
  it("threshold_ratio는 이 대조에 넣지 않는다 ①: 2단 임계 정상 카드를 막지 않는다", () => {
    // types.ts ExecutionScheduleRule이 "1.4 부족판정 / 1.2~1.3 2단 임계"를 정상으로 계약한다
    const twoStage = makeCard({ rules: [rule({ ratio: 1.4 })], thresholdRatio: 1.2 });
    expect(ratioAgreement(twoStage, 1.4).agreed).toBe(true);
  });

  it("threshold_ratio는 이 대조에 넣지 않는다 ②: 넣으면 어긋남이 오히려 가려진다", () => {
    // 카드 1.7 / threshold 1.2 / 원장 1.2 — 합집합 {170,120}으로 보면 120∈집합이라
    // 170% 어긋남이 사라진다. ratio_rules만 보므로 그대로 잡힌다.
    const masking = makeCard({ rules: [rule({ ratio: 1.7 })], thresholdRatio: 1.2 });
    const a = ratioAgreement(masking, 1.2);
    expect(a.agreed).toBe(false);
    expect(a.cardRatios).toEqual([170]);
    expect(a.ledgerRatio).toBe(120);
  });

  it("NaN은 Set에서 서로 같다 — 유일성 검사 앞에서 NON_FINITE로 걸러야 통과하지 않는다", () => {
    const nan = makeCard({ rules: [rule({ ratio: Number.NaN }), rule({ ratio: Number.NaN })] });
    const a = ratioAgreement(nan, 1.4);
    expect(a).toEqual({
      agreed: false,
      cardRatios: [],
      selected: [],
      ledgerRatio: 140,
      why: "NON_FINITE",
    });
  });

  it("원장 r이 유한수가 아니어도 NON_FINITE", () => {
    expect(ratioAgreement(cardR(1.4), Number.POSITIVE_INFINITY).why).toBe("NON_FINITE");
    expect(ratioAgreement(cardR(1.4), Number.NaN).why).toBe("NON_FINITE");
  });

  it("centi 격자 — 1.404와 1.400은 통과하고, 실제로 산출값이 같다", () => {
    // 격자를 더 촘촘히 하면 산출이 증명 가능하게 같은 카드를 막게 된다.
    // ⚠ 대신 이 검사는 근거 배지 문자열("140.4%")을 보호하지 않는다.
    expect(ratioAgreement(cardR(1.404), 1.4).agreed).toBe(true);
    const a = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: cardR(1.404),
      f: ASSUMED_F,
    });
    const b = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.4),
      card: cardR(1.4),
      f: ASSUMED_F,
    });
    expect(a.liquidation).toEqual(b.liquidation);
    expect(a.shortfall).toBe(b.shortfall);
  });

  it("1 centi만 달라도 갈린다 — 격자가 성기지 않다는 증거", () => {
    expect(ratioAgreement(cardR(1.41), 1.4).agreed).toBe(false);
    const r = assembleRiskResult({
      positions: positions(8_100),
      ledger: ledger(1.41),
      card: cardR(1.41),
      f: ASSUMED_F,
    });
    expect(r.liquidation?.qty).toBe(224); // 195가 아니다
  });

  it("[보증 안 함] 단일 대주 카드 + 대주에 맞춘 원장은 통과한다 — 상품유형을 볼 수단이 없다", () => {
    // CreditLedger에 product_type 대응 필드가 없어 이 게이트로는 닫히지 않는다.
    // 엔진은 그대로 융자 산식 D=max(0,r·L−V)로 계산한다. 별도 항목으로 남아 있다.
    const shortCard = makeCard({
      rules: [rule({ ratio: 1.2, product_type: "신용거래대주", collateral_type: "계좌" })],
    });
    expect(ratioAgreement(shortCard, 1.2).agreed).toBe(true);
  });
});
