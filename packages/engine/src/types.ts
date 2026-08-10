/**
 * 경계 계약 (Boundary Contracts)
 * ---------------------------------------------------------------------------
 * A(엔진)·B(AI 파이프라인)·C(플랫폼)·D(UI) 사이의 타입 계약.
 * 변경 규칙: PR + 팀 전원 승인. B는 아래 두 파일을 이 파일과 동기화할 책임이 있다.
 *   - schemas/condition_card.schema.json  (LLM 출력 검증용 — wire format의 정본)
 *   - services/ingest/app/schemas.py      (Pydantic 미러)
 *
 * ※ ConditionCard 계열은 wire format(JSON)과 필드명을 1:1로 맞추기 위해
 *   snake_case를 그대로 쓴다 — 변환 계층에서 생기는 매핑 버그를 원천 차단.
 *   TS 내부 전용 타입(Position, RiskResult 등)은 camelCase.
 */

/* ── C(합성 원장/KIS 연동) → A(엔진) ────────────────────────────── */

/** 보유 포지션. prevClose(전일 종가)가 평가·수량 산정의 기준가다. */
export interface Position {
  symbol: string;
  name?: string;
  qty: number;
  prevClose: number;
  /** 조건 카드 ratio_rules 매칭용 종목군 (예: "일반", "관리", "ETF") */
  group?: string;
}

/** 합성 신용 원장 — KIS 모의투자는 신용 미지원이므로 융자금·이자는 우리 장부. */
export interface CreditLedger {
  /** 융자금 L (원) */
  loan: number;
  /** 현금·현금성 담보 (원) — 주가 충격을 받지 않는 담보 */
  cash: number;
  /** 담보유지비율 r (예: 1.4 = 140%) */
  requiredRatio: number;
}

/* ── B(인제스트) → A(엔진) : ConditionCard v2 ───────────────────── */

/** 근거 좌표 — 인제스트 출력의 필수 필드. 좌표를 못 찾으면 출력을 거부한다. */
export interface EvidenceSpan {
  source_format: "pdf" | "text" | "html";
  page: number;
  start: number;
  end: number;
  quote: string;
}

export type SourceConfidence = "explicit" | "inferred_from_formula";

/** 담보유지비율 룰 — r은 스칼라가 아니라 상품유형×담보유형×종목군 룰 테이블이다(105~170% 편차 실측). */
export interface RatioRule {
  product_type: string;
  collateral_type: string;
  symbol_group: string;
  /** 1.05 ~ 1.70 */
  ratio: number;
  evidence?: EvidenceSpan;
}

export interface DisposalPriceRule {
  trigger: string;
  symbol_group: string;
  /** prev_close_pct = 전일종가 −h% | lower_limit = 하한가 기준 */
  discount_basis: "prev_close_pct" | "lower_limit";
  /** discount_basis가 prev_close_pct일 때의 h (0.15 = −15%) */
  discount_rate?: number;
  source_confidence: SourceConfidence;
  evidence?: EvidenceSpan;
}

export interface ExecutionScheduleRule {
  /** 발동 임계 담보비율 (예: 1.4 부족판정 / 1.2~1.3 2단 임계) */
  threshold_ratio: number;
  /** 예: "D일 15:40 평가 → D+2 미해소 시 D+3 개장 집행" */
  day_counting: string;
  evidence?: EvidenceSpan;
}

export interface DocVersion {
  /** 심사필 번호 (우선) */
  review_no?: string;
  /** 번호가 없는 회사(미래에셋·유진 등)의 폴백 */
  content_sha256?: string;
  revised_at?: string;
}

/** 조건 카드 v2. status가 verified인 카드만 계산에 사용한다(2단 상태). */
export interface ConditionCard {
  broker: string;
  ratio_rules: RatioRule[];
  /** 복수 계좌 합산 규칙 (예: 신한형 max | 가중평균형) */
  account_aggregation: "max" | "weighted_average";
  disposal_price_rules: DisposalPriceRule[];
  execution_schedule: ExecutionScheduleRule[];
  /** 수치의 출처 계층 — KB처럼 약관에 국내 h 미기재(hts_only)인 회사 구분 */
  ratio_source: "clause" | "website_notice" | "hts_only";
  doc_version: DocVersion;
  contract_vintage?: string;
  /** verified = 검수 완료(계산 사용 가능) | draft = 즉석 생성(참고 모드 전용) */
  status: "verified" | "draft";
  /** ISO 날짜 — 신선도 게이트(검증일 기준 30일)의 기준. 수집일이 아니다. */
  verified_at?: string;
}

