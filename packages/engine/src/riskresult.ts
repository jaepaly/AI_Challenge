/**
 * RiskResult 조립 — 엔진 출력 묶음 (README 5-A Day 5~6 · 8/17 게이트 항목 3).
 * ---------------------------------------------------------------------------
 * D의 계기판이 소비하는 단일 진입점이다: 카드 + 원장 + 포지션 → RiskResult.
 * "인제스트가 만든 카드로 화면이 서는가"를 이 함수 하나로 답한다.
 *
 * 신선도 규약 (#30 합의된 3단과 정합):
 *  - FRESH · DRAFT → 처분 수량 산출. draft 여부는 cardStatus로 전달되고,
 *    참고 모드 배너는 UI의 몫이다(경계 계약: "draft면 UI는 참고 모드 배너 필수").
 *  - STALE · NO_VERIFIED_AT → liquidation을 내지 않는다(README 5-A "계산 차단").
 *    부족액·담보비율·λ*·해소 4경로는 유지한다 — 카드 파라미터(h)와 무관하게
 *    원장의 유지비율만으로 정해지는 값들이다.
 *  - verified_at 오염은 조용히 강등하지 않는다 — assessCardFreshness가 던진다.
 *
 * 유지비율 대조 규약 (ratioAgreement — 아래):
 *  - 카드의 ratio_rules와 원장의 requiredRatio가 하나로 맞지 않으면 처분 수량만
 *    차단한다(RATIO_NOT_CONFIRMED). 부족액·담보비율·λ*·4경로는 그대로 낸다 —
 *    원장 r만으로 정해지는 값들이라, 원장이 맞다면 여전히 참이다.
 *  - **어느 쪽이 옳은지 판정하지 않는다.** 카드 r은 문서 근거를 통과한 값이고
 *    원장 r은 리터럴이다. 엔진이 말할 수 있는 것은 "하나로 맞추지 못했다"까지다.
 */

import type { ConditionCard, CreditLedger, Position, RatioRule, RiskResult } from "./types";
import { assessCardFreshness } from "./freshness";
import {
  equalShockLambda,
  liquidationQty,
  marginRatioPct,
  resolutionPaths,
  shortfall,
} from "./index";
import {
  centi,
  narrowRatioRules,
  policyRatio,
  PolicyRatioUnresolvedError,
} from "./policy-ratio";

/**
 * 카드에서 처분 산정 h를 뽑는다 — 못 뽑으면 null (throw하지 않는 조회용).
 * lower_limit는 가격제한폭 −30% 등가(k=−0.02 → 전량 폴백이 자연히 나온다).
 * apps/web의 cardH와 같은 규약 — 웹은 이 export로 교체하면 중복이 사라진다(#10 리뷰 약속).
 * ※ replay 계열은 같은 조회를 거부(throw)로 처리한다 — 경로 시뮬은 h 없이 진행이
 *   무의미하지만, 조립은 h 없이도 부족액·4경로를 낼 수 있어 규약이 다르다.
 */
export function disposalDiscountRate(card: ConditionCard): number | null {
  const rule = card.disposal_price_rules[0];
  if (!rule) return null;
  if (rule.discount_basis === "lower_limit") return 0.3;
  return rule.discount_rate ?? null;
}



