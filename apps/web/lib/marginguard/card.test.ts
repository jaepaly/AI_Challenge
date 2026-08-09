import { describe, expect, it } from "vitest";
import type { ConditionCard } from "@marginguard/engine";
import { liquidationQty, shortfall } from "@marginguard/engine";
import { cardH } from "./card";
import { ACCOUNT, CARDS } from "./snapshot";

/** 최소 카드 — disposal_price_rules만 시험 대상이다 */
function card(rules: ConditionCard["disposal_price_rules"]): ConditionCard {
  return {
    broker: "테스트",
    ratio_rules: [
      { product_type: "신용거래융자", collateral_type: "주식", symbol_group: "일반", ratio: 1.4 },
    ],
    account_aggregation: "max",
    disposal_price_rules: rules,
    execution_schedule: [{ threshold_ratio: 1.4, day_counting: "D일 평가 → D+2 집행" }],
    ratio_source: "clause",
    doc_version: {},
    status: "verified",
  };
}

describe("cardH — 산정 기준가 할인율 읽기 규약", () => {
  it("스냅숏 프리셋 3종을 규약대로 읽는다", () => {
    const byKey = Object.fromEntries(CARDS.map((c) => [c.key, cardH(c.card)]));
    expect(byKey).toEqual({ hantoo: 0.15, meritz: 0.2, lower: 0.3 });
  });

  it("lower_limit는 discount_rate가 없어도 하한가(0.3) 등가로 읽는다", () => {
    const h = cardH(
      card([
        {
          trigger: "담보부족",
          symbol_group: "일반",
          discount_basis: "lower_limit",
          source_confidence: "explicit",
        },
      ]),
    );
    expect(h).toBe(0.3);
  });

  /**
   * 회귀 방지 — PR #10 리뷰에서 A가 지적한 낙관 방향 폴백.
   * 0을 돌려주면 k = r−1 = 0.4로 커져 처분 수량이 실제보다 작게 나온다.
   * 위험 진단 도구에서 "실제보다 안전해 보이는" 오류는 가장 나쁜 방향이라
   * 값을 추정하지 않고 null로 산정을 포기한다.
   */
  it("prev_close_pct인데 discount_rate가 없으면 null — 0으로 폴백하지 않는다", () => {
    const h = cardH(
      card([
        {
          trigger: "담보부족",
          symbol_group: "일반",
          discount_basis: "prev_close_pct",
          source_confidence: "inferred_from_formula",
        },
      ]),
    );
    expect(h).toBeNull();
  });

  it("disposal_price_rules가 비어 있으면 null", () => {
    expect(cardH(card([]))).toBeNull();
  });

  it("0 폴백이 왜 위험한지 — h=0은 처분 수량을 실제의 절반 아래로 줄인다", () => {
    const price = 8_100;
    const D = shortfall(ACCOUNT.qty * price, ACCOUNT.loan, ACCOUNT.requiredRatio);
    const arg = { D, prevClose: price, r: ACCOUNT.requiredRatio, held: ACCOUNT.qty };

    const real = liquidationQty({ ...arg, h: 0.15 }); // 한투 실측
    const optimistic = liquidationQty({ ...arg, h: 0 }); // 폴백이 만들던 값

    expect(real.k).toBeCloseTo(0.19, 10);
    expect(real.qty).toBe(195);

    expect(optimistic.k).toBeCloseTo(0.4, 10); // h=0 → k = r − 1
    expect(optimistic.qty).toBe(93);

    // 폴백은 처분 규모를 실제의 절반 아래로 축소해 보여준다 → null로 막는 이유
    expect(optimistic.qty).toBeLessThan(real.qty / 2);
  });
});
