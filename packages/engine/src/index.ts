/**
 * 마진가드 결정론 리스크 엔진 — 순수함수만. LLM은 이 파일에 절대 관여하지 않는다.
 * ---------------------------------------------------------------------------
 * 산식 출처: 한국투자증권 신용거래 설명서 공식 예시(골든 case1·case2),
 *           메리츠(h=0.20 → 309주) 교차검증. 전 함수는 test/golden.test.ts로 고정.
 * 골든 테스트를 깨는 커밋은 merge 금지다.
 *
 * 부동소수 주의: 1.4 × 5,500,000 = 7,699,999.999999999 (IEEE754). 그래서 비율은
 * 정수 스케일(r×100, h×10000)로 환산해 계산한다. 원 단위 금액이 어긋나면
 * "소수점까지 재현"이라는 이 제품의 정체성이 깨진다 — 스케일 계산을 풀지 말 것.
 *
 * ※ 이 주석은 원래 1.4 × 6,000,000을 예로 들었으나 그 곱은 오차가 0이다.
 *   골든 6건이 전부 L=6,000,000이었던 탓에 정수 스케일은 한 번도 검증되지
 *   않았다 — naive float로 바꿔도 값이 같았다. 삼성 케이스(L=5,500,000)가
 *   그 첫 회귀 가드다. 오차 방향이 D 과소 = 수량 과소 = 낙관이라 특히 위험하다.
 */

export * from "./types";
export * from "./replay";
export * from "./freshness";
import type { LiquidationResult, ResolutionPaths } from "./types";

/** 담보부족액 D = max(0, r·L − V). V = 총담보 평가액(주식은 전일종가 평가 + 현금성). */
export function shortfall(V: number, L: number, r: number): number {
  const rS = Math.round(r * 100); // 140 — 1.4*5.5e6=7699999.999… 오차 제거
  return Math.max(0, (L * rS) / 100 - V);
}

/**
 * 복원 계수 k = r(1−h) − 1.
 * ※ 한투·삼성 원문 산식에는 제비용 f가 없다(원문 2건 확인). 섞으면 한투 골든
 *   195주가 206주로 깨지고, 회귀 테스트가 그 값을 고정한다.
 *   단 이건 회사별로 다르다 — 미래에셋은 매도대금에 98.5% 상환금액 보정율을
 *   건다(신용거래설명서 p.3 각주). 그 회사를 골든에 넣을 때는 k를 건드리지 말고
 *   회사 파라미터로 분리할 것. 우리 f는 여전히 미수 산식(금액÷단가)과
 *   자발적 매도 산식 전용이다.
 * k ≤ 0 (예: 하한가 기준 h=0.30 → k=−0.02)이면 부분 매도로 비율 복원이 불가능하다.
 */
export function restorationCoefficient(r: number, h: number): number {
  return kMicro(r, h) / 1_000_000;
}

/** k × 10^6 을 정수로 — ceil 경계에서의 부동소수 오차 차단용 내부 표현. */
function kMicro(r: number, h: number): number {
  const rS = Math.round(r * 100); // 140
  const hS = Math.round(h * 10000); // 1500 (h=0.15)
  return rS * (10000 - hS) - 1_000_000; // 예: 140×8500 − 1e6 = 190,000 (k=0.19)
}

/**
 * 반대매매 수량: n = ceil( D / (P_prev · k) ), n_final = min(n, held).
 * D ≤ 90억원 범위에서 정수 정밀 (D×1e6 < 2^53).
 */
export function liquidationQty(p: {
  D: number;
  prevClose: number;
  r: number;
  h: number;
  held: number;
}): LiquidationResult {
  const km = kMicro(p.r, p.h);
  const k = km / 1_000_000;
  if (km <= 0) {
    return { mode: "FULL", reason: "K_NON_POSITIVE", qty: p.held, k, rawQty: null };
  }
  const rawQty = Math.ceil((p.D * 1_000_000) / (p.prevClose * km));
  if (rawQty >= p.held) {
    return { mode: "FULL", reason: "QTY_EXCEEDED", qty: p.held, k, rawQty };
  }
  return { mode: "PARTIAL", qty: rawQty, k, rawQty };
}

/**
 * 처분금액(총액) = 수량 × 체결가. 골든 case2: 195주 × 7,000원 = 1,365,000원.
 * 설명서 기준으로 제비용 미차감(f는 자발적 매도 산식에만).
 * ※ 세 가격 구분 — 평가는 전일종가(8,100), 수량 산정은 k 내부의 −h(6,885),
 *   체결가(7,000)는 처분금액 계산에만 쓰이고 수량 산정에 관여하지 않는다.
 */
