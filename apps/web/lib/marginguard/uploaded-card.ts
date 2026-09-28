import type { ConditionCard } from "@marginguard/engine";
import type { CardPreset } from "./snapshot";

/**
 * 업로드로 받은 조건카드를 화면이 쓰는 프리셋으로 좁힌다.
 * ---------------------------------------------------------------------------
 * 인제스트가 이미 JSON Schema + Pydantic 을 통과시킨 것을 준다. 그런데도 여기서 다시
 * 보는 이유는 **신뢰가 아니라 화면 때문**이다 — 응답이 예상과 다르면 페이지가 죽거나,
 * 더 나쁘게는 빈 값을 그럴듯하게 그린다. 브라우저가 받는 것은 어차피 네트워크 너머의
 * JSON 이고, 그 사실을 무시하지 않는다.
 *
 * ⚠ **라벨이 검수를 주장하면 안 된다.** 인제스트 출력의 `status` 는 무조건 `draft`
 *   이고(docs/team-handbook.md §5-B), 화면은 그걸 참고 모드 배너로 말한다. 여기서 `source` 에
 *   *"교차검증"* 같은 문구를 붙이면 그 배너와 같은 화면에서 두 말을 하게 된다.
 *   스냅숏 프리셋의 `source` 문구를 흉내 내지 마라 — 그것들은 사람이 대조한 것이다.
 */

export type UploadedCardResult =
  | { ok: true; preset: CardPreset }
  | { ok: false; reason: string };

/** 화면이 실제로 읽는 필드만 본다. 스키마 전체를 다시 검증하지 않는다 — 그건 인제스트 몫이다. */
function looksLikeCard(value: unknown): value is ConditionCard {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Partial<ConditionCard>;
  return (
    typeof card.broker === "string" &&
    Array.isArray(card.ratio_rules) &&
    Array.isArray(card.disposal_price_rules) &&
    (card.status === "draft" || card.status === "verified")
  );
}

/** 파일명을 라벨에 쓰기 전에 다듬는다 — 화면에 그대로 나가는 사용자 입력이다. */
export function displayFilename(name: string, max = 28): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "업로드 문서";
  return base.length <= max ? base : `${base.slice(0, max - 1)}…`;
}

export function toUploadedPreset(payload: unknown, filename: string): UploadedCardResult {
  if (!looksLikeCard(payload)) {
    return { ok: false, reason: "조건카드 형식이 아닙니다" };
  }

  /**
   * ⚠ **`verified` 로 온 것도 draft 로 낮춘다.**
   *
   * 인제스트는 무조건 draft 를 내지만, 이 화면이 그 약속에 기대면 약속이 깨지는 날
   * 조용히 틀린다. 업로드된 카드는 **정의상 사람이 대조하기 전**이므로 여기서
   * 낮추는 것이 사실이다. 낮추는 방향이라 안전하고, 되돌리려면 사람이 검수 경로를
   * 만들어야 한다 — 그게 맞는 순서다.
   */
  const card: ConditionCard = { ...payload, status: "draft" };

  const label = displayFilename(filename);
  return {
    ok: true,
    preset: {
      key: UPLOADED_KEY,
      broker: card.broker,
      label: `${label} (업로드)`,
      // h 라벨은 화면이 disposalDiscountRate 로 따로 읽는다. 여기서 숫자를 만들지 않는다 —
      // 만들면 카드와 라벨이 갈라질 수 있는 자리가 하나 더 생긴다.
      hLabel: "방금 추출",
      source: `업로드 문서 · 검수 전(draft) — 사람이 원문과 대조하지 않았습니다`,
      card,
    },
  };
}

export const UPLOADED_KEY = "uploaded";
