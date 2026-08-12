/**
 * 스냅숏 모드 데이터 (D)
 * ---------------------------------------------------------------------------
 * KIS 미연동 상태에서 랜딩이 혼자 동작하기 위한 가상 계좌·조건카드.
 * 심사 기간(9/7 11:00~9/11 23:59) 무중단 요건 때문에 이 경로는 외부 의존이 0이어야 한다.
 *
 * 수치는 전부 packages/engine이 산출한다. 이 파일은 입력값만 보관한다.
 */
import type {
  ConditionCard,
  CreditLedger,
  DailyPortfolioReturn,
  DailyReturn,
  Position,
} from "@marginguard/engine";

/** 가상 계좌 — 한투 설명서 골든 계좌와 같은 구조(1,000주 · 융자 600만 · 유지비율 140%) */
export const ACCOUNT = {
  qty: 1_000,
  loan: 6_000_000,
  cash: 0,
  requiredRatio: 1.4,
} as const;

export const TICK = 10; // 호가단위(원) — 이 가격대는 10원
export const PRICE_MIN = 5_000;
export const PRICE_MAX = 12_000;
export const PRICE_START = 10_000;

export const roundTick = (p: number) => Math.round(p / TICK) * TICK;

export const ledger = (): CreditLedger => ({
  loan: ACCOUNT.loan,
  cash: ACCOUNT.cash,
  requiredRatio: ACCOUNT.requiredRatio,
});

export const positions = (prevClose: number): Position[] => [
  { symbol: "A0001", name: "가상 종목", qty: ACCOUNT.qty, prevClose, group: "일반" },
];

/** 조건카드 프리셋 — h(산정 기준가 할인율) 편차 3종. 실측 근거는 data/terms/README */
export interface CardPreset {
  key: string;
  broker: string;
  label: string;
  hLabel: string;
  source: string;
  card: ConditionCard;
}

function makeCard(p: {
  broker: string;
  discount_basis: "prev_close_pct" | "lower_limit";
  discount_rate?: number;
  review_no?: string;
  status: "verified" | "draft";
  verified_at?: string;
}): ConditionCard {
  return {
    broker: p.broker,
    ratio_rules: [
      { product_type: "신용거래융자", collateral_type: "주식", symbol_group: "일반", ratio: 1.4 },
    ],
    account_aggregation: "max",
    disposal_price_rules: [
      {
        trigger: "담보부족",
        symbol_group: "일반",
        discount_basis: p.discount_basis,
        discount_rate: p.discount_rate,
        source_confidence: "explicit",
      },
    ],
    execution_schedule: [{ threshold_ratio: 1.4, day_counting: "D일 평가 → D+2 집행" }],
    ratio_source: "clause",
    doc_version: { review_no: p.review_no },
    status: p.status,
    verified_at: p.verified_at,
  };
}

export const CARDS: CardPreset[] = [
  {
    key: "hantoo",
    broker: "한국투자",
    label: "한국투자",
    hLabel: "−15%",
    source: "신용거래설명서 심사필 제2026-0265호 · 골든 195주 재현",
    card: makeCard({
      broker: "한국투자",
      discount_basis: "prev_close_pct",
      discount_rate: 0.15,
      review_no: "2026-0265",
      status: "verified",
      verified_at: "2026-08-09",
    }),
  },
  {
    key: "meritz",
    broker: "메리츠",
    label: "메리츠",
    hLabel: "−20%",
    source: "신용거래설명서 심의필 제25-125호 · 교차검증 309주",
    card: makeCard({
      broker: "메리츠",
      discount_basis: "prev_close_pct",
      discount_rate: 0.2,
      review_no: "25-125",
      status: "verified",
      verified_at: "2026-08-09",
    }),
  },
  {
    key: "lower",
    broker: "하한가형",
    label: "하한가형",
    hLabel: "하한가",
    source: "유진 안내 페이지 '기준가격은 하한가로 계산' — 실측 카드 미확보(참고 모드)",
    card: makeCard({
      broker: "하한가형(예시)",
      discount_basis: "lower_limit",
      status: "draft",
    }),
  },
];