/* ── A(엔진) → D(UI) ────────────────────────────────────────────── */

export interface LiquidationResult {
  mode: "PARTIAL" | "FULL";
  /** K_NON_POSITIVE = k≤0, 부분 매도로 복원 불가 | QTY_EXCEEDED = 필요 수량 ≥ 보유 */
  reason?: "K_NON_POSITIVE" | "QTY_EXCEEDED";
  /** 실제 처분 수량 (FULL이면 보유 전량) */
  qty: number;
  /** 복원 계수 k = r(1−h) − 1 */
  k: number;
  /** min(보유) 적용 전 필요 수량 — K_NON_POSITIVE면 null */
  rawQty: number | null;
}

/** 담보부족 해소 4경로의 필요액 */
export interface ResolutionPaths {
  /** 현금 입금 = D */
  deposit: number;
  /** 융자 상환 = ceil(D / r) — 입금보다 28.6% 적다 (r=1.4) */
  repay: number;
  /** 대용증권 추가 = ceil(D / α). α 미지정이면 null */
  collateral: number | null;
  /** 자발적 매도 수량 = ceil(D / (r·P_m·(1−f) − P_prev)). 분모≤0이면 null(매도로 해소 불가) */
  voluntarySellQty: number | null;
}

/** 엔진 종합 판정 — D의 계기판이 이 타입만 소비한다. */
export interface RiskResult {
  shortfall: number;
  marginRatioPct: number;
  liquidation: LiquidationResult | null;
  paths: ResolutionPaths | null;
  /** 균등충격 한계선 λ* — 전 종목이 함께 몇 % 빠지면 관통하는가 */
  equalShockLambda: number;
  /** 계산에 사용된 카드의 상태 — draft면 UI는 참고 모드 배너 필수 */
  cardStatus: "verified" | "draft";
}

/* ── A(엔진) → D(UI) : replay 경로 시뮬 (신규 — 기존 3계약 무변경) ── */

/** 일간 수익률 — 정수 bp(−491 = −4.91%). 부동소수 곱 대신 (10000+bp)/10000 정수 스케일로 쓴다. */
export interface DailyReturn {
  /** ISO 날짜 (예: "2026-07-28") */
  date: string;
  bp: number;
}

/**
 * replay 하루 스텝 — D의 계기판·랜딩 "7월 연쇄"가 소비한다.
 * 필드명·구성은 렌더 편의에 맞춰 조정 가능(PR 코멘트로).
 */
export interface ReplayStep {
  date: string;
  /** 이 스텝의 일간 수익률, 정수 bp */
  dailyReturn: number;
  /** 이 스텝 종가(수익률 적용 후, 원 단위 내림) — 다음 스텝의 '전일종가' 기준이 된다 */
  pricePrev: number;
  /** 종가 평가액 = 보유수량×종가 + 현금성 담보 (집행 반영 후) */
  V: number;
  /** 융자 잔액 (집행 반영 후) */
  L: number;
  /** 담보비율 원시값(%) — 라운딩 없음. 관통 판정은 이 값이 아니라 shortfall 정수 계산으로 한다. L=0이면 null */
  ratioRaw: number | null;
  /** 담보부족액 D (없으면 0) */
  shortfall: number;
  /** normal = 평상(관통 발견일 포함 — 통지는 익일) | notified = 통지 상태(D+1) | executed = 집행일(D+2) */
  phase: "normal" | "notified" | "executed";
  /** 집행 수량 (집행 없으면 0) */
  executedQty: number;
  executedReason: "PARTIAL" | "K_NON_POSITIVE" | "QTY_EXCEEDED" | null;
  /** 체결가 — 기본 가정: 집행일 가격. 수량 산정에는 미관여(세 가격 분리). 집행 없으면 null */
  fillPrice: number | null;
  /** 집행 반영 후 보유 수량 */
  heldAfter: number;
  /** 집행 반영 후 원장 */
  ledgerAfter: CreditLedger;
}
