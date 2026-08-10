/**
 * 다종목 경로 시뮬 골든 — 기대값은 BigInt 정수 연산으로 1차 원리(D' = D − n·P_i·k)에서
 * 독립 재계산한 값이다. 실패하면 코드를 고치는 것이지 기대값을 고치는 게 아니다.
 *
 * 배분 규약: 종목번호 오름차순 순차(greedy). 신용 채널 원문 5사가 종목 단위 판별자를
 * "종목번호 빠른 순"으로 명문화하고, 비례 배분을 규정한 회사는 없다.
 *
 * 시나리오는 전부 3스텝·전 종목 0bp다 — 가격을 고정해 **배분 규칙만** 검증하기 위해서다.
 * 관통(normal) → 통지(notified) → 집행(executed) 상태기계는 replay.test.ts가 따로 고정한다.
 */
import { describe, it, expect } from "vitest";
import { replay, replayPortfolio, ReplayUnsupportedError } from "../src/index";
import type {
  ConditionCard,
  CreditLedger,
  DailyPortfolioReturn,
  DailyReturn,
  DisposalPriceRule,
  Position,
} from "../src/index";

/* ── 픽스처 ─────────────────────────────────────────────────────── */

/** 입력 순서를 정렬 순서와 다르게 둔다 — 정렬이 실제로 도는지 보려고 */
function positions(): Position[] {
  return [
    { symbol: "035720", name: "다", qty: 250, prevClose: 20_000, group: "일반" },
    { symbol: "000660", name: "가", qty: 300, prevClose: 10_000, group: "일반" },
    { symbol: "005930", name: "나", qty: 500, prevClose: 8_000, group: "일반" },
  ];
}
/** V₀ = 300×10,000 + 500×8,000 + 250×20,000 = 12,000,000 */
const V0 = 12_000_000;
const HELD_TOTAL = 1_050;

function ledger(loan: number, cash = 0): CreditLedger {
  return { loan, cash, requiredRatio: 1.4 };
}

function card(rules: DisposalPriceRule[]): ConditionCard {
  return {
    broker: "테스트",
    ratio_rules: [
      { product_type: "신용융자", collateral_type: "주식", symbol_group: "일반", ratio: 1.4 },
    ],
    account_aggregation: "max",
    disposal_price_rules: rules,
    execution_schedule: [{ threshold_ratio: 1.4, day_counting: "D+2" }],
    ratio_source: "clause",
    doc_version: { review_no: "TEST" },
    status: "verified",
    verified_at: "2026-08-01",
  };
}

const RULE_H15: DisposalPriceRule = {
  trigger: "margin_call",
  symbol_group: "일반",
  discount_basis: "prev_close_pct",
  discount_rate: 0.15,
  source_confidence: "explicit",
};
const kisCard = () => card([RULE_H15]);

/** 3스텝 전부 무변동 — 가격을 고정해 배분만 본다 */
const FLAT: DailyPortfolioReturn[] = ["2026-09-01", "2026-09-02", "2026-09-03"].map((date) => ({
  date,
  bySymbol: { "000660": 0, "005930": 0, "035720": 0 },
}));

/** 집행 스텝(3번째)만 뽑는다 */
function execStep(loan: number) {
  const steps = replayPortfolio(positions(), ledger(loan), FLAT, kisCard());
  expect(steps.map((s) => s.phase)).toEqual(["normal", "notified", "executed"]);
  return steps[2]!;
}

/* ── 배분 골든 ──────────────────────────────────────────────────── */

