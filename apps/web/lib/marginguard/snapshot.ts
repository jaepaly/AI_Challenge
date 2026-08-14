/**
 * 스냅숏 모드 데이터 (D)
 * ---------------------------------------------------------------------------
 * KIS 미연동 상태에서 랜딩이 혼자 동작하기 위한 가상 계좌·조건카드.
 * 심사 기간(9/7 11:00~9/11 23:59) 무중단 요건 때문에 이 경로는 외부 의존이 0이어야 한다.
 *
 * 수치는 전부 packages/engine이 산출한다. 이 파일은 입력값만 보관한다.
 */
import type { ConditionCard, CreditLedger, DailyPortfolioReturn, DailyReturn, EvidenceSpan, Position } from "@marginguard/engine";

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
  {
    symbol: "A0001",
    name: "가상 종목",
    qty: ACCOUNT.qty,
    prevClose,
    group: "일반",
  },
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

/**
 * 스냅숏 카드의 근거 좌표 — **실측이다.**
 * ---------------------------------------------------------------------------
 * 셋 다 `data/terms`의 원문에서 뽑았고, 다음 셋을 확인했다:
 *   ① 인용문이 평탄화 결과물에 **정확히 한 번** 나온다(좌표가 유일하게 특정된다)
 *   ② `flattened[char_start:char_end]`가 인용문과 글자 단위로 같다
 *   ③ `flattened_sha256`이 그 평탄화 결과물의 해시다
 *
 * 재현 방법(services/ingest에서):
 *   from app.parsing import parse_document
 *   d = parse_document(Path("data/terms/<파일>"))
 *   j = "
".join(u.text for u in d.units)   # 평탄화 결과물
 *   j.count(quote) == 1  and  j[char_start:char_end] == quote
 *   d.flattened_sha256 == 아래 값
 *
 * ⚠ 메리츠는 PDF지만 `source_format`이 `"pdf"`가 아니라 `"text"`다. 우리가
 * 인용하는 대상이 PDF 페이지가 아니라 **pypdf가 뽑은 평탄화 텍스트**이기 때문이다.
 * `page` 좌표를 쓰려면 원본 PDF를 document 블록으로 넣는 경로여야 하는데,
 * §5-B-2 결정은 pypdf 텍스트 경로다(#43).
 *
 * ⚠ 한투 원문의 예시 표는 D를 **예시 시작일**로 라벨해 임의처분이 D+3에 온다.
 * 메리츠는 D를 **관통일**로 라벨해 D+2다. 관통일 기준으로 재라벨하면 둘 다 +2이고
 * 엔진 replay(관통 → 익일 통지 → 익일 집행)와 같다. 카드의 "D+2 집행"은 관통일
 * 기준 표기다 — 한투 표만 보고 D+3으로 "고치지" 말 것.
 */
const EVIDENCE = {
  hantoo: {
    sha: "f454551cba8762c6bddd546050d2b1f1fdab444cc348308e37f0a358cbb8fde5",
    format: "html" as const,
    ratio: {
      quote:
        "(1) 투자원금 400만원, 신용거래융자금 600만원, 10,000원인 주식 1,000주 매입, 최저담보유지비율 140%",
      char_start: 1405,
      char_end: 1472,
    },
    disposal: {
      quote: "전일종가(6,150원) 대비 15% 하락한 가격(5,230원)을 기준으로 산정",
      char_start: 1738,
      char_end: 1781,
    },
    execution: {
      // ⚠ 이 문구는 예시 (1)과 (2)에 같은 문장으로 두 번 나온다(2008에도 있다).
      // 인용문만으로는 어느 쪽인지 특정되지 않으므로 **좌표가 정본**이다.
      // 예시 (1)을 가리킨다 — flattened[1474:1528]이 이 문자열과 일치한다.
      quote:
        "추가담보납부 요구일의 다음 영업일까지 추가담보를 납입하지 않아 그 다음 영업일에 임의처분하는 경우",
      char_start: 1474,
      char_end: 1528,
    },
  },
  meritz: {
    sha: "24d4ddf6428ea896d3b162b13b772496d764b2a13e31c53c976642c4d7f5ea0a",
    format: "text" as const,
    ratio: {
      quote: "담보유지비율(140% 가정)",
      char_start: 2995,
      char_end: 3010,
    },
    disposal: {
      quote:
        "반대매매 시 전일 종가 대비 20% 할인/할증된 가격 등으로 반대매매대상 수량을 산정",
      char_start: 1598,
      char_end: 1645,
    },
    execution: {
      quote:
        "(D일)담보유지비율하회사실발생및추가담보납부요구→(D+1)추가담보납입기한일이나추가담보미납발생→(D+2)반대매매실행",
      char_start: 3039,
      char_end: 3101,
    },
  },
  lower: {
    sha: "94fd90f454e6b6003e2d3d9f3d008e1b0d10aa4e52af5e632e7a489fcd58f92b",
    format: "html" as const,
    ratio: {
      quote: "담보유지비율이 일정비율(140%)미만으로 하락한 경우",
      char_start: 473,
      char_end: 502,
    },
    disposal: {
      quote: "[ 반대매매일 하한가 × ( 1 - 0.008 ) ] - 전일종가",
      char_start: 807,
      char_end: 843,
    },
    execution: {
      quote: "추가납부기한 익일 자동반대매매",
      char_start: 517,
      char_end: 533,
    },
  },
} as const;

