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

interface EvidenceSpanBase {
  quote: string;
}

/** PDF 원본 citations의 1-indexed 페이지 좌표. */
export interface PageEvidenceSpan extends EvidenceSpanBase {
  source_format: "pdf";
  page: number;
  end_page?: number;
}

/** 평탄화된 text/html citations의 문자 오프셋 좌표. */
export interface CharacterEvidenceSpan extends EvidenceSpanBase {
  source_format: "text" | "html";
  char_start: number;
  char_end: number;
  /** 문자 오프셋이 가리키는 평탄화 결과물의 SHA-256 (소문자 64자리 hex). */
  flattened_sha256: string;
}

/** 근거 좌표 — 페이지형 또는 문자형 중 정확히 하나. */
export type EvidenceSpan = PageEvidenceSpan | CharacterEvidenceSpan;

export type SourceConfidence = "explicit" | "inferred_from_formula";

/** 담보유지비율 룰 — r은 스칼라가 아니라 상품유형×담보유형×종목군 룰 테이블이다(105~170% 편차 실측). */
export interface RatioRule {
  product_type: string;
  collateral_type: string;
  symbol_group: string;
  /** 1.05 ~ 1.70 */
  ratio: number;
  evidence: EvidenceSpan;
  /** 서버가 판정한 근거 문장 내 상품 명시 여부. 기존 수동 카드는 생략할 수 있다. */
  evidence_product_binding?: "explicit" | "unspecified";
}

export interface DisposalPriceRule {
  trigger: string;
  symbol_group: string;
  /** prev_close_pct = 전일종가 −h% | lower_limit = 하한가 기준 */
  discount_basis: "prev_close_pct" | "lower_limit";
  /** discount_basis가 prev_close_pct일 때의 h (0.15 = −15%) */
  discount_rate?: number;
  source_confidence: SourceConfidence;
  evidence: EvidenceSpan;
}

export interface ExecutionScheduleRule {
  /** 발동 임계 담보비율 (예: 1.4 부족판정 / 1.2~1.3 2단 임계) */
  threshold_ratio: number;
  /** 예: "D일 15:40 평가 → D+2 미해소 시 D+3 개장 집행" */
  day_counting: string;
  evidence: EvidenceSpan;
}

/**
 * 문서 버전 식별자 — **둘 중 하나는 반드시 있어야 한다.**
 *
 * 심사필 번호가 있는 회사는 그것이 정본 식별자이고, 없는 회사(미래에셋·유진
 * 확인됨)는 원문 바이트의 sha256이 그 역할을 한다. 둘 다 없으면 "어느 판본을
 * 읽고 만든 카드인가"에 답할 수 없어 개정 diff도 신선도 판정도 근거를 잃는다.
 *
 * 판별 유니온으로 쓴 것은 JSON Schema의 `anyOf: [required review_no,
 * required content_sha256]`·Pydantic `require_document_identifier`와 같은
 * 규약을 타입에서도 강제하기 위해서다. 이전에는 세 필드가 전부 선택이라
 * `doc_version: {}`이 타입체크를 통과하면서 스키마를 위반했다.
 */
