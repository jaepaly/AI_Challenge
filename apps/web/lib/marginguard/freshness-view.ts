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
import {
  assessCardFreshness,
  MAX_FRESH_AGE_DAYS,
  type FreshnessVerdict,
} from "@marginguard/engine";
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
 *                 ② 인제스트 출력의 status는 **무조건 draft**다(docs/team-handbook.md §5-B).
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
      /**
       * ⚠ 이 문장은 **화면이 실제로 하는 일과 맞아야 한다.**
       *
       * 원래 "정식 한계선 산출에 **사용하지 않습니다**"였다. 거짓이었다 —
       * `quantOk`가 `mode !== "blocked"`라 draft는 통과하고, 하한가형 카드의
       * `discount_basis: "lower_limit"` → h=0.3이 처분 수량 전량 1,000주를 만들어
       * 같은 화면에 찍는다. **쓰지 않는다고 적으면서 그 카드로 계산하고 있었다.**
       * (팀원 외부 점검에서 발견)
       *
       * 바로 위 ②가 그 근거를 스스로 적어 뒀다 — "draft에서 수량을 막으면 라이브
       * 인제스트 데모의 출력 화면이 '산정 불가'가 된다". 값을 내는 것은 #30에서
       * 팀이 검토해 정한 동작이고, 틀린 것은 동작이 아니라 **문장**이었다.
       *
       * 그래서 문구는 "안 쓴다"가 아니라 **"이 카드로 냈고, 아직 사람이 대조하지
       * 않았다"**를 말한다. 근거 없는 안심을 주지 않는 것이 이 제품의 규율이고,
       * 근거 없는 면책도 같은 종류다.
       */
      banner:
        "⚠ 참고 모드 — 검수 전(draft) 조건카드. 아래 수치는 이 카드로 산출했습니다. " +
        "사람이 원문과 대조하기 전이므로 정식 판단의 근거로 쓰지 마세요",
    };
  }

  const banner =
    verdict.reason === "STALE"
      ? `⚠ 참고 모드 — 검증일로부터 ${verdict.ageDays}일 경과(허용 ${MAX_FRESH_AGE_DAYS}일). 카드를 재검증해야 정식 산출로 돌아옵니다`
      : "⚠ 참고 모드 — 이 카드에 검증일(verified_at)이 없습니다. 모르는 것을 신선하다고 보지 않습니다";

  return { verdict, mode: "blocked", banner };
}
