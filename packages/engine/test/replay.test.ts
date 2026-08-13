/**
 * replay() 골든 테스트 — TDD 선작성 (구현보다 먼저 쓰였다).
 * ---------------------------------------------------------------------------
 * 기대값은 전부 BigInt 정수 연산으로 상태기계 스펙을 독립 재계산한 값이다.
 * 실패하면 구현을 고치는 것이지, 기대값을 고치는 게 아니다.
 *
 * 상태기계 스펙 (스텝 = 거래일 1일, july_sequence 압축 벡터는 연속 거래일로 취급):
 *  1. 가격 갱신: price = floor(price × (10000 + bp) / 10000)
 *     — 원 단위 내림 고정. 부동소수 곱(×0.9509…)의 드리프트를 막기 위해
 *       정수 스케일 곱 + 내림으로만 계산한다. 이 테스트는 BigInt 나눗셈
 *       (양수에서 floor와 동치)으로 같은 시리즈를 재계산해 내림 규칙을 박제한다.
 *  2. phase 결정(전일 상태로부터): 전일 관통 발견 → 오늘 "notified"(D+1 통지).
 *     전일 notified·미해소 → 오늘 "executed"(D+2 집행).
 *     관통 "발견일"의 phase는 "normal"이다(shortfall>0로 표시) — 통지는 익일.
 *  3. 집행: 수량 = liquidationQty({ D: 전일 종가 기준 부족액, prevClose: 전일 종가, r, h, held }).
 *     h는 카드 disposal_price_rules[0] (prev_close_pct→discount_rate, lower_limit→0.30 등가).
 *     체결가 = 집행일 가격(갱신 후 종가, 기본 가정) — 수량 산정에 미관여(세 가격 분리).
 *     원장: loan = max(0, loan − qty×체결가), held −= qty. FULL이면 qty = 보유 전량.
 *  4. 종가 판정: V = held×price + cash, D = shortfall(V, loan, r) — 라운딩 없는 정수 계산.
 *  5. 전이: notified 스텝 — 종가 D>0·held>0이면 다음날 집행, 아니면 해소(취소).
 *     그 외(normal/executed) — D>0·held>0이면 다음날 통지(재관통 포함), 아니면 평상.
 */
import { readFileSync } from "node:fs";
import { TEST_EVIDENCE } from "./evidence-fixture";
import { describe, it, expect } from "vitest";
import { replay } from "../src/index";
import type {
  ConditionCard,
  CreditLedger,
  DailyReturn,
  DisposalPriceRule,
  Position,
  ReplayStep,
} from "../src/index";

/* ── 데이터: july_sequence는 data/golden/golden_cases.json이 정본 ──────── */

const golden = JSON.parse(
  readFileSync(new URL("../../../data/golden/golden_cases.json", import.meta.url), "utf-8"),
) as { july_sequence: { days: { date: string; return_bp: number }[] } };

const julyVector: DailyReturn[] = golden.july_sequence.days.map((d) => ({
  date: d.date,
  bp: d.return_bp,
}));

/** 해소(회복) 경로용 합성 벡터 — −18% 관통 후 +5% 반등으로 부족 해소 */
const recoveryVector: DailyReturn[] = [
  { date: "2026-08-03", bp: -1800 },
  { date: "2026-08-04", bp: 500 },
  { date: "2026-08-05", bp: 0 },
];

/* ── 픽스처 ─────────────────────────────────────────────────────────── */

/** 공통 시작 상태: 1,000주 × 전일종가 10,000원 단일 종목 */
function positions(): Position[] {
  return [{ symbol: "TEST01", name: "골든테스트종목", qty: 1_000, prevClose: 10_000, group: "일반" }];
}

/** cash 0 · r=1.4 원장 */
function ledger(loan: number): CreditLedger {
  return { loan, cash: 0, requiredRatio: 1.4 };
}