/** 카드 r ↔ 원장 r 대조 결과. */
export interface RatioAgreement {
  /** 카드에서 유지비율이 정확히 하나로 좁혀졌고 그것이 원장 값과 같은가 */
  agreed: boolean;
  /** 좁힌 뒤 남은 카드 유지비율 — centi, 중복제거·오름차순. 화면이 나란히 놓을 재료 */
  cardRatios: number[];
  /**
   * 좁힌 뒤 남은 **조항 그 자체** — `card.ratio_rules`의 부분집합이고 원래 순서를 지킨다.
   * NO_RULE·NON_FINITE에서는 빈 배열이다(고른 조항이 없다).
   *
   * 왜 값(cardRatios) 말고 조항까지 내보내는가 — **화면이 이 대조가 본 그 조항을
   * 근거로 찍게 하기 위해서다.** 근거 패널은 카드의 유지비율을 좌표·해시와 함께
   * 크게 찍는데, 그 자리가 `ratio_rules[0]`으로 고정돼 있으면 좁히기가 다른 행을
   * 고르는 순간 **게이트와 화면이 서로 다른 조항을 본다.** 실측 대가(카드
   * [대주 1.7, 융자 1.4] · 원장 1.4):
   *     게이트 = 융자 140 → 원장과 일치 → 통과(수량 195주, 표식 없음)
   *     화면   = ratio_rules[0] = 대주 170%를 좌표·해시와 함께 크게 표시
   * 화면은 "근거 있는 170%"와 "140%로 낸 부족액 300,000원"을 아무 표식 없이
   * 나란히 낸다 — 이 게이트가 없애려던 바로 그 모양이 그대로 복원된다.
   * 반대 방향도 같은 뿌리다: 어긋남 문구가 "옆 값 170%"라고 쓰는데 옆에 찍힌
   * 값은 120%인 화면이 나온다.
   *
   * ⚠ 이 배열은 **조항의 선택**이지 "이 조항이 맞다"는 판정이 아니다. 좁히기가
   *   하나로 만들지 못하면(AMBIGUOUS) 여럿이 그대로 남고, 화면은 그중 하나를
   *   고르지 않는다고 말해야 한다.
   */
  selected: RatioRule[];
  /** 원장 유지비율 — centi */
  ledgerRatio: number;
  /**
   *  COMPARED   = 카드 값이 하나로 좁혀져 원장과 맞대 봤다(agreed는 그 결과)
   *  AMBIGUOUS  = 좁힌 뒤에도 서로 다른 값이 남았다 — 화면이 그중 하나를 고르지 않는다
   *  NO_RULE    = ratio_rules가 비었다 — 맞춰 볼 값이 없다
   *  NON_FINITE = 어느 한쪽이 숫자가 아니다(NaN·Infinity)
   */
  why: "COMPARED" | "AMBIGUOUS" | "NO_RULE" | "NON_FINITE";
}

/**
 * 카드의 담보유지비율과 원장의 담보유지비율이 **하나로 맞는가**.
 *
 * ── 왜 "집합에 들어 있으면 통과"가 아닌가 ─────────────────────────────
 * 카드가 {140, 120, 105}(한투 3행: 융자·대주·대주전용)를 싣고 원장이 낡아 1.2면
 * 집합 소속 검사는 참이라 무표식 통과한다. 실측 대가:
 *     원장 1.4 → D=300,000 · 처분 195주 (정답)
 *     원장 1.2 → D=      0 · NO_SHORTFALL   ← 부족액 100% 과소 + 완전 침묵
 * 낙관 방향으로 조용히 뚫리는 것이 우리가 고치려던 결함의 더 나쁜 판본이다.
 * 그래서 **좁혀서 하나로 만든 뒤 등호로 본다.**
 *
 * ── 왜 threshold_ratio를 같은 등식에 넣지 않는가 ──────────────────────
 * ① types.ts의 ExecutionScheduleRule이 `1.4 부족판정 / 1.2~1.3 2단 임계`를 **정상으로
 *    계약**한다. 같은 등식에 접으면 정상 카드(메리츠 2단 임계)를 위반으로 판정한다.
 * ② 오히려 어긋남을 **가린다** — 카드 1.7 / threshold 1.2 / 원장 1.2면 합집합
 *    {170,120}이 원장 120을 품어 170% 어긋남이 사라진다.
 * 세 번째 r은 지금 계산에 닿지 않는다(엔진 src에서 읽는 코드 0건). 집행 시점을
 * threshold로 배선하는 날 **전용 대조가 따로** 필요하다.
 *
 * ── 좁히기 규칙 ───────────────────────────────────────────────────────
 * 룰이 하나면 라벨(symbol_group·product_type)을 **아예 보지 않는다.** 라벨 어휘는
 * 문서마다 다른데(카드 "일반" ↔ 문서 "A∙B군"), 하나뿐인 값을 라벨로 걸러 0으로
 * 만들면 정상 카드가 막힌다. 여럿일 때만 좁히고, 좁히기가 후보를 비우면 좁히기를
 * 버린다 — **좁히되 비우지 않는다.**
 *
 * 축의 **순서는 융자 → 종목군**이다. 두 축이 답하는 질문이 다르다:
 *   product_type = 이 조항이 **이 원장에 해당하는 상품인가**(관련성)
 *   symbol_group = 해당하는 것들 중 **이 종목에 걸리는 것**(선택)
 * 관련성을 먼저 거르지 않으면 선택이 관련 없는 조항을 골라 버린다. 실측(카드
 * [{융자,전체,1.4}, {대주,일반,1.2}] · 포지션 group="일반"):
 *     종목군 먼저 → 후보가 {대주 120} 하나로 줄고, 하나가 된 순간 융자 tie-break가
 *       건너뛰어져 카드의 융자행 140%는 **한 번도 읽히지 않는다.**
 *       원장 1.4(융자행과 일치) → 차단 / 원장 1.2(융자행과 어긋남) → 통과.
 *       두 방향 다 뒤집히고, 뒤쪽은 D=0·NO_SHORTFALL이 무표식으로 나가는
 *       낙관 구멍이다 — 이 게이트가 집합소속 방식을 기각한 바로 그 이유다.
 *     융자 먼저 → {융자 140}으로 좁고, 종목군("일반"≠"전체")은 비우므로 버린다.
 *       원장 1.4 통과 / 원장 1.2 차단. 포지션을 안 넘겼을 때의 답과도 같아진다.
 * ⚠ 순서를 바꿔도 `isLoan`은 여전히 **게이트가 아니다** — 어휘가 안 맞아 후보가
 *   0이 되면 좁히기를 통째로 버린다(아래 `loans.length > 0`).
 *
 * @param requiredRatio 원장의 담보유지비율(배수, 예: 1.4)
 * @param pos 종목군 좁히기용 포지션. 없으면 종목군 축을 쓰지 않는다(지어내지 않는다)
 */