export function disposalAmount(qty: number, fillPrice: number): number {
  return qty * fillPrice;
}

/** 전량 처분 후 잔여 채무 = max(0, L − 처분대금). 골든 case1: 600만 − 530만 = 70만. */
export function residualDebt(L: number, proceeds: number): number {
  return Math.max(0, L - proceeds);
}

/**
 * 담보비율(%) — 사사오입. 골든 시리즈: 6.15M/6.0M = 102.5 → 103.
 * (V×100)/L 순서 유지 — (V/L)×100으로 바꾸면 120.5가 120.49999…로 떨어져
 * 7.23M/6.0M = 121이 120으로 깨진다.
 */
export function marginRatioPct(V: number, L: number): number {
  return Math.round((V * 100) / L);
}

/**
 * 담보부족 해소 4경로 필요액. 자발적 매도에만 제비용 f가 들어간다(실제 매도라 실제 비용 발생).
 *
 * held를 주면 매도로 **도달 불가한** 경우를 걸러낸다. n주를 팔면
 *   D' = D − n·(r·P_m(1−f) − P_prev)
 * 이므로 필요 수량이 보유를 넘으면 전량을 팔아도 D'>0 — 매도는 선택지가 아니다.
 * 이때 수량을 보유로 캡해서 돌려주면 "덜 팔아도 해소된다"는 낙관 오차가 된다.
 * 그래서 캡이 아니라 null이다(liquidationQty의 K_NON_POSITIVE와 같은 성격).
 */
export function resolutionPaths(p: {
  D: number;
  r: number;
  prevClose: number;
  marketPrice: number;
  /** 제비용률 (예: 0.008) */
  f: number;
  /** 대용증권 인정비율 α — 회사·종목별, 미지정 시 collateral은 null */
  substituteRatio?: number;
  /** 보유 수량. 미지정이면 상한 없이 산정한다(기존 호출부 호환) */
  held?: number;
}): ResolutionPaths {
  const base = {
    deposit: Math.ceil(p.D),
    repay: Math.ceil(p.D / p.r),
    collateral: p.substituteRatio ? Math.ceil(p.D / p.substituteRatio) : null,
  };
  const denom = p.r * p.marketPrice * (1 - p.f) - p.prevClose;
  if (denom <= 0) {
    return { ...base, voluntarySellQty: null, voluntarySellReason: "DENOM_NON_POSITIVE" };
  }
  const need = Math.ceil(p.D / denom);
  if (p.held !== undefined && need > p.held) {
    return { ...base, voluntarySellQty: null, voluntarySellReason: "QTY_EXCEEDED" };
  }
  return { ...base, voluntarySellQty: need };
}

/**
 * 균등충격 한계선 λ* = (V − r·L) / (V − cash).
 * "전 종목이 동시에 몇 % 빠지면 담보부족인가". 버퍼 B = V − rL ≤ 0이면 이미 관통(0).
 * cash는 주가 충격을 받지 않는 담보. 주식 익스포저가 0이면 Infinity(하락 무관).
 */
export function equalShockLambda(V: number, L: number, r: number, cash = 0): number {
  const rS = Math.round(r * 100);
  const buffer = V - (L * rS) / 100;
  if (buffer <= 0) return 0;
  const exposed = V - cash;
  if (exposed <= 0) return Infinity;
  return buffer / exposed;
}

/**
 * 종목 단독 하락 한계선 λ_k = B / (N_k · P_k).
 * "이 종목 혼자 몇 % 빠지면 관통하는가". 1 초과면 그 종목이 0원이 돼도 안 뚫린다(UI에서 캡).
 */
export function singleAssetLambda(
  V: number,
  L: number,
  r: number,
  qtyK: number,
  priceK: number,
): number {
  const rS = Math.round(r * 100);
  const buffer = V - (L * rS) / 100;
  if (buffer <= 0) return 0;
  return buffer / (qtyK * priceK);
}

/**
 * 진입 전 한계선 λ* = 1 − r(1−g). g = 보증금률.
 * g=40% → 16%, 45% → 23%, 50% → 30% 하락까지 생존. (7월 월간 −33.19%는 g≤50% 전부 관통)
 */
export function leveragedEntryLambda(g: number, r = 1.4): number {
  return 1 - r * (1 - g);
}