type EvidenceKey = keyof typeof EVIDENCE;

function span(
  key: EvidenceKey,
  role: "ratio" | "disposal" | "execution",
): EvidenceSpan {
  const doc = EVIDENCE[key];
  const s = doc[role];
  return {
    quote: s.quote,
    source_format: doc.format,
    char_start: s.char_start,
    char_end: s.char_end,
    flattened_sha256: doc.sha,
  };
}

/**
 * 문서 식별자 — **둘 중 정확히 하나.** 주석이 아니라 타입이 강제한다.
 *
 * 이전에는 둘 다 선택이고 `p.doc_sha256!`로 단정했다. 그러면 둘 다 빠뜨린 호출이
 * `tsc`를 통과하고 `{ content_sha256: undefined }` → 직렬화하면 **`doc_version: {}`**,
 * 즉 이 PR이 불가능하게 만들려던 상태가 카드를 만드는 유일한 헬퍼에서 나온다(#46 리뷰).
 * 프리셋 3종이 다 채워져 있어 지금은 안 드러나지만 넷째 카드를 추가하는 사람이 밟는다.
 * `test_schema_mirrors`는 types.ts 본문을, `test_snapshot_evidence`는 좌표를 보므로
 * **둘 다 이걸 못 잡는다.** 잡는 것은 타입뿐이다.
 */
type DocIdentity =
  /** 심사필·심의필 번호가 있는 회사 */
  | { review_no: string; doc_sha256?: never }
  /** 번호가 없는 회사(유진) — 원문 바이트 sha256이 버전 식별자다 */
  | { review_no?: never; doc_sha256: string };

function makeCard(
  p: {
    evidence: EvidenceKey;
    broker: string;
    discount_basis: "prev_close_pct" | "lower_limit";
    discount_rate?: number;
    status: "verified" | "draft";
    verified_at?: string;
  } & DocIdentity,
): ConditionCard {
  const doc_version: ConditionCard["doc_version"] =
    p.review_no !== undefined
      ? { review_no: p.review_no }
      : { content_sha256: p.doc_sha256 };
  return {
    broker: p.broker,
    ratio_rules: [
      {
        product_type: "신용거래융자",
        collateral_type: "주식",
        symbol_group: "일반",
        ratio: 1.4,
        evidence: span(p.evidence, "ratio"),
      },
    ],
    account_aggregation: "max",
    disposal_price_rules: [
      {
        trigger: "담보부족",
        symbol_group: "일반",
        discount_basis: p.discount_basis,
        discount_rate: p.discount_rate,
        source_confidence: "explicit",
        evidence: span(p.evidence, "disposal"),
      },
    ],
    execution_schedule: [
      {
        threshold_ratio: 1.4,
        day_counting: "D일 평가 → D+2 집행",
        evidence: span(p.evidence, "execution"),
      },
    ],
    ratio_source: "clause",
    doc_version,
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
      evidence: "hantoo",
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
      evidence: "meritz",
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
    source:
      "유진 안내 페이지 '기준가격은 하한가로 계산' — 실측 카드 미확보(참고 모드)",
    card: makeCard({
      evidence: "lower",
      broker: "하한가형(예시)",
      discount_basis: "lower_limit",
      doc_sha256:
        "42cb41a7f5352ec0f7bd0f751349840377c4b6d5b94ba312b88aab1aaeb18a13",
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
export const displayRatio = (V: number, L: number) =>
  L <= 0 ? null : Math.floor((V * 100) / L);

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
  {
    symbol: "A0001",
    name: "가상 종목 갑",
    qty: 400,
    prevClose: 12_000,
    group: "일반",
  },
  {
    symbol: "A0002",
    name: "가상 종목 을",
    qty: 300,
    prevClose: 10_000,
    group: "일반",
  },
  {
    symbol: "A0003",
    name: "가상 종목 병",
    qty: 500,
    prevClose: 4_400,
    group: "일반",
  },
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
    bySymbol: Object.fromEntries(
      PORTFOLIO_POSITIONS.map((p) => [p.symbol, d.bp]),
    ),
  }));
