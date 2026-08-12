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
  DailyPortfolioReturn,
  DailyReturn,
  PortfolioPositionStep,
  PortfolioReplayStep,
  Position,
  ReplayStep,
} from "./types";
import {
  liquidationQty,
  residualDebt,
  restorationCoefficientMicro,
  shortfall,
  singleAssetLambda,
} from "./index";

/**
 * 엔진이 "모델링하지 않은 것"을 만났을 때의 사유 코드.
 * 화면이 "계산할 수 없습니다"로 끝내지 않고 **왜** 못 하는지 그대로 말할 수 있어야 한다 —
 * 근거 없는 값을 만들지 않는 것과, 왜 안 만들었는지 말하지 않는 것은 다른 문제다.
 */
export type ReplayUnsupportedCode =
  /** 단일 종목 뷰(replay)에 다종목 계좌 — replayPortfolio를 쓸 것 */
  | "MULTI_POSITION_UNSUPPORTED"
  /** 현금성 담보 보유. 약관은 현금 우선 상환을 명문화하는데 엔진이 아직 그 단계를 모델링하지 않았다 */
  | "CASH_COLLATERAL_UNSUPPORTED"
  /** 처분 기준가 룰이 2개 이상 — 종목별 h(등급 차등)는 카드 의미론 확정 후 */
  | "MULTI_DISPOSAL_RULE_UNSUPPORTED"
  /** 처분 기준가 룰이 없음 */
  | "NO_DISPOSAL_RULE"
  /** prev_close_pct 룰인데 discount_rate가 비어 있음 */
  | "MISSING_DISCOUNT_RATE"
  /** 같은 종목코드가 두 번 — 처분 순서가 입력 배열 순서에 의존하게 된다 */
  | "DUPLICATE_SYMBOL"
  /** 가격·수량이 유효 범위 밖 */
  | "INVALID_POSITION"
  /** 수익률 벡터에 그 날짜의 종목이 빠져 있음 */
  | "RETURN_SYMBOL_MISSING";

/** 사유 코드를 실은 예외. UI는 code로 분기하고 userMessage를 그대로 보여줄 수 있다. */
export class ReplayUnsupportedError extends Error {
  readonly code: ReplayUnsupportedCode;
  /** 화면에 그대로 노출해도 되는 사유 — 무엇을 안 했고 왜 안 했는지 */
  readonly userMessage: string;