/**
 * 2026년 7월 연쇄 — 정수 bp. A의 replay()가 소비한다.
 * 출처·압축 라벨은 packages/engine 골든(data/golden) 및 PR #8 참조.
 * 7/28 −10.84%는 7/29 종가에서 역산한 교차검증값. 8월 말 KRX 확정치 대조 예정.
 */
export const JULY_SEQ: DailyReturn[] = [
  { date: "2026-07-07", bp: -491 },
  { date: "2026-07-08", bp: -535 },
  { date: "2026-07-13", bp: -895 },
  { date: "2026-07-24", bp: -572 },
  { date: "2026-07-28", bp: -1084 },
  { date: "2026-07-29", bp: -598 },
];

/** 표시 규약 — 담보비율은 내림. 판정은 원시값, 골든 재현은 사사오입(PR #2 3단 합의) */
export const displayRatio = (V: number, L: number) => (L <= 0 ? null : Math.floor((V * 100) / L));

export const won = (n: number) => n.toLocaleString("ko-KR") + "원";

/**
 * 자발적 매도 제비용률 — **가정치다. 약관 원문 근거가 없다.**
 *
 * 조건카드에서 나오는 r·h와 성질이 완전히 다르다. r·h는 약관 조항에 명문으로
 * 있고 근거 좌표가 붙지만, 이 값은 위탁수수료·거래세·유관기관수수료를 합친
 * 업계 통상치를 우리가 고른 것이다. 그래서 화면에서 "산정 방식 재현값" 라벨을
 * 공유하지 않고 **"가정"이라고 명시**해야 한다(규율 ② 출처 없는 수치).
 *
 * 표시 문구를 만들 때 이 상수에서 퍼센트를 뽑아 쓴다 — 코드와 화면이 갈라지면
 * 그게 곧 "화면이 근거를 잘못 말하는" 상태다.
 */
export const ASSUMED_FEE_RATE = 0.008;
export const assumedFeePct = (ASSUMED_FEE_RATE * 100).toFixed(1); // "0.8"

/* ── 다종목 스냅숏 (D) ───────────────────────────────────────────────────
 * 단일 종목 화면이 답하지 못하는 질문이 하나 있다 — "내 계좌엔 종목이 여러 개인데?"
 *
 * 계좌 규모는 단일 종목 계좌와 나란히 읽히도록 융자 600만·유지비율 140%로 맞췄다.
 * 평가액 합계 1,000만이라 버퍼가 160만이고, 그래서 λ*가 정확히 16%다.
 *
 * ⚠ cash는 0이어야 한다 — 엔진이 현금 우선 상환을 모델링하지 않았고,
 *   미반영은 낙관 방향이라 replayPortfolio가 cash>0을 아예 거부한다(#23).
 */
export const PORTFOLIO_POSITIONS: Position[] = [
  { symbol: "A0001", name: "가상 종목 갑", qty: 400, prevClose: 12_000, group: "일반" },
  { symbol: "A0002", name: "가상 종목 을", qty: 300, prevClose: 10_000, group: "일반" },
  { symbol: "A0003", name: "가상 종목 병", qty: 500, prevClose: 4_400, group: "일반" },
];

export const portfolioLedger = (): CreditLedger => ({
  loan: 6_000_000,
  cash: 0,
  requiredRatio: 1.4,
});

/**
 * 다종목 재생 입력 — **전 종목에 같은 일간 등락을 적용한 균등 시나리오다.**
 *
 * 날짜와 등락폭은 JULY_SEQ(실측)를 그대로 쓰지만, **종목별 실제 등락은 서로 다르다.**
 * 종목별 실데이터 스냅숏은 아직 없다(8/24 전 확보 예정). 지어낸 종목별 수익률을
 * "7월에 실제로 있었던 일"로 내보내면 그 순간 이 제품의 주장이 거짓이 된다.
 *
 * 그래서 이 재생이 증명하는 것은 **역사 재현이 아니라 배분 규칙**이다 —
 * 같은 충격에서 종목번호 순으로 어떻게 처분이 배분되는지.
 */
export const portfolioJuly = (): DailyPortfolioReturn[] =>
  JULY_SEQ.map((d) => ({
    date: d.date,
    bySymbol: Object.fromEntries(PORTFOLIO_POSITIONS.map((p) => [p.symbol, d.bp])),
  }));
