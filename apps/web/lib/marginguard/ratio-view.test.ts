/**
 * 유지비율 대조 — 화면 규약
 * ---------------------------------------------------------------------------
 * 판정 자체(어느 룰로 좁히는가)는 엔진 test/ratio-agreement.test.ts가 소유한다.
 * 여기가 소유하는 것은 **화면이 그 판정으로 무슨 말을 하는가**다.
 *
 * 이 파일이 지키는 상한: 화면은 "둘이 같지 않다"까지만 말한다.
 *  - "카드가 틀렸다"고도 "원장이 틀렸다"고도 말하지 않는다 — 어느 쪽이 맞는지 모른다.
 *  - 일치에 "확인됨/검증됨" 배지를 만들지 않는다 — 검사한 것은 "두 값이 같은가"이지
 *    "그 값이 맞는가"가 아니다. 둘이 같이 틀린 경우는 잡지 못한다.
 *
 * ⚠ 프리셋 3장은 makeCard 팩토리 안의 리터럴 1.4를 공유해 **구조적으로 어긋날 수 없다.**
 *   그래서 어긋난 카드는 여기서 손으로 조립한다 — 프리셋만 돌리면 이 게이트가 켜지는
 *   경로가 테스트에 한 번도 나타나지 않는다.
 */
import { describe, expect, it } from "vitest";
import type { ConditionCard, RatioRule } from "@marginguard/engine";
import { CARDS, positions } from "./snapshot";
import { ratioView } from "./ratio-view";

const hantoo = CARDS.find((c) => c.key === "hantoo")!.card;
const pos = positions(8_100)[0]!; // group: "일반"

/** 프리셋 카드의 유지비율 조항만 갈아 끼운다 — 근거 좌표는 그대로 둔다 */
function withRatios(rules: Partial<RatioRule>[]): ConditionCard {
  const base = hantoo.ratio_rules[0]!;
  return { ...hantoo, ratio_rules: rules.map((r) => ({ ...base, ...r })) as RatioRule[] };
}

/** 화면이 절대 하면 안 되는 판정 어투 — 모든 문장에 걸어 둔다 */
const VERDICT_WORDS = [
  "카드가 틀",
  "원장이 틀",
  "잘못된",
  "오류",
  "버그",
  "확인됨",
  "검증됨",
  "대조됨",
];
function allText(v: ReturnType<typeof ratioView>): string {
  return [v.banner, v.blockReason, v.evidenceNote, v.detail].filter((s) => s !== null).join("\n");
}

/**
 * 실계좌를 가정한 원장 r. **`ledger()` 에서 읽지 않는다** — (다) 채택 이후 합성
 * 원장은 카드에서 파생되므로, 그걸 대조 상대로 쓰면 카드를 자기 자신과 맞대 보게
 * 되어 이 검사가 항상 통과한다(#67 A-1). `ratioView` 자체를 재려면 **독립적인**
 * 제2 의견이 있어야 하고, 여기서는 그것을 상수로 세운다.
 */
const LEDGER_R = 1.4;

describe("일치 — 아무 말도 하지 않는다", () => {
  it("프리셋 3장 전부 통과하고 문구가 하나도 생기지 않는다 (긍정 배지 금지)", () => {
    for (const preset of CARDS) {
      const v = ratioView(preset.card, LEDGER_R, pos);
      expect(v.confirmed).toBe(true);
      expect(v.banner).toBeNull();
      expect(v.blockReason).toBeNull();
      expect(v.evidenceNote).toBeNull();
      expect(v.detail).toBeNull();
    }
  });

  it("같은 값이 두 줄이어도 통과한다 — 길이가 아니라 값의 갈림으로 본다", () => {
    const v = ratioView(
      withRatios([{ ratio: 1.4, symbol_group: "일반" }, { ratio: 1.4, symbol_group: "관리" }]),
      1.4,
      pos,
    );
    expect(v.confirmed).toBe(true);
    expect(v.banner).toBeNull();
  });
});

