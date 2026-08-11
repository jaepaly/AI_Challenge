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
 */

import type { ConditionCard, CreditLedger, Position, RiskResult } from "./types";
import { assessCardFreshness } from "./freshness";
import {
  equalShockLambda,
  liquidationQty,
  marginRatioPct,
  resolutionPaths,
  shortfall,
} from "./index";

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
  const r = p.ledger.requiredRatio;
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

  const liquidation =
    D > 0 && quantOk && h !== null
      ? liquidationQty({ D, prevClose: pos.prevClose, r, h, held: pos.qty })
      : null;

  // null 사유 — 화면이 문구를 고를 수 있게 셋을 접지 않는다 (#33 리뷰).
  // 신선하지 않고 h도 없으면 CARD_NOT_FRESH 우선: 재검증이 선행 조치다.
  const liquidationSkipped =
    liquidation !== null
      ? undefined
      : D <= 0
        ? ("NO_SHORTFALL" as const)
        : !quantOk
          ? ("CARD_NOT_FRESH" as const)
          : ("NO_DISCOUNT_RATE" as const);

  // 해소 4경로는 카드 파라미터와 무관(원장 r·가격·f) — 신선도·h 부재에도 유효하다
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