function makeCard(broker: string, disposal_price_rules: DisposalPriceRule[]): ConditionCard {
  return {
    broker,
    ratio_rules: [
      { product_type: "신용융자", collateral_type: "주식", symbol_group: "일반", ratio: 1.4, evidence: TEST_EVIDENCE },
    ],
    account_aggregation: "max",
    disposal_price_rules,
    execution_schedule: [
      { threshold_ratio: 1.4, day_counting: "D일 15:40 평가 → D+1 통지 → D+2 집행", evidence: TEST_EVIDENCE },
    ],
    ratio_source: "clause",
    doc_version: { review_no: "TEST-REPLAY-2026-08" },
    status: "verified",
    verified_at: "2026-08-01",
  };
}

/** ① 한투형 h=0.15 (prev_close_pct) */
function kisCard(): ConditionCard {
  return makeCard("한국투자증권", [
    {
      trigger: "margin_call",
      symbol_group: "일반",
      discount_basis: "prev_close_pct",
      discount_rate: 0.15,
      source_confidence: "explicit",
      evidence: TEST_EVIDENCE,
    },
  ]);
}

/** ② 메리츠형 h=0.20 (prev_close_pct) */
function meritzCard(): ConditionCard {
  return makeCard("메리츠증권", [
    {
      trigger: "margin_call",
      symbol_group: "일반",
      discount_basis: "prev_close_pct",
      discount_rate: 0.2,
      source_confidence: "explicit",
      evidence: TEST_EVIDENCE,
    },
  ]);
}

/** ③ 하한가형 (lower_limit, discount_rate 없음) — h=0.30 등가 → k=−0.02 ≤ 0 */
function lowerLimitCard(): ConditionCard {
  return makeCard("하한가형증권", [
    {
      trigger: "margin_call",
      symbol_group: "일반",
      discount_basis: "lower_limit",
      source_confidence: "inferred_from_formula",
      evidence: TEST_EVIDENCE,
    },
  ]);
}

function run(card: ConditionCard, loan: number, vector: DailyReturn[] = julyVector): ReplayStep[] {
  return replay(positions(), ledger(loan), vector, card);
}

/* ── 기대값 (BigInt 독립 재계산 결과) ──────────────────────────────────── */

interface ExpectedRow {
  date: string;
  dailyReturn: number;
  pricePrev: number;
  phase: ReplayStep["phase"];
  V: number;
  L: number;
  shortfall: number;
  executedQty: number;
  executedReason: ReplayStep["executedReason"];
  fillPrice: number | null;
  heldAfter: number;
  ledgerAfter: CreditLedger;
}

function row(
  date: string,
  bp: number,
  price: number,
  phase: ReplayStep["phase"],
  V: number,
  L: number,
  D: number,
  exec: {
    qty?: number;
    reason?: ReplayStep["executedReason"];
    fill?: number | null;
    held?: number;
  } = {},
): ExpectedRow {
  return {
    date,
    dailyReturn: bp,
    pricePrev: price,
    phase,
    V,
    L,
    shortfall: D,
    executedQty: exec.qty ?? 0,
    executedReason: exec.reason ?? null,
    fillPrice: exec.fill ?? null,
    heldAfter: exec.held ?? 1_000,
    ledgerAfter: { loan: L, cash: 0, requiredRatio: 1.4 },
  };
}

/** ReplayStep → 기대값 비교용 정규화 (ratioRaw는 별도 assert) */
function normalize(steps: ReplayStep[]): ExpectedRow[] {
  return steps.map((s) => ({
    date: s.date,
    dailyReturn: s.dailyReturn,
    pricePrev: s.pricePrev,
    phase: s.phase,
    V: s.V,
    L: s.L,
    shortfall: s.shortfall,
    executedQty: s.executedQty,
    executedReason: s.executedReason,
    fillPrice: s.fillPrice,
    heldAfter: s.heldAfter,
    ledgerAfter: s.ledgerAfter,
  }));
}

/** ratioRaw = L>0 ? (V×100)/L : null — 라운딩 없음, 연산 순서까지 고정 */
function assertRatioRaw(steps: ReplayStep[], expected: ExpectedRow[]): void {
  expected.forEach((e, i) => {
    const step = steps[i]!;
    if (e.L > 0) {
      expect(step.ratioRaw, `${e.date} ratioRaw`).toBe((e.V * 100) / e.L);
    } else {
      expect(step.ratioRaw, `${e.date} ratioRaw(L=0)`).toBeNull();
    }
  });
}