  constructor(code: ReplayUnsupportedCode, userMessage: string, detail?: string) {
    super(detail ? `${code}: ${userMessage} (${detail})` : `${code}: ${userMessage}`);
    this.name = "ReplayUnsupportedError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

/**
 * 카드에서 처분 산정 h를 뽑는다. lower_limit는 가격제한폭 −30% 등가로 처리
 * (k = 1.4×0.7 − 1 = −0.02 → K_NON_POSITIVE 전량 폴백이 자연히 나온다).
 * Phase 1은 첫 룰만 사용 — trigger·symbol_group 매칭은 카드 스키마 확장과 함께.
 */
function disposalDiscountRate(card: ConditionCard): number {
  const rule = card.disposal_price_rules[0];
  if (!rule) {
    throw new ReplayUnsupportedError(
      "NO_DISPOSAL_RULE",
      "조건 카드에 처분 기준가 규정이 없어 수량을 산정하지 않습니다.",
    );
  }
  if (rule.discount_basis === "lower_limit") return 0.3;
  if (rule.discount_rate === undefined) {
    throw new ReplayUnsupportedError(
      "MISSING_DISCOUNT_RATE",
      "조건 카드의 처분 기준가 할인율이 비어 있어 수량을 산정하지 않습니다.",
    );
  }
  return rule.discount_rate;
}

/**
 * 처분 기준가 룰이 2개 이상이면 거부한다.
 * 삼성 원문이 한 계좌 안에서 h를 쪼갠다 — "반대매매 기준가격: 전일 종가 기준 종목등급
 * S, A는 85%, B등급 이하는 80%". 첫 룰을 조용히 고르면 답이 카드 배열 순서에 의존하고,
 * B등급 종목을 과소 처분해 미해소를 해소로 보고한다(낙관). 종목별 h는 카드 의미론이
 * 확정된 뒤에 붙인다 — 그때까지는 폴백이 아니라 거부다.
 */
function assertSingleDisposalRule(card: ConditionCard): void {
  if (card.disposal_price_rules.length > 1) {
    throw new ReplayUnsupportedError(
      "MULTI_DISPOSAL_RULE_UNSUPPORTED",
      "이 증권사는 종목 등급에 따라 처분 기준가가 달라, 종목별 등급 정보 없이는 산정하지 않습니다.",
      `rules=${card.disposal_price_rules.length}`,
    );
  }
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
    throw new ReplayUnsupportedError(
      "MULTI_POSITION_UNSUPPORTED",
      "이 화면은 단일 종목 계좌 전용입니다 — 다종목은 replayPortfolio를 사용하세요.",
      `positions=${positions.length}`,
    );
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

/* ── 다종목 경로 시뮬 ────────────────────────────────────────────── */

/**
 * 종목코드 오름차순. 로케일 비의존이어야 해서 localeCompare를 쓰지 않는다.
 *
 * ⚠ 5사가 같은 정렬이 아니다. 신용 채널에서 종목 단위 판별자를 명문화한 5사 중
 *   4사는 "종목번호 빠른 순"이고, 한국투자만 "종목코드순(알파벳>숫자)"이라 문자
 *   포함 코드에서 이 비교자와 **반대**가 된다(ASCII는 숫자가 앞). 현재는 전 종목이
 *   6자리 숫자코드라는 전제 위에서만 5사가 같은 답을 낸다.
 */
function bySymbolAsc(a: { symbol: string }, b: { symbol: string }): number {
  return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
}

/** 다종목 입력 검증 — 모델링하지 않은 것을 조용히 통과시키지 않는다. */
function assertPortfolioInputs(positions: Position[], ledger: CreditLedger): void {
  if (positions.length === 0) {
    throw new ReplayUnsupportedError("INVALID_POSITION", "보유 종목이 없어 산정하지 않습니다.");
  }
  const seen = new Set<string>();
  for (const p of positions) {
    if (seen.has(p.symbol)) {
      throw new ReplayUnsupportedError(
        "DUPLICATE_SYMBOL",
        "같은 종목이 두 번 들어와 처분 순서를 정할 수 없습니다.",
        p.symbol,
      );
    }
    seen.add(p.symbol);
    if (!Number.isInteger(p.qty) || p.qty < 0 || !Number.isInteger(p.prevClose) || p.prevClose <= 0) {
      throw new ReplayUnsupportedError(
        "INVALID_POSITION",
        "종목의 수량 또는 기준가가 유효하지 않아 산정하지 않습니다.",
        `${p.symbol} qty=${p.qty} prevClose=${p.prevClose}`,
      );
    }
  }
  if (ledger.cash > 0) {
    // 약관은 현금이 먼저다 — 한투: "현금상환 처리한 결과 담보부족이 해소되면 담보부족에
    // 의한 반대매매는 없으며, 현금상환 처리하고도 담보부족금이 남아있으면 해당 금액만큼
    // 아래 (3) 순서로 반대매매가 선정됩니다". 현금을 소비하지 않고 주식부터 팔면
    // 연쇄가 실제보다 일찍 끝난 것처럼 보인다(낙관). 회사별 상환액 산식이 아직
    // 미확보라 추정하지 않고 거부한다.
    throw new ReplayUnsupportedError(
      "CASH_COLLATERAL_UNSUPPORTED",
      "이 계좌는 현금 담보가 있어 산정하지 않습니다 — 약관은 현금 상환이 주식 처분보다 먼저인데, 회사별 상환액 산식이 아직 확인되지 않았습니다.",
      `cash=${ledger.cash}`,
    );
  }
}

/**
 * 다종목 경로 시뮬 — 종목번호 오름차순으로 순차 배분(greedy).
 * ---------------------------------------------------------------------------
 * 상태기계는 replay()와 같다(가격 갱신 → 종가 판정 → D+1 통지 → D+2 집행 → 재관통).
 * 다른 것은 집행 배분뿐이다.
 *
 * 배분 근거: 신용 채널 원문 5사가 종목 단위 판별자를 "종목번호 빠른 순"으로 명문화한다
 * (한투·삼성·메리츠·신한·유진). 비례 배분·안분을 규정한 회사는 코퍼스에 없고, 유일한
 * 다종목 워크드 예시(유진)가 순차 처분 + 해소 시 중단이다. 다만 "한 종목을 소진한 뒤
 * 다음 종목"이라고 문자 그대로 쓴 조항은 없다 — 순서 규정과 그 예시로부터의 추론이다.
 *
 * 배분 산식: 종목 i의 n주를 산정 기준가로 팔아 상환하면 D' = D − n·P_i·k.
 * remainingMicro(=D×10^6)를 정수로 들고 다니며 종목별로 ceil해 깎는다 — 전 과정이
 * 정수 연산이라 반올림이 누적될 자리가 없다.
 *
 * ⚠ 모델링하지 않은 것 (전부 낙관 방향인지 표시)
 *  - 현금 우선 상환: 입력 단계에서 거부(cash>0). 미반영 시 낙관.
 *  - 종목별 h(등급 차등): 룰 2개 이상 카드를 거부. 미반영 시 낙관.
 *  - 처분대금 충당 순서(제비용·이자 우선): 전액 원금 충당 가정 → 이후 D 과소 = 낙관.
 *  - 한투 ③ 보증금률 계층·④ 대출일 계층: 종목번호보다 상위인데 Position에 필드가 없다.
 *    총 처분 규모는 (공통 k에서) 순서 무관이라 영향이 없지만, **어느 종목이 팔리는지**는
 *    추정이다. UI가 종목을 단정적으로 말하지 말 것.
 *  - 2단 임계(메리츠 120% 미만 당일 집행 등): D+2 고정 → 남은 시간 과대 = 낙관.
 */
export function replayPortfolio(
  positions: Position[],
  ledger: CreditLedger,
  dailyReturns: DailyPortfolioReturn[],
  card: ConditionCard,
): PortfolioReplayStep[] {
  assertPortfolioInputs(positions, ledger);
  assertSingleDisposalRule(card);

  const r = ledger.requiredRatio;
  const cash = ledger.cash; // 위 가드로 0
  const h = disposalDiscountRate(card);
  const km = restorationCoefficientMicro(r, h);

  /** 종목번호 오름차순 = 처분 순서 */
  const book = [...positions].sort(bySymbolAsc).map((p) => ({
    symbol: p.symbol,
    price: p.prevClose,
    held: p.qty,
  }));

  let loan = ledger.loan;
  let state: "none" | "breached" | "notified" = "none";
  let prevD = 0;

  const steps: PortfolioReplayStep[] = [];

  for (const day of dailyReturns) {
    /** 집행 산정용 전일종가 — 직전 스텝 종가 */
    const basis = book.map((b) => b.price);
    /** 이 스텝 시작 시점 보유 — 등락률 산출은 집행 전 보유로 해야 가격 변동만 남는다 */
    const heldBefore = book.map((b) => b.held);
    const valueBefore = book.reduce((s, b, i) => s + heldBefore[i]! * basis[i]!, 0);

    // ① 가격 갱신 — 정수 스케일, 원 단위 내림 고정
    const bps: number[] = [];
    for (const b of book) {
      const bp = day.bySymbol[b.symbol];
      if (bp === undefined) {
        throw new ReplayUnsupportedError(
          "RETURN_SYMBOL_MISSING",
          "일부 종목의 그날 등락률이 없어 산정하지 않습니다 — 거래정지일은 0%로 명시해야 합니다.",
          `${day.date} ${b.symbol}`,
        );
      }
      bps.push(bp);
      b.price = Math.floor((b.price * (10000 + bp)) / 10000);
    }

    let phase: PortfolioReplayStep["phase"] = "normal";
    let executedReason: PortfolioReplayStep["executedReason"] = null;
    const executed = book.map(() => 0);

    if (state === "breached") {
      phase = "notified"; // ② D+1 통지 — 이 스텝 종가로 해소 여부를 다시 본다
    } else if (state === "notified" && prevD > 0 && book.some((b) => b.held > 0)) {
      // ③ D+2 집행 — 전일종가(basis)와 전일 부족액으로 산정, 종목번호 순으로 배분
      phase = "executed";
      const heldTotal = book.reduce((s, b) => s + b.held, 0);
      if (km <= 0) {
        // k ≤ 0: 부분 매도로 복원 불가 → 약관이 전량을 지시
        book.forEach((b, i) => {
          executed[i] = b.held;
        });
        executedReason = "K_NON_POSITIVE";
      } else {
        let remainingMicro = prevD * 1_000_000;
        book.forEach((b, i) => {
          if (remainingMicro <= 0 || b.held === 0) return;
          const need = Math.ceil(remainingMicro / (basis[i]! * km));
          const sell = Math.min(need, b.held);
          remainingMicro -= sell * basis[i]! * km;
          executed[i] = sell;
        });
        const soldTotal = executed.reduce((s, q) => s + q, 0);
        // 전량 처분으로 끝났으면 QTY_EXCEEDED — 단일 종목에서 기존 liquidationQty의
        // `rawQty >= held` 경계(수량은 같고 라벨만 갈리는 지점)와 답을 맞춘다.
        executedReason = soldTotal >= heldTotal ? "QTY_EXCEEDED" : "PARTIAL";
      }
      // 원장 갱신 — 체결가 가정은 집행일 가격(수량 산정에는 미관여)
      let proceeds = 0;
      book.forEach((b, i) => {
        proceeds += executed[i]! * b.price;
        b.held -= executed[i]!;
      });
      loan = residualDebt(loan, proceeds);
    }

    // ④ 종가 판정 — 라운딩 없는 정수 계산
    const V = book.reduce((s, b) => s + b.held * b.price, 0) + cash;
    /** 등락률용 — 집행 전 보유를 새 가격으로 평가(가격 변동만 남긴다) */
    const valueAfter = book.reduce((s, b, i) => s + heldBefore[i]! * b.price, 0);
    const D = shortfall(V, loan, r);
    const anyHeld = book.some((b) => b.held > 0);

    // ⑤ 상태 전이
    if (phase === "notified") {
      state = D > 0 && anyHeld ? "notified" : "none";
    } else {
      state = D > 0 && anyHeld ? "breached" : "none";
    }
    prevD = D;

    const positionSteps: PortfolioPositionStep[] = book.map((b, i) => ({
      symbol: b.symbol,
      pricePrev: b.price,
      dailyReturn: bps[i]!,
      executedQty: executed[i]!,
      heldAfter: b.held,
      // 보유 0이면 분모가 0이라 Infinity가 된다 — 단독 하락이라는 개념이 없으므로 null
      singleAssetLambda: b.held === 0 ? null : singleAssetLambda(V, loan, r, b.held, b.price),
    }));

    steps.push({
      date: day.date,
      // 포트폴리오 등락률은 표시용 파생값이다 — 이 값으로 가격을 되돌릴 수 없다
      portfolioReturn: valueBefore > 0 ? Math.round((valueAfter / valueBefore - 1) * 10000) : 0,
      V,
      L: loan,
      ratioRaw: loan > 0 ? (V * 100) / loan : null,
      shortfall: D,
      phase,
      executedQtyTotal: executed.reduce((s, q) => s + q, 0),
      executedReason,
      positions: positionSteps,
      ledgerAfter: { loan, cash, requiredRatio: r },
    });
  }

  return steps;
}
