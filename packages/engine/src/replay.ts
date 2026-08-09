/**
 * replay — 역사 벡터 경로 시뮬레이션 (README 5-A · 한계선 3분해의 ③).
 * ---------------------------------------------------------------------------
 * 월간 하락률을 한 번에 곱하는 일괄 주입이 아니다 — 그건 "무개입 통과" 가정이라
 * 데모에서 반증당한다. 벡터를 날짜 순서로 한 스텝씩:
 *   가격 갱신 → 종가 판정(원시값) → 관통 시 D+1 통지 → D+2 집행 →
 *   원장 갱신(L 감소·보유 감소) → 재관통 반복.
 *
 * 규약:
 *  - 압축 벡터의 연속 엔트리 = 연속 거래일 (data/golden july_sequence 라벨 참조).
 *  - 수익률 적용 후 가격은 원 단위 내림 고정 — floor(price × (10000+bp) / 10000).
 *    정수 스케일이라 머신 간 부동소수 드리프트가 없다 (test/replay.test.ts가 박제).
 *  - 세 가격 분리 유지: 평가·산정 기준은 전일종가, 수량 산정은 k 내부의 −h,
 *    체결가는 별도(기본 가정: 집행일 가격)이며 수량 산정에 관여하지 않는다.
 *  - 집행 수량은 "집행일 전일종가"(= 직전 스텝 종가)와 그 시점 부족액으로 산정한다.
 *  - 집행 후 산정 기준가 평가로는 비율이 복원되지만, 집행일 종가 평가로는
 *    재관통이 가능하다 — 그것이 연쇄 반대매매 시나리오의 본질이다.
 */

import type {
  ConditionCard,
  CreditLedger,
  DailyReturn,
  Position,
  ReplayStep,
} from "./types";
import { liquidationQty, residualDebt, shortfall } from "./index";

/**
 * 카드에서 처분 산정 h를 뽑는다. lower_limit는 가격제한폭 −30% 등가로 처리
 * (k = 1.4×0.7 − 1 = −0.02 → K_NON_POSITIVE 전량 폴백이 자연히 나온다).
 * Phase 1은 첫 룰만 사용 — trigger·symbol_group 매칭은 카드 스키마 확장과 함께.
 */
function disposalDiscountRate(card: ConditionCard): number {
  const rule = card.disposal_price_rules[0];
  if (!rule) {
    throw new Error("replay: disposal_price_rules가 비어 있다 — 산정 기준가를 정할 수 없음");
  }
  if (rule.discount_basis === "lower_limit") return 0.3;
  if (rule.discount_rate === undefined) {
    throw new Error("replay: prev_close_pct 룰에 discount_rate가 없다");
  }
  return rule.discount_rate;
}

/**
 * 경로 시뮬. Phase 1은 단일 종목 계좌만 — 복수 종목의 집행 배분 규칙(어느 종목부터
 * 처분하는가)은 카드 스키마에 아직 없어, 있는 척하지 않는다.
 * held가 0이 된 뒤의 잔여 채무 회수 절차는 replay 범위 밖(Phase 2).
 */
export function replay(
  positions: Position[],
  ledger: CreditLedger,
  dailyReturns: DailyReturn[],
  card: ConditionCard,
): ReplayStep[] {
  const pos = positions[0];
  if (positions.length !== 1 || !pos) {
    throw new Error("replay: Phase 1은 단일 종목 계좌만 지원한다 — 집행 배분 규칙 미정");
  }
  const r = ledger.requiredRatio;
  const cash = ledger.cash;
  const h = disposalDiscountRate(card);

  let price = pos.prevClose;
  let held = pos.qty;
  let loan = ledger.loan;
  /** none → (종가 관통) breached → (익일 = 통지일) notified → (익일 = 집행일) */
  let state: "none" | "breached" | "notified" = "none";
  /** 직전 스텝 종가 기준 부족액 — 집행 수량 산정의 D */
  let prevD = 0;

  const steps: ReplayStep[] = [];

  for (const day of dailyReturns) {
    /** 집행 산정용 전일종가 = 직전 스텝 종가 */
    const basisPrice = price;

    // ① 가격 갱신 — 정수 스케일, 원 단위 내림 고정
    price = Math.floor((price * (10000 + day.bp)) / 10000);

    let phase: ReplayStep["phase"] = "normal";
    let executedQty = 0;
    let executedReason: ReplayStep["executedReason"] = null;
    let fillPrice: number | null = null;

    if (state === "breached") {
      // ② D+1 — 통지 상태. 이 스텝의 종가로 해소 여부를 재판정한다.
      phase = "notified";
    } else if (state === "notified" && prevD > 0 && held > 0) {
      // ③ D+2 — 집행. 수량은 전일종가(basisPrice)·카드 h·전일 부족액으로 산정.
      const liq = liquidationQty({ D: prevD, prevClose: basisPrice, r, h, held });
      executedQty = liq.qty;
      executedReason = liq.mode === "PARTIAL" ? "PARTIAL" : (liq.reason ?? null);
      fillPrice = price; // 기본 가정: 집행일 가격 — 수량 산정에는 미관여
      loan = residualDebt(loan, executedQty * fillPrice);
      held -= executedQty;
      phase = "executed";
    }

    // ④ 종가 판정 — 라운딩 없는 정수 계산 (표시용 내림·사사오입은 표시 계층의 일)
    const V = held * price + cash;
    const D = shortfall(V, loan, r);

    // ⑤ 상태 전이
    if (phase === "notified") {
      state = D > 0 && held > 0 ? "notified" : "none"; // 미해소 → 익일 집행 | 해소 → 취소
    } else {
      state = D > 0 && held > 0 ? "breached" : "none"; // 관통(재관통 포함) → 익일 통지
    }
    prevD = D;

    steps.push({
      date: day.date,
      dailyReturn: day.bp,
      pricePrev: price,
      V,
      L: loan,
      ratioRaw: loan > 0 ? (V * 100) / loan : null,
      shortfall: D,
      phase,
      executedQty,
      executedReason,
      fillPrice,
      heldAfter: held,
      ledgerAfter: { loan, cash, requiredRatio: r },
    });
  }

  return steps;
}