/**
 * 시나리오 1 — 한투 카드 · 리뷰어 수기 재현용 검산.
 * 초기: 1,000주 × 10,000원 → V₀ 10,000,000 / L 6,000,000 / cash 0 / r 1.4 (rL 8,400,000)
 *       / h 0.15 → k = 1.4×(1−0.15) − 1 = 0.19.
 * 첫 관통(7/13): 10,000 → floor(10,000×9509/10⁴)=9,509 → floor(9,509×9465/10⁴)=9,000
 *   → floor(9,000×9105/10⁴)=floor(8,194.5)=8,194. V 8,194,000 < 8,400,000 → D 206,000 (발견일 normal).
 * 첫 집행(7/28 = 관통 D+2): D = 8,400,000 − 7,725,000 = 675,000 (7/24 종가 기준), P_prev 7,725
 *   → n = ceil(675,000 / (7,725×0.19)) = ceil(675,000/1,467.75) = ceil(459.887…) = 460 < 1,000 → PARTIAL.
 *   체결 460×6,887 = 3,168,020 → L 2,831,980 / held 540. 집행일 종가 재판정:
 *   V = 540×6,887 = 3,718,980 < 1.4×2,831,980 = 3,964,772 → 재관통 D 245,792 → 7/29 재통지.
 */
const EXPECTED_S1: ExpectedRow[] = [
  row("2026-07-07", -491, 9_509, "normal", 9_509_000, 6_000_000, 0),
  row("2026-07-08", -535, 9_000, "normal", 9_000_000, 6_000_000, 0),
  row("2026-07-13", -895, 8_194, "normal", 8_194_000, 6_000_000, 206_000), // 첫 관통(발견일 normal)
  row("2026-07-24", -572, 7_725, "notified", 7_725_000, 6_000_000, 675_000),
  row("2026-07-28", -1084, 6_887, "executed", 3_718_980, 2_831_980, 245_792, {
    qty: 460,
    reason: "PARTIAL",
    fill: 6_887,
    held: 540,
  }),
  row("2026-07-29", -598, 6_475, "notified", 3_496_500, 2_831_980, 468_272, { held: 540 }),
];

/**
 * 시나리오 2 — 메리츠 카드 · 리뷰어 수기 재현용 검산.
 * 초기: 1,000주 × 10,000원 → V₀ 10,000,000 / L 5,600,000 / cash 0 / r 1.4 (rL 7,840,000)
 *       / h 0.20 → k = 1.4×(1−0.20) − 1 = 0.12.
 * 첫 관통(7/24): 7/13 종가 8,194 → V 8,194,000 ≥ 7,840,000 아슬 통과(여유 354,000) →
 *   7/24 종가 floor(8,194×9428/10⁴)=7,725 → V 7,725,000 < 7,840,000 → D 115,000 (발견일 normal).
 * 첫 집행(7/29 = 관통 D+2): "7/28 −10.84%가 QTY_EXCEEDED를 촉발" — 산정의 D·P_prev가 7/28 종가다:
 *   D = 7,840,000 − 6,887,000 = 953,000, P_prev 6,887
 *   → n = ceil(953,000 / (6,887×0.12)) = ceil(953,000/826.44) = ceil(1,153.13…) = 1,154 ≥ 1,000
 *   → FULL/QTY_EXCEEDED 전량. 체결 1,000×6,475 = 6,475,000 ≥ 5,600,000 → L 0(완제) / ratioRaw null.
 */
const EXPECTED_S2: ExpectedRow[] = [
  row("2026-07-07", -491, 9_509, "normal", 9_509_000, 5_600_000, 0),
  row("2026-07-08", -535, 9_000, "normal", 9_000_000, 5_600_000, 0),
  row("2026-07-13", -895, 8_194, "normal", 8_194_000, 5_600_000, 0), // 아슬하게 통과: 8,194,000 ≥ 7,840,000
  row("2026-07-24", -572, 7_725, "normal", 7_725_000, 5_600_000, 115_000), // 첫 관통(발견일 normal)
  row("2026-07-28", -1084, 6_887, "notified", 6_887_000, 5_600_000, 953_000),
  row("2026-07-29", -598, 6_475, "executed", 0, 0, 0, {
    qty: 1_000,
    reason: "QTY_EXCEEDED",
    fill: 6_475,
    held: 0,
  }),
];