export type DocVersion =
  | { review_no: string; content_sha256?: string; revised_at?: string }
  | { review_no?: string; content_sha256: string; revised_at?: string };

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
  /** 자발적 매도 수량 = ceil(D / (r·P_m·(1−f) − P_prev)). 매도로 해소 불가하면 null */
  voluntarySellQty: number | null;
  /**
   * voluntarySellQty가 null인 사유. 값이 있으면 이 필드는 없다.
   *  DENOM_NON_POSITIVE = 매도해도 비율이 안 오름(분모≤0)
   *  QTY_EXCEEDED       = 필요 수량 > 보유 — 전량을 팔아도 해소되지 않는다
   */
  voluntarySellReason?: "DENOM_NON_POSITIVE" | "QTY_EXCEEDED";
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
  /**
   * liquidation이 null인 사유. 값이 있으면 이 필드는 없다
   * (ResolutionPaths.voluntarySellReason과 같은 규약 — 화면이 판정을 재현하지 않는다).
   *  RATIO_NOT_CONFIRMED = 카드의 유지비율과 원장의 유지비율을 하나로 맞추지 못했다
   *  NO_SHORTFALL        = 관통하지 않음 — 산정할 것이 없다
   *  CARD_NOT_FRESH      = STALE·NO_VERIFIED_AT — 재검증 전에는 정식 산출을 내지 않는다
   *  NO_DISCOUNT_RATE    = 카드에 산정 기준가 규칙(h)이 없다
   * 우선순위: RATIO_NOT_CONFIRMED > NO_SHORTFALL > CARD_NOT_FRESH > NO_DISCOUNT_RATE
   * (신선하지 않고 h도 없으면 재검증이 선행 조치라 CARD_NOT_FRESH를 먼저 말한다)
   *
   * ── RATIO_NOT_CONFIRMED를 맨 앞에 둔 이유 ─────────────────────────────
   * 이 사유만 **다른 사유의 전제를 무너뜨린다.** NO_SHORTFALL은 "원장 r로 재면
   * 관통하지 않는다"는 말인데, r을 하나로 맞추지 못한 상태에서는 그 말 자체가
   * 미정이다. 실측(원장 1.2 · 카드 1.4 · 융자 600만 · 1,000주):
   *     전일종가 7,300 → 원장 기준 D=0 → NO_SHORTFALL, 카드 기준이면 D=1,100,000
   *     전일종가 8,000 → 원장 기준 D=0 → NO_SHORTFALL, 카드 기준이면 D=  400,000
   * NO_SHORTFALL이 먼저 나가면 화면은 "여유가 있다"고 말하고 어긋남의 흔적이
   * 사유코드에서 통째로 사라진다. 앞에 두는 비용은 0이다 — 두 경우 모두
   * liquidation은 이미 null이라 가려지는 산출값이 없다.
   * CARD_NOT_FRESH가 뒤로 밀려도 정보는 사라지지 않는다: 화면의 재검증 배너는
   * 사유코드와 무관하게 신선도 판정에서 따로 뜬다(apps/web freshness-view).
   *
   * ── 이 게이트가 보증하는 것 / 보증하지 않는 것 ─────────────────────────
   * 보증: **처분 수량**을 카드 r과 원장 r이 갈린 채로 내지 않는다. 실측 편차가
   *   195주 ↔ 583주(카드 1.7 / 원장 1.4)라 이 하나만 확실히 틀린다.
   * 보증 안 함 —
   *   ① **어느 r이 옳은가.** 카드 r은 문서 근거를 통과한 값이고 원장 r은 리터럴이다.
   *      엔진은 둘 중 하나를 고르지 않는다. 말할 수 있는 것은 "같지 않다"까지다.
   *   ② **둘이 같이 틀린 경우.** 검사하는 것은 "두 값이 같은가"이지 "그 값이 맞는가"가
   *      아니다. 메리츠 C∙D군 150% 과소평가(apps/web snapshot.ts 주석)가 그 사례다.
   *      ⚠ 그래서 통과를 "검증됨/확인됨" 배지로 내면 안 된다 — 거짓 안심이다.
   *   ③ **부족액·담보비율·λ*·해소 4경로.** 어긋나도 그대로 낸다. 원장 r만으로
   *      정해지는 값들이고, 원장이 맞다면 여전히 참이다(#33 "셋을 접지 않는다").
   *   ④ **대주(product_type).** CreditLedger에 상품유형 필드가 없어 단일 대주 카드
   *      1.2 + 원장 1.2는 통과하고, 엔진은 융자 산식 D=max(0,r·L−V)로 계산한다.
   *      '융자가 아니면 거부'는 별도 항목이다.
   *   ⑤ **execution_schedule[].threshold_ratio.** 이 대조의 범위 밖이다 — 넣으면
   *      2단 임계(위 threshold_ratio 주석이 정상으로 계약한 것)를 위반으로 판정하고,
   *      합집합이 원장 값을 삼켜 진짜 어긋남을 가린다(카드 1.7/thr 1.2/원장 1.2).
   *   ⑥ **소수 셋째 자리.** 비교 격자가 centi(Math.round(r*100))라 카드 1.404와
   *      원장 1.400은 통과한다. shortfall·kMicro·equalShockLambda가 쓰는 그 격자와
   *      같으므로 수량은 증명 가능하게 동일하지만, 근거 배지 문자열은 보호하지 않는다.
   *   ⑦ **replay·replayPortfolio.** 아직 이 게이트가 걸리지 않는다.
   */
  liquidationSkipped?:
    | "RATIO_NOT_CONFIRMED"
    | "NO_SHORTFALL"
    | "CARD_NOT_FRESH"
    | "NO_DISCOUNT_RATE";
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