describe("어긋남 — 두 숫자를 나란히 놓는 데까지만 말한다", () => {
  const v = ratioView(withRatios([{ ratio: 1.7 }]), LEDGER_R, pos);

  it("차단하고, 네 문장이 모두 생긴다", () => {
    expect(v.confirmed).toBe(false);
    expect(v.agreement.why).toBe("COMPARED");
    expect(v.banner).not.toBeNull();
    expect(v.blockReason).not.toBeNull();
    expect(v.evidenceNote).not.toBeNull();
    expect(v.detail).not.toBeNull();
  });

  it("모든 문장이 **두 숫자를 다 보여준다** — 하나만 적으면 사용자가 눈으로 못 맞춘다", () => {
    for (const line of [v.banner, v.blockReason, v.evidenceNote, v.detail]) {
      expect(line).toContain("170%"); // 카드
      expect(line).toContain("140%"); // 원장
    }
  });

  it("어느 쪽이 틀렸다고 말하지 않는다", () => {
    const text = allText(v);
    for (const word of VERDICT_WORDS) expect(text).not.toContain(word);
    // 판정하지 않는다는 것을 명시적으로 말한다 — 침묵이 아니라 진술이다
    expect(v.banner).toContain("화면이 판정하지 않습니다");
    expect(v.evidenceNote).toContain("화면이 판정하지 않습니다");
  });

  it("근거 패널 문장은 **부족액이 어느 값으로 나왔는지**를 밝힌다", () => {
    // 이 문장이 없으면 사용자는 근거 좌표가 붙은 170%가 부족액을 만든 값이라고 읽는다
    expect(v.evidenceNote).toContain("조건카드의 유지비율 170%로 산출했습니다");
    expect(v.evidenceNote).toContain("계좌 원장은 같은 자리에 140%를 적고 있어 같지 않습니다");
  });

  it("차단 사유는 기존 두 사유와 같은 꼴이다 — 사실 — 하지 않는 것", () => {
    expect(v.blockReason).toContain(" — 처분 수량을 추정하지 않습니다");
  });

  it("설명 문단은 사용자가 할 다음 동작으로 끝난다", () => {
    expect(v.detail).toContain("다시 보세요.");
  });

  it("어긋남의 방향과 무관하다 — 카드가 낮아도 같은 규약", () => {
    const low = ratioView(withRatios([{ ratio: 1.2 }]), 1.4, pos);
    expect(low.confirmed).toBe(false);
    expect(low.banner).toContain("120%");
    expect(low.banner).toContain("140%");
    for (const word of VERDICT_WORDS) expect(allText(low)).not.toContain(word);
  });
});

describe("모호 — '다르다'가 아니라 '하나로 좁히지 못했다'", () => {
  // 후보 {140, 150}에 원장 140이면 140은 후보 안에 있다. "다르다"는 거짓말이다.
  const meritz = withRatios([
    { ratio: 1.4, symbol_group: "A∙B군" },
    { ratio: 1.5, symbol_group: "C∙D군" },
  ]);
  const v = ratioView(meritz, 1.4, pos); // pos.group="일반"은 이 문서에 없는 어휘

  it("차단하되 '다릅니다'라고 하지 않는다 — 원장 값도 후보 안에 있다", () => {
    expect(v.confirmed).toBe(false);
    expect(v.agreement.why).toBe("AMBIGUOUS");
    expect(v.banner).not.toContain("다릅니다");
    expect(v.blockReason).not.toContain("같지 않습니다");
  });

  it("후보를 전부 보여주고, 화면이 고르지 않는다고 말한다", () => {
    expect(v.banner).toContain("140%, 150%");
    expect(v.banner).toContain("화면이 그중 하나를 고르지 않습니다");
    expect(v.evidenceNote).toContain("140%, 150%");
  });

  it("종목군이 맞으면 좁혀져 통과한다 — 보수 차단이 영구가 아니다", () => {
    const ab = positions(8_100)[0]!;
    const v2 = ratioView(meritz, 1.4, { ...ab, group: "A∙B군" });
    expect(v2.confirmed).toBe(true);
    expect(v2.banner).toBeNull();
  });

  it("판정 어투가 없다", () => {
    for (const word of VERDICT_WORDS) expect(allText(v)).not.toContain(word);
  });
});