/**
 * 시나리오 3 — 하한가형 카드 · 리뷰어 수기 재현용 검산.
 * 초기: 1,000주 × 10,000원 → V₀ 10,000,000 / L 6,000,000 / cash 0 / r 1.4 (rL 8,400,000)
 *       / lower_limit → h 0.30 등가 → k = 1.4×(1−0.30) − 1 = −0.02 ≤ 0.
 * 첫 관통(7/13): 시나리오 1과 동일 경로 — 종가 8,194 → V 8,194,000 < 8,400,000 → D 206,000.
 * 첫 집행(7/28 = 관통 D+2): k ≤ 0이라 부분 매도로 비율 복원 불가 → FULL/K_NON_POSITIVE 전량 1,000주.
 *   체결 1,000×6,887 = 6,887,000 ≥ 6,000,000 → L 0 / held 0 / D 0 → 7/29는 normal(V 0).
 */
const EXPECTED_S3: ExpectedRow[] = [
  row("2026-07-07", -491, 9_509, "normal", 9_509_000, 6_000_000, 0),
  row("2026-07-08", -535, 9_000, "normal", 9_000_000, 6_000_000, 0),
  row("2026-07-13", -895, 8_194, "normal", 8_194_000, 6_000_000, 206_000),
  row("2026-07-24", -572, 7_725, "notified", 7_725_000, 6_000_000, 675_000),
  row("2026-07-28", -1084, 6_887, "executed", 0, 0, 0, {
    qty: 1_000,
    reason: "K_NON_POSITIVE",
    fill: 6_887,
    held: 0,
  }),
  row("2026-07-29", -598, 6_475, "normal", 0, 0, 0, { held: 0 }),
];

/**
 * 시나리오 4 — 해소(회복) 경로, 한투 카드 · 리뷰어 수기 재현용 검산.
 * 초기: 시나리오 1과 동일 (V₀ 10,000,000 / L 6,000,000 / cash 0 / r 1.4, rL 8,400,000).
 * 첫 관통(d1, −18%): floor(10,000×8200/10⁴) = 8,200 → V 8,200,000 < 8,400,000 → D 200,000.
 * 통지일 해소(d2, +5%): floor(8,200×10500/10⁴) = 8,610 → V 8,610,000 ≥ 8,400,000 → D 0
 *   → 집행 취소, d3 normal 복귀. 집행 스텝 없음(전 스텝 executedQty 0).
 */
const EXPECTED_S4: ExpectedRow[] = [
  row("2026-08-03", -1800, 8_200, "normal", 8_200_000, 6_000_000, 200_000),
  row("2026-08-04", 500, 8_610, "notified", 8_610_000, 6_000_000, 0), // 해소 — 집행으로 가지 않는다
  row("2026-08-05", 0, 8_610, "normal", 8_610_000, 6_000_000, 0),
];

/* ── 벡터 픽스처 고정 ──────────────────────────────────────────────── */

describe("july_sequence 벡터 (JSON이 정본)", () => {
  it("압축 벡터 6일: 7/7 −491 · 7/8 −535 · 7/13 −895 · 7/24 −572 · 7/28 −1084 · 7/29 −598 bp", () => {
    expect(julyVector.map((d) => d.date)).toEqual([
      "2026-07-07",
      "2026-07-08",
      "2026-07-13",
      "2026-07-24",
      "2026-07-28",
      "2026-07-29",
    ]);
    expect(julyVector.map((d) => d.bp)).toEqual([-491, -535, -895, -572, -1084, -598]);
  });
});

/* ── 시나리오 골든 ─────────────────────────────────────────────────── */

describe("시나리오 1 — 한투 h=0.15 · loan 600만: D+2 PARTIAL 460주 → 집행일 종가 재관통 연쇄", () => {
  it("6스텝 전 필드 일치 (7/28: qty 460 · fill 6887 · L 2,831,980 · 재관통 D 245,792)", () => {
    const steps = run(kisCard(), 6_000_000);
    expect(normalize(steps)).toEqual(EXPECTED_S1);
  });

  it("ratioRaw = (V×100)/L 라운딩 없음", () => {
    const steps = run(kisCard(), 6_000_000);
    assertRatioRaw(steps, EXPECTED_S1);
  });
});

