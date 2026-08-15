/**
 * 스냅숏 조건카드가 엔진 규약대로 읽히는지 — 화면 쪽 검증
 * ---------------------------------------------------------------------------
 * h를 읽는 규약 자체는 엔진이 소유한다(`disposalDiscountRate`). 웹에 같은 함수가
 * 한 벌 더 있었는데(`lib/marginguard/card.ts`의 `cardH`) 본문이 글자 단위로
 * 같았고, `lower_limit → 0.3`이 두 곳에 박혀 있었다. 하한가 폭이 제도 변경으로
 * 바뀌면 두 파일을 동시에 고쳐야 하고, 한쪽만 고치면 화면과 엔진이 서로 다른
 * h로 계산한다 — h가 틀리면 k = r(1−h) − 1이 틀리고 처분 수량이 통째로 틀린다.
 * A가 #33에서 엔진 쪽을 export해줘서(#10 리뷰 약속) 웹 사본을 지웠다.
 *
 * 규약의 의미론(정상값 / lower_limit / 부재 / discount_rate 없음)은 엔진이
 * 덮는다 — packages/engine/test/riskresult.test.ts의
 * "disposalDiscountRate 조회 규약". 여기 남긴 둘은 엔진이 덮을 수 없는 것이다:
 *
 *  ① 우리 스냅숏 카드 3종이 실제로 그 규약에 맞는 모양인가 (웹 데이터 검증)
 *  ② null 대신 0을 돌려주면 화면에 무엇이 보이는가 (규약의 이유를 주 단위로 박음)
 *
 * ⚠ ②는 **회귀를 잡지 못한다.** 실측으로 확인했다 — 엔진에 `?? 0`을 주입해도
 * 웹 61건이 전부 통과한다. ②는 liquidationQty에 h를 리터럴로 넣기 때문에
 * disposalDiscountRate를 거치지 않고, ①의 스냅숏 3종은 값이 다 있어 폴백
 * 경로에 닿지 않는다. **그 회귀를 잡는 것은 엔진 테스트다**
 * (riskresult.test.ts "disposalDiscountRate 조회 규약" → expected +0 to be null).
 *
 * ②가 여기 있는 이유는 감시가 아니라 설명이다 — 엔진 테스트는 "null을
 * 돌려준다"까지만 말하고, 그게 왜 중요한지는 195주 대 93주로만 보인다.
 */
import { describe, expect, it } from "vitest";
import { disposalDiscountRate, liquidationQty, shortfall } from "@marginguard/engine";
import { ACCOUNT, CARDS } from "./snapshot";

describe("스냅숏 카드 — 엔진 h 읽기 규약과의 정합", () => {
  it("스냅숏 프리셋 3종을 규약대로 읽는다", () => {
    const byKey = Object.fromEntries(
      CARDS.map((c) => [c.key, disposalDiscountRate(c.card)]),
    );
    expect(byKey).toEqual({ hantoo: 0.15, meritz: 0.2, lower: 0.3 });
  });

  /**
   * 회귀 방지 — PR #10 리뷰에서 A가 지적한 낙관 방향 폴백.
   * 0을 돌려주면 k = r−1 = 0.4로 커져 처분 수량이 실제보다 작게 나온다.
   * 위험 진단 도구에서 "실제보다 안전해 보이는" 오류는 가장 나쁜 방향이라
   * 값을 추정하지 않고 null로 산정을 포기한다.
   *
   * ⚠ **이 테스트는 그 회귀를 잡지 않는다.** liquidationQty에 h를 리터럴로 넣어
   * disposalDiscountRate를 거치지 않기 때문이다(헤더 ② 참조). 잡는 것은
   * riskresult.test.ts "disposalDiscountRate 조회 규약"이고, 여기 있는 이유는
   * **왜 위험한지를 195주 대 93주로 보이기 위해서**다.
   */
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