export function ratioAgreement(
  card: ConditionCard,
  requiredRatio: number,
  pos?: Position,
): RatioAgreement {
  const ledgerRatio = centi(requiredRatio);
  const bad = (why: RatioAgreement["why"]): RatioAgreement => ({
    agreed: false,
    cardRatios: [],
    selected: [],
    ledgerRatio,
    why,
  });

  if (!Number.isFinite(requiredRatio)) return bad("NON_FINITE");

  const narrowed = narrowRatioRules(card, pos);
  if (narrowed.why !== "OK") return bad(narrowed.why);

  // 길이가 아니라 **값의 갈림**으로 판정한다 — 같은 값이 두 줄 있는 카드는 정상이다.
  const cardRatios = narrowed.centis;
  return {
    agreed: cardRatios.length === 1 && cardRatios[0] === ledgerRatio,
    cardRatios,
    selected: narrowed.selected,
    ledgerRatio,
    why: cardRatios.length === 1 ? "COMPARED" : "AMBIGUOUS",
  };
}

/**
 * 엔진 종합 판정 조립. Phase 2 계기판 범위 = 단일 종목 계좌.
 * 다종목은 replayPortfolio(#23) 머지 후 별도 확장한다 — 있는 척하지 않는다.
 */
export function assembleRiskResult(p: {
  positions: Position[];
  ledger: CreditLedger;
  card: ConditionCard;
  /** 자발적 매도 제비용률 (가정치 — 출처 표기는 호출부 책임, 예: 0.008) */
  f: number;
  /**
   * 신선도 판정 기준일(ISO YYYY-MM-DD). 주면 STALE·NO_VERIFIED_AT에서
   * liquidation을 내지 않는다. 미지정 시 신선도 게이트를 건너뛴다(테스트·재현용).
   * ⚠ 프로덕션 호출부는 반드시 넘긴다 — 잊으면 게이트가 조용히 안 돈다(#21의
   *   held와 같은 옵트인 함정). liquidationSkipped에 CARD_NOT_FRESH가 아예
   *   나올 수 없다는 것으로 누락이 관측 가능하다.
   */
  asOf?: string;
  /** 자발적 매도 체결 가정가 — 미지정 시 전일종가 */
  marketPrice?: number;
  /** 대용증권 인정비율 α — 미지정 시 collateral은 null */
  substituteRatio?: number;
}): RiskResult {
  const pos = p.positions[0];
  if (p.positions.length !== 1 || !pos) {
    throw new Error("assembleRiskResult: 단일 종목 계좌만 지원한다 — 다종목은 #23 머지 후");
  }
  /**
   * **r 은 카드가 정한다** (#67 A-1 · 채택안 (다)).
   *
   * 전에는 `p.ledger.requiredRatio` 하나에서만 뽑았고 카드의 `ratio_rules[].ratio`
   * 는 처분 수량을 막는 데만 쓰였다 — 카드를 1.5 로 바꿔도 부족액이 안 따라왔다.
   * 이제 부족액·담보비율·λ*·해소 4경로가 전부 이 값에서 나온다.
   *
   * ⚠ 카드가 하나로 못 주면 **던진다.** 원장 리터럴로 메우면 그 순간 (다) 가 아니고,
   *   화면이 어디서 온지 모르는 숫자를 근거 옆에 놓게 된다. 호출부는 `policyRatio`
   *   를 먼저 봐서 *"유지비율을 하나로 정하지 못했습니다"* 를 그린다.
   */
  const policy = policyRatio(p.card, pos);
  if (!policy.resolved) throw new PolicyRatioUnresolvedError(policy.why, policy.candidates);
  const r = policy.ratio;
  const V = pos.qty * pos.prevClose + p.ledger.cash;
  const D = shortfall(V, p.ledger.loan, r);
  const ratioPct = marginRatioPct(V, p.ledger.loan);
  const lambda = equalShockLambda(V, p.ledger.loan, r, p.ledger.cash);

  // 신선도 게이트 — DRAFT는 계산 유지(참고 모드는 배너로), STALE 계열만 수량 차단
  let quantOk = true;
  if (p.asOf !== undefined) {
    const verdict = assessCardFreshness(p.card, p.asOf);
    quantOk = verdict.calculable || verdict.reason === "DRAFT";
  }
  const h = disposalDiscountRate(p.card);

  /**
   * 유지비율 대조 — 처분 수량 **하나만** 막는다.
   * 위 D·ratioPct·lambda 셋과 아래 paths는 이 판정을 보지 않는다:
   * 어긋남이 확실히 틀리게 만드는 값은 수량뿐이고(실측 195주 ↔ 583주), 나머지는
   * 원장 r만으로 정해져 원장이 맞다면 여전히 참이다. 접으면 throw와 같아진다.
   */
  /**
   * ⚠ **대조 상대는 `r` 이 아니라 원장이다.** (다) 채택 뒤 `r` 은 카드에서 나오므로
   *   `ratioAgreement(p.card, r, pos)` 로 두면 카드를 **자기 자신과** 맞대 보게 되고,
   *   게이트는 항상 통과한다 — 있으나 마나가 된다. 실측(카드 1.7 · 원장 1.4):
   *   그렇게 두면 583주가 표식 없이 나갔다.
   *
   *   `p.ledger.requiredRatio` 는 이제 **구동값이 아니라 제2 의견**이다. 카드가
   *   계산을 몰고, 원장은 "우리가 알던 값과 같은가"만 묻는다. 둘이 갈리면 막는 것은
   *   여전히 **처분 수량 하나**다(#55 규약 유지).
   */
  const agreement = ratioAgreement(p.card, p.ledger.requiredRatio, pos);

  const liquidation =
    D > 0 && agreement.agreed && quantOk && h !== null
      ? liquidationQty({ D, prevClose: pos.prevClose, r, h, held: pos.qty })
      : null;

  // null 사유 — 화면이 문구를 고를 수 있게 넷을 접지 않는다 (#33 리뷰).
  // RATIO_NOT_CONFIRMED가 맨 앞: 이 사유만 다른 사유의 전제를 무너뜨린다. r을 하나로
  //   맞추지 못한 상태에서 "관통하지 않는다"(NO_SHORTFALL)는 말 자체가 미정이고,
  //   그 말이 먼저 나가면 어긋남의 흔적이 사유코드에서 통째로 사라진다(types.ts 상술).
  // 신선하지 않고 h도 없으면 CARD_NOT_FRESH 우선: 재검증이 선행 조치다.
  const liquidationSkipped =
    liquidation !== null
      ? undefined
      : !agreement.agreed
        ? ("RATIO_NOT_CONFIRMED" as const)
        : D <= 0
          ? ("NO_SHORTFALL" as const)
          : !quantOk
            ? ("CARD_NOT_FRESH" as const)
            : ("NO_DISCOUNT_RATE" as const);

  // 해소 4경로는 카드 파라미터와 무관(원장 r·가격·f) — 신선도·h 부재에도 유효하다.
  // ⚠ agreement도 보지 않는다. 이 성질이 이 블록의 계약이다 — 유지비율 어긋남에서
  //   여기에 게이트를 얹으면 "표식만 달고 계산은 유지한다"가 아니라 화면 정지가 된다.
  const paths =
    D > 0
      ? resolutionPaths({
          D,
          r,
          prevClose: pos.prevClose,
          marketPrice: p.marketPrice ?? pos.prevClose,
          f: p.f,
          substituteRatio: p.substituteRatio,
          held: pos.qty,
        })
      : null;

  return {
    shortfall: D,
    marginRatioPct: ratioPct,
    liquidation,
    paths,
    equalShockLambda: lambda,
    cardStatus: p.card.status,
    ...(liquidationSkipped !== undefined ? { liquidationSkipped } : {}),
  };
}