describe("시나리오 2 — 메리츠 h=0.20 · loan 560만: 7/28 −10.84%가 QTY_EXCEEDED를 촉발", () => {
  it("6스텝 전 필드 일치 (7/13 아슬 통과 D 0 → 7/24 첫 관통 → 7/29 FULL 1000주 → L 0)", () => {
    const steps = run(meritzCard(), 5_600_000);
    expect(normalize(steps)).toEqual(EXPECTED_S2);
  });

  it("ratioRaw — 완제 후 L=0이면 null", () => {
    const steps = run(meritzCard(), 5_600_000);
    assertRatioRaw(steps, EXPECTED_S2);
  });
});

describe("시나리오 3 — 하한가형 k=−0.02 · loan 600만: K_NON_POSITIVE 전량 폴백 후 완제", () => {
  it("6스텝 전 필드 일치 (7/28 FULL 1000주 fill 6887 → L 0 → 7/29 normal·V 0·D 0)", () => {
    const steps = run(lowerLimitCard(), 6_000_000);
    expect(normalize(steps)).toEqual(EXPECTED_S3);
  });

  it("ratioRaw — 완제 후 L=0이면 null", () => {
    const steps = run(lowerLimitCard(), 6_000_000);
    assertRatioRaw(steps, EXPECTED_S3);
  });
});

describe("시나리오 4 — 해소(회복) 경로: 관통 → 반등 해소 → 집행 없이 normal 복귀", () => {
  it("3스텝 전 필드 일치 (d2 notified에서 D 0으로 해소, d3 normal)", () => {
    const steps = run(kisCard(), 6_000_000, recoveryVector);
    expect(normalize(steps)).toEqual(EXPECTED_S4);
  });

  it("전 스텝 executedQty 0 · fillPrice null — 집행이 일어나지 않아야 한다", () => {
    const steps = run(kisCard(), 6_000_000, recoveryVector);
    for (const s of steps) {
      expect(s.executedQty, `${s.date} executedQty`).toBe(0);
      expect(s.executedReason, `${s.date} executedReason`).toBeNull();
      expect(s.fillPrice, `${s.date} fillPrice`).toBeNull();
    }
  });
});

/* ── 성질 검증 (시나리오 1~3 전 경로) ──────────────────────────────── */

/** 가격 시리즈 BigInt 독립 재계산 — BigInt 나눗셈은 0방향 절사 = 양수 floor. 내림 규칙 박제. */
function bigintClosePrices(startPrice: bigint, bps: number[]): number[] {
  let p = startPrice;
  return bps.map((bp) => {
    p = (p * (10_000n + BigInt(bp))) / 10_000n;
    return Number(p);
  });
}

function scenarios(): { label: string; steps: ReplayStep[]; vector: DailyReturn[] }[] {
  return [
    { label: "S1 한투 h=0.15", steps: run(kisCard(), 6_000_000), vector: julyVector },
    { label: "S2 메리츠 h=0.20", steps: run(meritzCard(), 5_600_000), vector: julyVector },
    { label: "S3 하한가형", steps: run(lowerLimitCard(), 6_000_000), vector: julyVector },
  ];
}