/* ── A(엔진) → D(UI) : 다종목 경로 시뮬 (신규 — 기존 계약 무변경) ── */

/**
 * 하루치 종목별 수익률. 키는 Position.symbol이고 **전 종목이 있어야 한다.**
 * 누락을 0bp로 봐주지 않는 이유: 거래정지일은 실제로 0bp 스텝으로 들어와야 하는데
 * (거래일이므로 D+2 시계가 계속 간다), 누락과 0을 같게 처리하면 둘을 구분할 수 없다.
 * 반면 휴장일은 거래일이 아니므로 애초에 스텝이 없는 게 맞다.
 */
export interface DailyPortfolioReturn {
  date: string;
  bySymbol: Record<string, number>;
}

/** 다종목 스텝의 종목별 상태 */
export interface PortfolioPositionStep {
  symbol: string;
  /** 이 스텝 종가(수익률 적용 후, 원 단위 내림) */
  pricePrev: number;
  /** 이 종목의 일간 수익률, 정수 bp */
  dailyReturn: number;
  /** 이 스텝에서 처분된 수량 */
  executedQty: number;
  /** 집행 반영 후 보유 */
  heldAfter: number;
  /**
   * 이 종목 단독 하락 한계선 λ_k — "이 종목 혼자 몇 % 더 빠지면 관통하는가".
   * ※ 가정적 지표다. 이 경로는 종목별로 다른 충격을 이미 적용하고 있으므로,
   *   λ_k는 "다른 종목이 그대로일 때"라는 반사실 가정 위에서만 읽어야 한다.
   */
  /**
   * ⚠ 보유 0(전량 처분됨)이면 **null**이다. "이 종목 혼자 하락한다"는 가정 자체가
   *   성립하지 않으므로 수치를 주지 않는다. 캡할 큰 값이 아니라 부재다 —
   *   0으로 나눠 Infinity가 새면 화면에 그대로 찍힌다(ReplayStep.ratioRaw가 L=0에서
   *   null인 것과 같은 규약).
   */
  singleAssetLambda: number | null;
}

/** 다종목 경로 시뮬의 하루 스텝. 단일 종목 뷰는 ReplayStep(replay)이 따로 있다. */
export interface PortfolioReplayStep {
  date: string;
  /** 주식 평가액 합계 기준 등락률(정수 bp, 사사오입) — 표시용 파생값. 재생 입력이 아니다 */
  portfolioReturn: number;
  /** 종가 평가액 = Σ(보유×종가) + 현금성 담보 (집행 반영 후) */
  V: number;
  L: number;
  /** 담보비율 원시값(%) — 라운딩 없음. L=0이면 null */
  ratioRaw: number | null;
  shortfall: number;
  phase: "normal" | "notified" | "executed";
  /** 이 스텝 집행 총 수량 (종목별은 positions[]) */
  executedQtyTotal: number;
  executedReason: "PARTIAL" | "K_NON_POSITIVE" | "QTY_EXCEEDED" | null;
  /** 종목번호 오름차순 — 처분 순서와 같다 */
  positions: PortfolioPositionStep[];
  ledgerAfter: CreditLedger;
}
