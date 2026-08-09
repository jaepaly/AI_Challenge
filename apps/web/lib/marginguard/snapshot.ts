/**
 * 스냅숏 모드 데이터 (D)
 * ---------------------------------------------------------------------------
 * KIS 미연동 상태에서 랜딩이 혼자 동작하기 위한 가상 계좌·조건카드.
 * 심사 기간(9/7 11:00~9/11 23:59) 무중단 요건 때문에 이 경로는 외부 의존이 0이어야 한다.
 *
 * 수치는 전부 packages/engine이 산출한다. 이 파일은 입력값만 보관한다.
 */
import type { ConditionCard, CreditLedger, DailyReturn, Position } from "@marginguard/engine";

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