describe("다종목 배분 — 종목번호 오름차순 순차 처분", () => {
  it("A. 첫 종목만으로 해소되면 뒤 종목은 손대지 않는다 (D 180,000 → 000660 95주)", () => {
    // need = ceil(180,000 / (10,000 × 0.19)) = ceil(94.73) = 95 ≤ 보유 300
    const s = execStep(8_700_000);
    expect(s.shortfall).toBe(0); // 해소
    expect(s.executedReason).toBe("PARTIAL");
    expect(s.executedQtyTotal).toBe(95);
    expect(s.positions.map((p) => [p.symbol, p.executedQty, p.heldAfter])).toEqual([
      ["000660", 95, 205],
      ["005930", 0, 500],
      ["035720", 0, 250],
    ]);
    expect(s.L).toBe(7_750_000); // 8,700,000 − 95×10,000
    expect(s.V).toBe(11_050_000);
  });

  it("B. 첫 종목을 소진하면 다음 종목으로 이월된다 (D 1,300,000 → 300주 + 481주, 셋째는 미처분)", () => {
    // 000660: need 685 > 300 → 전량 300, 잔여 1,300,000e6 − 300×10,000×190,000 = 7.3e11
    // 005930: need = ceil(7.3e11 / (8,000×190,000)) = 481 ≤ 500 → 481주에서 해소
    const s = execStep(9_500_000);
    expect(s.executedReason).toBe("PARTIAL"); // 전량이 아니다 — 035720이 남았다
    expect(s.executedQtyTotal).toBe(781);
    expect(s.positions.map((p) => [p.symbol, p.executedQty, p.heldAfter])).toEqual([
      ["000660", 300, 0],
      ["005930", 481, 19],
      ["035720", 0, 250],
    ]);
    expect(s.L).toBe(2_652_000); // 9,500,000 − (300×10,000 + 481×8,000)
    expect(s.V).toBe(5_152_000);
    expect(s.shortfall).toBe(0);
  });

  it("C. 전 종목을 소진해도 모자라면 QTY_EXCEEDED — 잔여채무가 남는다 (D 7,600,000)", () => {
    const s = execStep(14_000_000);
    expect(s.executedReason).toBe("QTY_EXCEEDED");
    expect(s.executedQtyTotal).toBe(HELD_TOTAL);
    expect(s.positions.map((p) => p.heldAfter)).toEqual([0, 0, 0]);
    expect(s.V).toBe(0);
    expect(s.L).toBe(2_000_000); // 14,000,000 − 처분대금 12,000,000
    expect(s.shortfall).toBe(2_800_000); // 1.4 × 2,000,000 — 팔고도 남는 빚
    expect(s.ratioRaw).toBe(0); // V=0, L>0
  });

  it("정렬은 입력 순서와 무관하다 — 어떤 순서로 넣어도 같은 답", () => {
    const shuffled: Position[] = [positions()[2]!, positions()[0]!, positions()[1]!];
    const a = replayPortfolio(positions(), ledger(9_500_000), FLAT, kisCard())[2]!;
    const b = replayPortfolio(shuffled, ledger(9_500_000), FLAT, kisCard())[2]!;
    expect(b.positions.map((p) => p.symbol)).toEqual(["000660", "005930", "035720"]);
    expect(b).toEqual(a);
  });

  it("정수 유지 — 가격·평가액·융자·수량 전부 정수", () => {
    for (const s of replayPortfolio(positions(), ledger(9_500_000), FLAT, kisCard())) {
      expect(Number.isInteger(s.V)).toBe(true);
      expect(Number.isInteger(s.L)).toBe(true);
      expect(Number.isInteger(s.executedQtyTotal)).toBe(true);
      for (const p of s.positions) {
        expect(Number.isInteger(p.pricePrev)).toBe(true);
        expect(Number.isInteger(p.executedQty)).toBe(true);
        expect(Number.isInteger(p.heldAfter)).toBe(true);
      }
    }
  });
});

/* ── λ_k ────────────────────────────────────────────────────────── */

