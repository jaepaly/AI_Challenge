/**
 * 신선도 게이트 — 화면 규약 (D)
 * ---------------------------------------------------------------------------
 * 엔진의 assessCardFreshness가 판정하고, 이 파일은 그 판정을 **화면이 어떻게
 * 존중하는지**만 정한다. 판정 로직은 여기 없다.
 *
 * `asOf`를 어디서 가져오는가 — 열람 시각(클라이언트)이다. 빌드 시각으로 하면
 * 우리가 막으려는 실패를 못 잡는다: 9/6에 카드 재검증을 잊고 배포하면 배포일
 * 기준 28일이라 FRESH이고, 9/9이 되어도 배포본은 계속 28일이라고 믿는다.
 * 열람 시각이면 9/9에 열 때 31일 → STALE로 잡힌다.
 *
 * ⚠ 클라이언트 시계는 사용자가 바꿀 수 있다. 이것은 보안 경계가 아니다 —
 *   시계를 조작한 사람만 잘못된 화면을 본다. 서버 권위가 필요한 값이 아니다.
 */
import { assessCardFreshness, type FreshnessVerdict } from "@marginguard/engine";
import type { ConditionCard } from "@marginguard/engine";

/** YYYY-MM-DD — 엔진이 verified_at에 요구하는 것과 같은 표기 */
export function todayISO(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface FreshnessView {
  verdict: FreshnessVerdict;
  /** 배너에 그대로 찍는 문장. calculable이면 null */
  banner: string | null;
  /** 처분 수량·배수를 낼 수 있는가 */
  quantitative: boolean;
}

/**
 * `calculable: false`를 화면이 어떻게 처리하는가 — **cardH === null과 같은 규약.**
 *
 * 담보부족액과 담보비율은 **유지비율만으로 정해진다.** 카드의 신선도와 무관하게
 * 확정값이다. 처분 수량과 배수만 카드 파라미터(h)에 달려 있다.
 * 그래서 신선하지 않은 카드에서는 **수량을 내지 않고 부족액은 그대로 보여준다.**
 *
 * 숫자를 전부 감추지 않는 이유: 부족액은 맞는 값이고, 감추면 사용자가 "얼마나
 * 부족한지"조차 모르게 된다. 반대로 수량을 보여주면 검증 안 된 파라미터로 만든
 * 값을 정식 산출처럼 내놓는 것이 된다.
 */
export function freshnessView(card: ConditionCard, asOf: string): FreshnessView {
  const verdict = assessCardFreshness(card, asOf);
  if (verdict.calculable) return { verdict, banner: null, quantitative: true };

  const age = verdict.ageDays;
  const banner =
    verdict.reason === "DRAFT"
      ? "⚠ 참고 모드 — 검수 전(draft) 조건카드. 정식 한계선 산출에 사용하지 않습니다"
      : verdict.reason === "STALE"
        ? `⚠ 참고 모드 — 검증일로부터 ${age}일 경과(허용 30일). 카드를 재검증해야 정식 산출로 돌아옵니다`
        : "⚠ 참고 모드 — 이 카드에 검증일(verified_at)이 없습니다. 모르는 것을 신선하다고 보지 않습니다";

  return { verdict, banner, quantitative: false };
}
