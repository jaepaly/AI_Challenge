/**
 * 신선도 게이트 — verified_at 기준 만 30일 경과 시 계산 차단(참고 모드 강등).
 * ---------------------------------------------------------------------------
 * 기준일은 수집일이 아니라 검증일이다 — 수집일 기준이면 심사 주간(9/7~9/11)에
 * 우리 스스로를 차단한다(7월 말 수집 → 40일+).
 * 낙관 오차 0% 원칙: verified_at 부재(모름)는 보수적으로 참고 모드 강등.
 * 단, 입력 자체가 깨진 경우(파싱 불가·미래 verified_at)는 조용히 강등하지 않고
 * TypeError를 던진다 — 오염 데이터를 삼키면 "차단했다"는 착시가 생긴다.
 * asOf는 반드시 인자로 받는다 — Date.now() 금지(결정론).
 * verified_at은 ISO 날짜(YYYY-MM-DD) 표기를 강제한다 — V8 레거시 파서가
 * "심사필-2026" 같은 문자열에서 연도만 뽑아 파싱해버리는 함정을 입구에서 차단.
 */
import type { ConditionCard } from "./types";

/** 신선 판정 허용 한도(만 일수) — 30일까지 계산 허용, 31일째부터 차단 */
const MAX_FRESH_AGE_DAYS = 30;

/** verified_at 표기 강제 — ISO 날짜(YYYY-MM-DD)만. 시간 성분·자유 서식 거부 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 86_400_000;

export type FreshnessReason = "FRESH" | "STALE" | "DRAFT" | "NO_VERIFIED_AT";

export interface FreshnessVerdict {
  /** true = 계산 모드 허용 */
  calculable: boolean;
  /** calculated = 계산 사용 | reference = 참고 모드 강등 (UI 배너 필수) */
  mode: "calculated" | "reference";
  reason: FreshnessReason;
  /** verified_at→asOf 만 일수: floor(밀리초 차 / 86,400,000). 산출 불가면 null */
  ageDays: number | null;
}

/** string | Date → epoch ms. 파싱 불가면 NaN. */
function toMs(value: string | Date): number {
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

/** 만 일수 = floor(밀리초 차 / 86,400,000). 같은 날 타임존 스큐(−1 < 차이 < 0)는 0으로 클램프. */
function ageDaysOf(verifiedMs: number, asOfMs: number): number {
  const diffMs = asOfMs - verifiedMs;
  if (diffMs < 0 && diffMs > -MS_PER_DAY) return 0;
  return Math.floor(diffMs / MS_PER_DAY);
}

/**
 * 카드 신선도 판정 — 계산 모드 허용 여부를 결정한다.
 * 우선순위: asOf 오류 throw → verified_at 비ISO 표기 throw → draft 강등 →
 *           verified_at 부재 강등 → verified_at 파싱 오류 throw → 만 일수로 FRESH/STALE.
 */
export function assessCardFreshness(card: ConditionCard, asOf: string | Date): FreshnessVerdict {
  const asOfMs = toMs(asOf);
  if (Number.isNaN(asOfMs)) {
    throw new TypeError(`asOf 파싱 불가: ${String(asOf)}`);
  }

  // 입구 검증 — verified_at이 있으면 상태 불문 ISO 날짜 표기여야 한다
  if (card.verified_at !== undefined && !ISO_DATE_RE.test(card.verified_at)) {
    throw new TypeError(`verified_at은 ISO 날짜(YYYY-MM-DD)여야 한다: ${card.verified_at}`);
  }

  // draft는 원래 참고 모드 전용 — 신선도와 무관하게 강등
  if (card.status === "draft") {
    const verifiedMs = card.verified_at === undefined ? NaN : toMs(card.verified_at);
    return {
      calculable: false,
      mode: "reference",
      reason: "DRAFT",
      ageDays: Number.isNaN(verifiedMs) ? null : ageDaysOf(verifiedMs, asOfMs),
    };
  }

  // verified인데 검증일을 모름 → 보수적으로 차단
  if (card.verified_at === undefined) {
    return { calculable: false, mode: "reference", reason: "NO_VERIFIED_AT", ageDays: null };
  }

  const verifiedMs = toMs(card.verified_at);
  if (Number.isNaN(verifiedMs)) {
    throw new TypeError(`verified_at 파싱 불가: ${card.verified_at}`);
  }

  const ageDays = ageDaysOf(verifiedMs, asOfMs);
  // verified_at이 asOf보다 하루 넘게 미래 = 데이터 오염
  if (ageDays <= -1) {
    throw new TypeError(
      `verified_at(${card.verified_at})이 asOf보다 미래 — 데이터 오염 (ageDays=${ageDays})`,
    );
  }

  if (ageDays > MAX_FRESH_AGE_DAYS) {
    return { calculable: false, mode: "reference", reason: "STALE", ageDays };
  }
  return { calculable: true, mode: "calculated", reason: "FRESH", ageDays };
}
