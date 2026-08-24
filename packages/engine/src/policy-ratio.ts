/**
 * policyRatio — **계산에 쓸 담보유지비율을 카드에서 정한다** (#67 A-1, #64 P0-1).
 * ---------------------------------------------------------------------------
 * 채택안은 (다) 다: `ACCOUNT.requiredRatio` 리터럴을 없애고 **카드를 유일한 출처로**.
 *
 * 그 전까지 엔진은 r 을 `ledger.requiredRatio` 하나에서만 뽑았고 카드의
 * `ratio_rules[].ratio` 는 처분 수량을 막는 데만 쓰였다. D 가 실측한 모양이 이것이다:
 *
 *     카드만 1.5 · 원장 1.4    부족액 300,000    ← 카드를 바꿔도 안 따라온다
 *     원장만 1.5 · 카드 1.4    부족액 900,000    ← 원장이 단독 구동
 *
 * *"AI 가 약관을 읽고 엔진이 계산한다"* 가 우리 주장인데, **읽은 값이 계산에 닿지
 * 않았다.** 이 파일이 그 배선이다. 여기서 나온 r 로 부족액·임계가·λ*·해소 4경로가
 * 전부 정해진다.
 *
 * ── 못 정하면 숫자를 내지 않는다 ──────────────────────────────────────
 * 카드가 r 을 하나로 주지 못하면(여러 값이 남음·조항 없음·비유한수) **r 이 없다.**
 * 원장 리터럴로 대신 메우면 그 순간 (다) 가 아니고, 화면은 어디서 온지 모르는
 * 숫자를 근거 옆에 나란히 놓는다. 낙관 방향으로 조용히 틀릴 자리다.
 *
 * 그래서 조회는 `policyRatio`(던지지 않음)로, 조립은 throw 로 나눈다 —
 * `disposalDiscountRate`(null) ↔ `replay`(throw) 와 같은 규약이다. 호출부는
 * `policyRatio` 를 먼저 보고 *"유지비율을 하나로 정하지 못했습니다"* 를 그리면 된다.
 *
 * ── 좁히기는 `ratioAgreement` 와 **같은 구현을 쓴다** ──────────────────
 * 두 벌로 두면 게이트가 고른 조항과 계산이 쓴 값이 갈릴 수 있다. 그건 이 저장소가
 * `RatioAgreement.selected` 를 내보내면서까지 없앤 결함(게이트는 융자 140 을 보고
 * 화면은 대주 170 을 찍던 것)의 재판이다. `narrowRatioRules` 하나만 둔다.
 */

import type { ConditionCard, Position, RatioRule } from "./types";

/**
 * 비교 격자 — `shortfall`·`restorationCoefficientMicro`·`equalShockLambda` 가 쓰는 그 양자화.
 * 같은 격자를 써야 "카드가 정한 r" 과 "엔진이 실제로 계산한 r" 이 같다.
 */
export const centi = (x: number): number => Math.round(x * 100);

/**
 * 융자행 판별 — **좁히기용이다. 게이트로 쓰지 말 것.**
 * `product_type` 은 통제 어휘가 아니라 자유 문자열이라("신용융자"·"신용거래융자"·
 * "마진론"·"Margin Loan" 전부 실재 가능), 필터 게이트로 쓰면 어휘가 안 맞는 순간
 * 후보가 0 이 되어 정상 카드를 막는다. 아래에서는 "좁혀지면 좁히고, 비면 버린다".
 */
const isLoan = (productType: string): boolean =>
  productType.includes("융자") && !productType.includes("대주");

/** 좁히기 결과 — `policyRatio` 와 `ratioAgreement` 가 **함께** 쓰는 유일한 구현. */
export interface NarrowedRatioRules {
  /** 좁힌 뒤 남은 조항 — `card.ratio_rules` 의 부분집합이고 원래 순서를 지킨다 */
  selected: RatioRule[];
  /** 남은 값 — centi, 중복제거·오름차순 */
  centis: number[];
  /** OK = 값이 남았다(하나일 수도 여럿일 수도) */
  why: "OK" | "NO_RULE" | "NON_FINITE";
}

/**
 * 카드의 유지비율 조항을 **이 원장·이 종목에 해당하는 것들로** 좁힌다.
 *
 * 축의 순서는 **융자 → 종목군**이다. 두 축이 답하는 질문이 다르다:
 *   `product_type` = 이 조항이 **이 원장에 해당하는 상품인가**(관련성)
 *   `symbol_group` = 해당하는 것들 중 **이 종목에 걸리는 것**(선택)
 * 관련성을 먼저 거르지 않으면 선택이 관련 없는 조항을 골라 버린다. 근거 실측은
 * `ratioAgreement` 머리글에 그대로 있다 — 순서를 바꾸면 낙관 구멍이 열린다.
 *
 * 룰이 하나면 라벨을 **아예 보지 않는다.** 라벨 어휘는 문서마다 다른데(카드 "일반"
 * ↔ 문서 "A∙B군"), 하나뿐인 값을 라벨로 걸러 0 으로 만들면 정상 카드가 막힌다.
 */