describe("성질 검증 — 시나리오 1~3 전 경로", () => {
  it("정수 유지: price·V·L·executedQty·heldAfter 전부 정수 + price BigInt 재계산 일치", () => {
    for (const { label, steps, vector } of scenarios()) {
      const reference = bigintClosePrices(10_000n, vector.map((d) => d.bp));
      expect(steps.map((s) => s.pricePrev), `${label} price 시리즈`).toEqual(reference);
      for (const s of steps) {
        expect(Number.isInteger(s.pricePrev), `${label} ${s.date} pricePrev 정수`).toBe(true);
        expect(Number.isInteger(s.V), `${label} ${s.date} V 정수`).toBe(true);
        expect(Number.isInteger(s.L), `${label} ${s.date} L 정수`).toBe(true);
        expect(Number.isInteger(s.executedQty), `${label} ${s.date} executedQty 정수`).toBe(true);
        expect(Number.isInteger(s.heldAfter), `${label} ${s.date} heldAfter 정수`).toBe(true);
      }
    }
  });

  it("집행 스텝: FULL 계열은 heldAfter 0, PARTIAL은 산정 기준가(P_prev) 평가 복원 보장", () => {
    // 주석: 집행일 종가 평가로는 재관통이 가능하며 그것이 연쇄 시나리오의 본질(S1 7/28 D 245,792)
    // — 복원 보장은 수량 산정에 쓰인 기준가(직전 스텝 종가) 평가에 대한 것이다.
    let executedSeen = 0;
    for (const { label, steps } of scenarios()) {
      steps.forEach((s, i) => {
        if (s.phase !== "executed") return;
        executedSeen += 1;
        expect(i, `${label} ${s.date} 집행은 첫 스텝일 수 없다`).toBeGreaterThan(0);
        if (s.executedReason === "K_NON_POSITIVE" || s.executedReason === "QTY_EXCEEDED") {
          expect(s.heldAfter, `${label} ${s.date} FULL → 전량 처분`).toBe(0);
        } else {
          expect(s.executedReason, `${label} ${s.date} 집행 사유`).toBe("PARTIAL");
          const basisPrice = BigInt(steps[i - 1]!.pricePrev);
          const lhs = (BigInt(s.heldAfter) * basisPrice + BigInt(s.ledgerAfter.cash)) * 100n;
          const rhs = 140n * BigInt(s.ledgerAfter.loan);
          expect(lhs >= rhs, `${label} ${s.date} (held×P_prev+cash)×100 ≥ 140×loan`).toBe(true);
        }
      });
    }
    expect(executedSeen, "세 시나리오 모두 집행 스텝이 있어야 한다").toBe(3);
  });

  it("낙관 방향 위반 0 — PARTIAL 수량의 ceil 보장 (S1, k_micro=190,000)", () => {
    // executedQty × basisPrice × 190,000 ≥ 직전 스텝 shortfall × 10⁶.
    // 수량을 하회 산정(내림·절사)하는 순간 위반이다 — qty−1은 반드시 부족해야 한다(최소 ceil).
    const steps = run(kisCard(), 6_000_000);
    const K_MICRO = 190_000n; // r=1.4, h=0.15 → 140×8500 − 10⁶
    let partialSeen = 0;
    steps.forEach((s, i) => {
      if (s.executedReason !== "PARTIAL") return;
      partialSeen += 1;
      const basisPrice = BigInt(steps[i - 1]!.pricePrev);
      const need = BigInt(steps[i - 1]!.shortfall) * 1_000_000n;
      const qty = BigInt(s.executedQty);
      expect(qty * basisPrice * K_MICRO >= need, `${s.date} ceil 하한 보장`).toBe(true);
      expect((qty - 1n) * basisPrice * K_MICRO < need, `${s.date} qty−1은 부족(최소 ceil)`).toBe(true);
    });
    expect(partialSeen, "S1에는 PARTIAL 집행이 정확히 1회").toBe(1);
    // 재계산 박제: 7/28 460주 = ceil(675,000×10⁶ / (7725×190,000)), 459주는 위반
    expect(460n * 7_725n * K_MICRO >= 675_000n * 1_000_000n).toBe(true);
    expect(459n * 7_725n * K_MICRO < 675_000n * 1_000_000n).toBe(true);
  });
});

/* ── 입력 검증 throw ───────────────────────────────────────────────── */

describe("입력 검증", () => {
  it("positions 2개 이상이면 throw — 단일 종목만 지원", () => {
    const two: Position[] = [
      { symbol: "TEST01", qty: 1_000, prevClose: 10_000, group: "일반" },
      { symbol: "TEST02", qty: 500, prevClose: 20_000, group: "일반" },
    ];
    expect(() => replay(two, ledger(6_000_000), julyVector, kisCard())).toThrow();
  });

  it("disposal_price_rules 빈 카드면 throw", () => {
    const card: ConditionCard = { ...kisCard(), disposal_price_rules: [] };
    expect(() => replay(positions(), ledger(6_000_000), julyVector, card)).toThrow();
  });
});