describe("λ_k — 종목 단독 한계선이 종목마다 다르다", () => {
  it("안전 계좌(버퍼 220만)에서 노출이 클수록 λ_k가 작다: 0.733 / 0.55 / 0.44", () => {
    const s = replayPortfolio(positions(), ledger(7_000_000), FLAT, kisCard())[0]!;
    expect(s.shortfall).toBe(0);
    expect(s.V).toBe(V0);
    // 버퍼 = 12,000,000 − 1.4×7,000,000 = 2,200,000
    const lambdas = Object.fromEntries(s.positions.map((p) => [p.symbol, p.singleAssetLambda]));
    expect(lambdas["000660"]).toBeCloseTo(2_200_000 / 3_000_000, 10); // 0.7333
    expect(lambdas["005930"]).toBeCloseTo(2_200_000 / 4_000_000, 10); // 0.55
    expect(lambdas["035720"]).toBeCloseTo(2_200_000 / 5_000_000, 10); // 0.44
    // 세 값이 서로 다르다 — 단일 종목 계좌에서는 나올 수 없는 정보다
    expect(new Set(Object.values(lambdas)).size).toBe(3);
  });

  it("이미 관통한 계좌는 전 종목 λ_k = 0 (버퍼 소진)", () => {
    const s = replayPortfolio(positions(), ledger(9_500_000), FLAT, kisCard())[0]!;
    expect(s.shortfall).toBeGreaterThan(0);
    expect(s.positions.map((p) => p.singleAssetLambda)).toEqual([0, 0, 0]);
  });

  it("전량 처분된 종목의 λ_k는 null — 0으로 나눠 Infinity가 새지 않는다", () => {
    // L=9,500,000: D+2 집행에서 000660이 300주 전량, 005930이 481주 처분돼 해소된다.
    // 이 시점 000660은 보유 0인데 버퍼는 양수라 buffer<=0 가드를 타지 않는다 —
    // 고치기 전에는 buffer/(0×price) = Infinity가 그대로 경계 타입에 실렸다.
    const steps = replayPortfolio(positions(), ledger(9_500_000), FLAT, kisCard());
    const last = steps[2]!;
    const byS = Object.fromEntries(last.positions.map((p) => [p.symbol, p]));

    expect(last.executedQtyTotal).toBe(781);
    expect(byS["000660"]!.heldAfter).toBe(0);
    expect(byS["000660"]!.singleAssetLambda).toBeNull();

    // 보유가 남은 종목은 수치가 그대로 나온다 — null이 전면 차단이 아님을 고정
    expect(byS["035720"]!.heldAfter).toBe(250);
    expect(Number.isFinite(byS["035720"]!.singleAssetLambda!)).toBe(true);

    // 전 스텝·전 종목에서 Infinity/NaN이 없다
    for (const st of steps) {
      for (const pos of st.positions) {
        expect(pos.singleAssetLambda === null || Number.isFinite(pos.singleAssetLambda)).toBe(true);
      }
    }
  });
});

/* ── 단일 종목 일치 ─────────────────────────────────────────────── */

describe("단일 종목에서는 replay와 답이 같다", () => {
  const single: Position[] = [{ symbol: "000001", qty: 1_000, prevClose: 10_000 }];
  const bps = [-491, -535, -895, -572, -1084, -598];
  const dates = ["07-07", "07-08", "07-13", "07-24", "07-28", "07-29"];

  it("7월 벡터: 가격·부족액·집행 수량·사유가 전부 일치한다", () => {
    const flat: DailyReturn[] = dates.map((d, i) => ({ date: d, bp: bps[i]! }));
    const port: DailyPortfolioReturn[] = dates.map((d, i) => ({
      date: d,
      bySymbol: { "000001": bps[i]! },
    }));
    const a = replay(single, ledger(6_000_000), flat, kisCard());
    const b = replayPortfolio(single, ledger(6_000_000), port, kisCard());

    expect(b.map((s) => s.positions[0]!.pricePrev)).toEqual(a.map((s) => s.pricePrev));
    expect(b.map((s) => s.shortfall)).toEqual(a.map((s) => s.shortfall));
    expect(b.map((s) => s.phase)).toEqual(a.map((s) => s.phase));
    expect(b.map((s) => s.L)).toEqual(a.map((s) => s.L));
    expect(b.map((s) => s.executedQtyTotal)).toEqual(a.map((s) => s.executedQty));
    expect(b.map((s) => s.executedReason)).toEqual(a.map((s) => s.executedReason));
  });

  it("rawQty == 보유 경계에서도 라벨이 갈리지 않는다 — 양쪽 다 QTY_EXCEEDED", () => {
    // D=300,000·P=8,100·h=0.15에서 필요 수량은 정확히 195주다.
    // 기존 liquidationQty는 `rawQty >= held`라 FULL/QTY_EXCEEDED를 낸다.
    // greedy는 "전량 처분으로 끝났으면 QTY_EXCEEDED"로 같은 답을 맞춘다 —
    // 수량은 어느 쪽이든 195주로 같고, 갈릴 수 있는 건 라벨뿐이다.
    expect(195 * 8_100 * 190_000).toBeGreaterThanOrEqual(300_000 * 1_000_000);

    const pos: Position[] = [{ symbol: "000001", qty: 195, prevClose: 8_100 }];
    // V=195×8,100=1,579,500, L을 잡아 D=300,000을 만든다: r·L = 1,879,500 → L = 1,342,500
    const flat: DailyReturn[] = [
      { date: "d1", bp: 0 },
      { date: "d2", bp: 0 },
      { date: "d3", bp: 0 },
    ];
    const port: DailyPortfolioReturn[] = flat.map((f) => ({
      date: f.date,
      bySymbol: { "000001": 0 },
    }));
    const led = ledger(1_342_500);
    const a = replay(pos, led, flat, kisCard())[2]!;
    const b = replayPortfolio(pos, led, port, kisCard())[2]!;
    expect(a.shortfall === 0 ? 0 : a.shortfall).toBe(b.shortfall);
    expect(a.executedQty).toBe(195);
    expect(b.executedQtyTotal).toBe(195);
    expect(a.executedReason).toBe("QTY_EXCEEDED");
    expect(b.executedReason).toBe("QTY_EXCEEDED");
  });
});