describe("맞춰 볼 값이 없는 카드", () => {
  it("ratio_rules가 비면 차단하고 그 사실을 적는다 — 통과로 읽지 않는다", () => {
    const v = ratioView({ ...hantoo, ratio_rules: [] }, 1.4, pos);
    expect(v.confirmed).toBe(false);
    expect(v.agreement.why).toBe("NO_RULE");
    expect(v.banner).toContain("담보유지비율 조항이 없습니다");
    expect(v.evidenceNote).toContain("계산의 기준값이 없어 임계가·담보부족액을 산출하지 않았습니다");
    for (const word of VERDICT_WORDS) expect(allText(v)).not.toContain(word);
  });

  it("숫자로 읽지 못한 값은 화면에 찍지 않는다 — 'NaN%'가 나가는 경로를 막는다", () => {
    const v = ratioView(withRatios([{ ratio: Number.NaN }]), 1.4, pos);
    expect(v.confirmed).toBe(false);
    expect(v.agreement.why).toBe("NON_FINITE");
    // 막는 것은 **읽지 못한 값**을 찍는 것이다. 카드 쪽이 NaN이어도 원장 140%는
    // 멀쩡히 읽힌 수이고, 화면에 떠 있는 임계가·부족액을 만든 값이 바로 그것이다.
    expect(allText(v)).not.toContain("NaN");
    expect(v.evidenceNote).not.toContain("유지비율 NaN");
  });

  /**
   * ⚠ **이 검사의 전제가 (다) 채택으로 바뀌었다**(#67 A-1).
   *
   * 전에는 화면이 원장 r 로 계산했으므로 카드를 못 읽어도 담보부족액이 남았고,
   * 그래서 *"그 큰 숫자가 기준 없이 서지 않게"* 원장 값을 밝혀야 했다.
   *
   * 이제는 **카드가 계산을 구동한다.** 카드를 못 읽으면 부족액도 임계가도 λ* 도
   * 아예 없다 — 기준을 밝힐 숫자가 없다. 그래서 문장이 말해야 하는 것은
   * *"무엇으로 산출했는가"* 가 아니라 **"산출하지 않았다, 원장으로 메우지도 않았다"**
   * 이다. 원장 값을 대신 쓰면 그 순간 (다)가 아니다.
   */
  it("카드를 못 읽으면 산출하지 않았다고 말한다 — 원장으로 메우지 않는다", () => {
    const v = ratioView(withRatios([{ ratio: Number.NaN }]), 1.4, pos);
    expect(v.evidenceNote).toContain("산출하지 않았습니다");
    expect(v.evidenceNote).toContain("대신 메우지 않습니다");
    expect(v.detail).toContain("산출하지 않았습니다");
    // 원장 값을 "이 값으로 산출했다"로 말하면 안 된다
    expect(v.evidenceNote).not.toMatch(/원장의 140%로 산출/);
    for (const word of VERDICT_WORDS) expect(allText(v)).not.toContain(word);
  });

  it("원장까지 못 읽었으면 숫자를 하나도 말하지 않는다", () => {
    const v = ratioView(withRatios([{ ratio: 1.4 }]), Number.NaN, pos);
    expect(v.agreement.why).toBe("NON_FINITE");
    expect(allText(v)).not.toContain("NaN");
    expect(allText(v)).not.toContain("%"); // 맞춰 볼 숫자가 양쪽 다 없다
  });
});

describe("범위 — 무엇을 보고 무엇을 안 보는가", () => {
  it("execution_schedule의 threshold_ratio는 이 대조에 넣지 않는다", () => {
    // types.ts가 '1.4 부족판정 / 1.2~1.3 2단 임계'를 정상으로 계약한다.
    // 같은 등식에 접으면 정상 카드가 막히고, 합집합으로 보면 어긋남이 가려진다.
    const twoStage: ConditionCard = {
      ...hantoo,
      execution_schedule: [{ ...hantoo.execution_schedule[0]!, threshold_ratio: 1.2 }],
    };
    expect(ratioView(twoStage, 1.4, pos).confirmed).toBe(true);

    const masking: ConditionCard = {
      ...withRatios([{ ratio: 1.7 }]),
      execution_schedule: [{ ...hantoo.execution_schedule[0]!, threshold_ratio: 1.2 }],
    };
    expect(ratioView(masking, 1.2, pos).confirmed).toBe(false); // 170 vs 120이 그대로 잡힌다
  });

  it("시계에 묶이지 않는다 — asOf도 Date도 인자가 아니다", () => {
    // SSR 첫 페인트(asOf=null)에서도 같은 답이어야 한다. 인자가 셋뿐인 것이 그 보증이다.
    expect(ratioView.length).toBe(3);
  });

  it("가격에 묶이지 않는다 — 슬라이더를 끌어도 판정이 변하지 않는다", () => {
    const a = ratioView(withRatios([{ ratio: 1.7 }]), 1.4, positions(5_000)[0]!);
    const b = ratioView(withRatios([{ ratio: 1.7 }]), 1.4, positions(12_000)[0]!);
    expect(a).toEqual(b);
  });
});