export function narrowRatioRules(card: ConditionCard, pos?: Position): NarrowedRatioRules {
  let candidates = card.ratio_rules;

  // wire format 은 minItems:1 로 막지만 TS 타입은 빈 배열을 허용한다.
  if (candidates.length === 0) return { selected: [], centis: [], why: "NO_RULE" };
  // 유일성 검사보다 **먼저** 본다 — NaN 은 Set 에서 서로 같다고 취급돼 길이 1 을 통과한다.
  if (candidates.some((rule) => !Number.isFinite(rule.ratio))) {
    return { selected: [], centis: [], why: "NON_FINITE" };
  }

  if (candidates.length > 1) {
    // ① 관련성 — 이 원장은 융자 원장이다(D=max(0, r·L−V) 가 융자 산식).
    //    대주 조항이 섞여 있으면 먼저 뺀다. 전부 융자면 좁히지 않는다(정보가 없다).
    const loans = candidates.filter((rule) => isLoan(rule.product_type));
    if (loans.length > 0 && loans.length < candidates.length) candidates = loans;
    // ② 선택 — 남은 것들 중 이 종목에 걸리는 것. 어휘가 안 맞아 비면 버린다.
    const group = pos?.group;
    if (candidates.length > 1 && group !== undefined && group !== null) {
      const matched = candidates.filter((rule) => rule.symbol_group === group);
      if (matched.length > 0) candidates = matched; // 좁히되 비우지 않는다
    }
  }

  // 길이가 아니라 **값의 갈림**으로 본다 — 같은 값이 두 줄 있는 카드는 정상이다.
  const centis = [...new Set(candidates.map((rule) => centi(rule.ratio)))].sort((a, b) => a - b);
  return { selected: candidates, centis, why: "OK" };
}

/** 카드가 계산용 r 을 하나로 준 경우. */
export interface PolicyRatioResolved {
  resolved: true;
  /**
   * 계산에 쓸 담보유지비율(배수).
   *
   * ⚠ **centi 격자로 정규화된 값**이다(`centi/100`). 카드에 1.404 와 1.400 이
   *   함께 있으면 두 줄은 같은 값이고, 그중 어느 원본을 골랐는지가 답을 가르면
   *   안 된다. 엔진 산식이 어차피 `Math.round(r*100)` 으로 양자화하므로 이 값을
   *   그대로 넣은 결과와 원본을 넣은 결과는 같다.
   */
  ratio: number;
  /** 위 값의 centi 표현 */
  centi: number;
  /**
   * 이 값을 고른 조항들 — **화면이 근거로 찍어야 할 그 조항.**
   * 값(ratio)만 내보내면 화면은 `ratio_rules[0]` 을 찍게 되고, 좁히기가 다른 행을
   * 고르는 순간 계산과 화면이 서로 다른 조항을 본다.
   */
  selected: RatioRule[];
}

/** 카드가 계산용 r 을 하나로 주지 못한 경우 — **숫자를 내지 않는다.** */
export interface PolicyRatioUnresolved {
  resolved: false;
  /**
   *  AMBIGUOUS  = 좁힌 뒤에도 서로 다른 값이 남았다 — 그중 하나를 고르지 않는다
   *  NO_RULE    = ratio_rules 가 비었다
   *  NON_FINITE = ratio 가 숫자가 아니다(NaN·Infinity)
   */
  why: "AMBIGUOUS" | "NO_RULE" | "NON_FINITE";
  /** 좁힌 뒤 남은 값 — centi, 중복제거·오름차순. 화면이 "이 중 어느 것인지 모른다"를 말할 재료 */
  candidates: number[];
  /** 남은 조항 그 자체. NO_RULE·NON_FINITE 에서는 빈 배열이다 */
  selected: RatioRule[];
}

export type PolicyRatio = PolicyRatioResolved | PolicyRatioUnresolved;

/**
 * **카드에서 계산용 담보유지비율을 정한다.** 던지지 않는다(조회용).
 *
 * @param pos 종목군 좁히기용 포지션. 없으면 종목군 축을 쓰지 않는다(지어내지 않는다)
 */
export function policyRatio(card: ConditionCard, pos?: Position): PolicyRatio {
  const narrowed = narrowRatioRules(card, pos);

  if (narrowed.why !== "OK") {
    return { resolved: false, why: narrowed.why, candidates: [], selected: [] };
  }
  if (narrowed.centis.length !== 1) {
    return {
      resolved: false,
      why: "AMBIGUOUS",
      candidates: narrowed.centis,
      selected: narrowed.selected,
    };
  }

  const only = narrowed.centis[0]!;
  return { resolved: true, ratio: only / 100, centi: only, selected: narrowed.selected };
}

/**
 * 카드가 r 을 하나로 주지 못했는데 산출을 요구했을 때 던진다.
 *
 * `ReplayUnsupportedError` 와 같은 규약이다 — **왜 못 내는지를 코드로** 준다.
 * 화면은 이 예외를 잡는 대신 `policyRatio` 를 먼저 보는 편이 낫다.
 */
export class PolicyRatioUnresolvedError extends Error {
  readonly code: PolicyRatioUnresolved["why"];
  readonly candidates: number[];

  constructor(why: PolicyRatioUnresolved["why"], candidates: number[]) {
    const detail =
      why === "AMBIGUOUS"
        ? `좁힌 뒤에도 값이 갈린다(centi: ${candidates.join(", ")})`
        : why === "NO_RULE"
          ? "카드에 유지비율 조항이 없다"
          : "유지비율이 유한수가 아니다";
    super(`policyRatio: 카드에서 유지비율을 하나로 정하지 못했다 — ${detail}`);
    this.name = "PolicyRatioUnresolvedError";
    this.code = why;
    this.candidates = candidates;
  }
}