/* ── 사유 코드 가드 ─────────────────────────────────────────────── */

describe("모델링하지 않은 것은 조용히 계산하지 않고 사유를 실어 거부한다", () => {
  function codeOf(fn: () => unknown): { code: string; userMessage: string } {
    try {
      fn();
    } catch (e) {
      const err = e as ReplayUnsupportedError;
      expect(err).toBeInstanceOf(ReplayUnsupportedError);
      expect(err.userMessage.length).toBeGreaterThan(0);
      return { code: err.code, userMessage: err.userMessage };
    }
    throw new Error("throw하지 않았다");
  }

  it("현금 담보가 있으면 CASH_COLLATERAL_UNSUPPORTED — 약관은 현금이 먼저다", () => {
    const v = codeOf(() =>
      replayPortfolio(positions(), ledger(9_500_000, 1_000_000), FLAT, kisCard()),
    );
    expect(v.code).toBe("CASH_COLLATERAL_UNSUPPORTED");
    expect(v.userMessage).toMatch(/현금/);
  });

  it("처분 기준가 룰이 2개 이상이면 MULTI_DISPOSAL_RULE_UNSUPPORTED — 삼성 등급 차등", () => {
    const twoRules = card([RULE_H15, { ...RULE_H15, symbol_group: "B이하", discount_rate: 0.2 }]);
    const v = codeOf(() => replayPortfolio(positions(), ledger(9_500_000), FLAT, twoRules));
    expect(v.code).toBe("MULTI_DISPOSAL_RULE_UNSUPPORTED");
  });

  it("같은 종목이 두 번이면 DUPLICATE_SYMBOL — 순서가 입력 배열에 의존하게 된다", () => {
    const dup = [...positions(), { symbol: "000660", qty: 100, prevClose: 10_000 }];
    expect(codeOf(() => replayPortfolio(dup, ledger(9_500_000), FLAT, kisCard())).code).toBe(
      "DUPLICATE_SYMBOL",
    );
  });

  it("그날 등락률에 종목이 빠지면 RETURN_SYMBOL_MISSING — 거래정지일은 0으로 명시해야 한다", () => {
    const missing: DailyPortfolioReturn[] = [
      { date: "d1", bySymbol: { "000660": 0, "005930": 0 } }, // 035720 누락
    ];
    expect(codeOf(() => replayPortfolio(positions(), ledger(9_500_000), missing, kisCard())).code).toBe(
      "RETURN_SYMBOL_MISSING",
    );
  });

  it("가격·수량이 유효하지 않으면 INVALID_POSITION", () => {
    const bad: Position[] = [{ symbol: "000001", qty: 100, prevClose: 0 }];
    expect(codeOf(() => replayPortfolio(bad, ledger(1_000), FLAT, kisCard())).code).toBe(
      "INVALID_POSITION",
    );
  });

  it("단일 종목 뷰(replay)에 다종목을 주면 MULTI_POSITION_UNSUPPORTED", () => {
    const v = codeOf(() =>
      replay(positions(), ledger(9_500_000), [{ date: "d1", bp: 0 }], kisCard()),
    );
    expect(v.code).toBe("MULTI_POSITION_UNSUPPORTED");
    expect(v.userMessage).toMatch(/replayPortfolio/);
  });

});
