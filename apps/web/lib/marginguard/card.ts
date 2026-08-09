/**
 * 조건카드 읽기 — 산정 기준가 할인율 h (D)
 * ---------------------------------------------------------------------------
 * 산식이 아니다. 카드의 어느 필드를 h로 읽을지에 대한 **규약**이며,
 * 엔진 replay(packages/engine/src/replay.ts:33~44)와 같은 규약을 따라야 한다.
 *
 * 규약이 두 곳(엔진·웹)에 중복돼 있다. 엔진이 disposalDiscountRate(card)를
 * export하면 이 파일은 그것을 재export하는 한 줄로 줄어든다 — PR #10 리뷰에서
 * A가 후속 PR로 올리기로 했다.
 */
import type { ConditionCard } from "@marginguard/engine";

/**
 * 카드에서 h를 읽는다. lower_limit는 하한가(−30%) 등가로 처리한다.
 *
 * **불완전한 카드에 0을 폴백하지 않는다.** h=0이면 k = r(1−0) − 1 = 0.4로 커져
 * 처분 수량이 실제보다 **작게** 나온다 — 안전 여유를 과대 표시하는 낙관 방향
 * 오류이고, 위험 진단 도구에서 가장 나쁜 방향이다.
 *
 * 엔진 replay는 같은 입력에서 throw한다. 화면은 죽어선 안 되므로 여기서는
 * null을 돌려 호출부가 '산정 불가'로 표시하게 한다.
 *
 * 지금 스냅숏 프리셋 3종은 모두 값이 있어 이 경로에 도달하지 않는다. 다만
 * B의 인제스트가 약관에서 카드를 뽑기 시작하면 불완전 카드는 실제로 들어온다
 * (source_confidence가 explicit이 아닌 케이스).
 */
export function cardH(card: ConditionCard): number | null {
  const rule = card.disposal_price_rules[0];
  if (!rule) return null;
  if (rule.discount_basis === "lower_limit") return 0.3;
  return rule.discount_rate ?? null;
}
