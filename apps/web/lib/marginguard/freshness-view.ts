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

/**
 * 화면 모드 3단.
 *
 * 엔진 verdict의 `calculable: false`를 **한 덩어리로 취급하면 안 된다**(PR #30 리뷰).
 * 엔진이 `reason`을 따로 주는 이유가 여기 있다 — DRAFT와 STALE은 성질이 다르다.
 *
 *  - `calculated` FRESH. 정식 산출
 *  - `reference`  DRAFT. **값을 보여주고 배너를 붙인다.** 처음부터 정식인 적 없는
 *                 값이므로 라벨로 충분하다. 근거 셋:
 *                 ① types.ts:143 — "draft면 UI는 참고 모드 배너 필수". 그것도
 *                    RiskResult.cardStatus에 붙어 있다. draft가 값을 못 낸다면
 *                    엔진 출력 타입이 그 필드를 가질 이유가 없다
 *                 ② 인제스트 출력의 status는 **무조건 draft**다(README §5-B).
 *                    draft에서 수량을 막으면 라이브 인제스트 데모의 출력 화면이
 *                    "산정 불가"가 된다 — "AI가 어디 있나"에 답하는 그 화면이다
 *                 ③ 참고(參考)는 보여줘야 참고가 된다
 *  - `blocked`   STALE · NO_VERIFIED_AT. **수량·배수를 내지 않는다.** 한때 정식이었다가
 *                 무효가 된 값이라, 보여주면 낡은 정식값으로 읽힌다. README 5-A가
 *                 30일 경과에만 "계산 차단"을 명시한 것이 이 구분이다
 */
export type FreshnessMode = "calculated" | "reference" | "blocked";

export interface FreshnessView {
  verdict: FreshnessVerdict;
  mode: FreshnessMode;
  /** 배너에 그대로 찍는 문장. calculated면 null */
  banner: string | null;
}

/**
 * 담보부족액·담보비율은 **어느 모드에서도 표시한다.** 유지비율만으로 정해지므로
 * 카드와 무관한 확정값이다. 카드에서 오는 파라미터는 h뿐이고, h 유래 값(처분 수량·
 * 배수)만 blocked에서 내리지 않는다.
 */
export function freshnessView(card: ConditionCard, asOf: string): FreshnessView {
  const verdict = assessCardFreshness(card, asOf);

  if (verdict.calculable) return { verdict, mode: "calculated", banner: null };

  if (verdict.reason === "DRAFT") {
    return {
      verdict,
      mode: "reference",
      banner: "⚠ 참고 모드 — 검수 전(draft) 조건카드. 정식 한계선 산출에 사용하지 않습니다",
    };
  }

  const banner =
    verdict.reason === "STALE"
      ? `⚠ 참고 모드 — 검증일로부터 ${verdict.ageDays}일 경과(허용 30일). 카드를 재검증해야 정식 산출로 돌아옵니다`
      : "⚠ 참고 모드 — 이 카드에 검증일(verified_at)이 없습니다. 모르는 것을 신선하다고 보지 않습니다";

  return { verdict, mode: "blocked", banner };
}
