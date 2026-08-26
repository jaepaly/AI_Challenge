/**
 * 원장이 화면과 **같은 r 을 본다**는 배선 계약.
 * ---------------------------------------------------------------------------
 * (다) 채택(#67 A-1) 이후 유지비율은 카드가 정한다. 그런데 카드에서 r 을 꺼내는 자리가
 * **둘**이다 — 화면 헤드라인(`landing.tsx` 의 `policyRatio(card, pos)`)과 원장
 * (`snapshot.ts` 의 `ledger()`). 이 둘이 **다른 인자로** 부르면 같은 카드에서 다른 답이
 * 나온다. 실제로 그랬다:
 *
 *     차등 카드(AB군 1.4 / CD군 1.5), pos.group = "CD"
 *       policyRatio(card, pos) → resolved 1.5     ← 헤드라인은 정확히 읽었다
 *       policyRatio(card)      → AMBIGUOUS        ← 원장은 pos 를 안 받았다
 *       led.requiredRatio      = NaN
 *       화면                    "유지비율을 숫자로 읽지 못했습니다"
 *
 * 화면이 **아는 것을 모른다고 말한다.** *"모르는 것을 모른다고 말한다"* 를 파는 제품에서
 * 이건 기능 결함이 아니라 주장 위반이다. A 가 #84 리뷰에서 잡았다.
 *
 * 아래 검사들은 **두 호출이 갈라지면 빨간불**이 되도록 되어 있다. 인자를 하나만 빼도
 * 발화한다 — 그게 이 파일의 존재 이유다.
 */
import { describe, expect, it } from "vitest";
import type { ConditionCard, Position } from "@marginguard/engine";
import { policyRatio } from "@marginguard/engine";
import {
  CARDS,
  PORTFOLIO_POSITIONS,
  PRICE_START,
  ledger,
  portfolioLedger,
  positions,
} from "./snapshot";

/** 종목군으로 유지비율이 갈리는 카드. 실제 약관에 흔하다(메리츠 A∙B군/C∙D군 등). */
function grouped(a: number, b: number): ConditionCard {
  const base = CARDS[0]!.card;
  const rule = base.ratio_rules[0]!;
  return {
    ...base,
    ratio_rules: [
      { ...rule, symbol_group: "AB", ratio: a },
      { ...rule, symbol_group: "CD", ratio: b },
    ],
  };
}

describe("원장은 화면과 같은 r 을 본다 (#84 리뷰 ①)", () => {
  it("종목군이 좁혀지면 원장도 그 값을 싣는다 — NaN 이 아니다", () => {
    const card = grouped(1.4, 1.5);
    const pos: Position = { ...positions(PRICE_START)[0]!, group: "CD" };

    const policy = policyRatio(card, pos);
    expect(policy.resolved).toBe(true);
    expect(policy.resolved && policy.ratio).toBe(1.5);

    // 결함이 있던 자리. pos 를 안 넘기면 여기가 NaN 이 된다.
    expect(ledger(card, pos).requiredRatio).toBe(1.5);
    expect(Number.isNaN(ledger(card, pos).requiredRatio)).toBe(false);
  });

  /**
   * ⚠ **이게 실제로 도달하는 모양이다.** 위의 AB/CD 예시는 우리 계좌(`group: "일반"`)
   *   에서는 양쪽 다 AMBIGUOUS 라 갈리지 않는다. 갈리는 것은 카드가 **`일반` 조항과
   *   군별 조항을 같이** 실어 올 때다 — 그리고 그게 실제 약관에서 가장 흔한 모양이다
   *   (일반 105% / 관리종목 170% 같은 표). 업로드 경로로 바로 들어온다.
   */
  it("일반 조항 + 군별 조항이 섞인 카드 — 실제 약관의 흔한 모양", () => {
    const base = CARDS[0]!.card;
    const rule = base.ratio_rules[0]!;
    for (const [normal, other, group] of [
      [1.05, 1.7, "관리종목"],
      [1.5, 1.4, "AB"],
    ] as const) {
      const card: ConditionCard = {
        ...base,
        ratio_rules: [
          { ...rule, symbol_group: "일반", ratio: normal },
          { ...rule, symbol_group: group, ratio: other },
        ],
      };
      // ⚠ 이 검사는 **업로드된 카드**의 흔한 모양을 보는 자리다. 그 문서의 어휘가
      //   `일반`/`관리종목` 이면 계좌 쪽 종목군도 그 어휘여야 좁혀진다 — 스냅숏
      //   기본값(A∙B군)은 이 문서의 어휘가 아니다.
      const pos: Position = { ...positions(PRICE_START)[0]!, group: "일반" };
      expect(policyRatio(card, pos).resolved).toBe(true);
      expect(ledger(card, pos).requiredRatio).toBe(normal);
      // 다종목 쪽도 **같은 문서 어휘**로 물어야 같은 답이 나온다 — 이 검사가 보는 것은
      // 「화면과 원장이 같은 조항을 본다」이지 종목군 어휘가 무엇이냐가 아니다.
      expect(
        portfolioLedger(card, { ...PORTFOLIO_POSITIONS[0]!, group: pos.group }).requiredRatio,
      ).toBe(normal);
    }
  });

  it("좁혀지지 않으면 **양쪽 다** 숫자를 내지 않는다 — 한쪽만 NaN 인 상태가 없다", () => {
    const card = grouped(1.4, 1.5);
    const pos = positions(PRICE_START)[0]!; // group "일반" — AB 도 CD 도 아니다

    expect(policyRatio(card, pos).resolved).toBe(false);
    expect(Number.isNaN(ledger(card, pos).requiredRatio)).toBe(true);
  });

  it("배포되는 모든 카드에서 헤드라인 r 과 원장 r 이 같다", () => {
    const pos = positions(PRICE_START)[0]!;
    for (const preset of CARDS) {
      const policy = policyRatio(preset.card, pos);
      const led = ledger(preset.card, pos);
      const headline = policy.resolved ? policy.ratio : Number.NaN;
      // NaN === NaN 은 거짓이라 Object.is 로 본다 — 못 정한 상태도 **같이** 못 정해야 한다.
      expect(Object.is(led.requiredRatio, headline)).toBe(true);
    }
  });
});

describe("다종목 원장도 카드에서 온다 (#84 리뷰 ②)", () => {
  /**
   * A 의 지적: `portfolioLedger` 를 리터럴 1.4 로 되돌려도 **아무 검사도 안 넘어졌다.**
   * 아래가 그 자리를 막는다 — 카드의 r 을 바꾸면 원장이 따라와야 한다.
   */
  it("카드의 r 이 바뀌면 다종목 원장의 r 도 바뀐다", () => {
    const pos = PORTFOLIO_POSITIONS[0]!;
    const rules = CARDS[0]!.card.ratio_rules;
    const rule = rules[0]!;

    for (const r of [1.2, 1.4, 1.7]) {
      const card: ConditionCard = { ...CARDS[0]!.card, ratio_rules: [{ ...rule, ratio: r }] };
      expect(portfolioLedger(card, pos).requiredRatio).toBe(r);
      // 단일 종목 원장과도 같아야 한다 — 같은 화면에서 두 값이 갈리면 안 된다.
      expect(ledger(card, positions(PRICE_START)[0]!).requiredRatio).toBe(r);
    }
  });

  /**
   * `CreditLedger.requiredRatio` 는 스칼라라 종목마다 다른 r 을 실을 자리가 없다.
   * 지금 다종목 원장이 포지션 하나로 좁혀도 되는 것은 **전부 같은 종목군이기 때문**이다.
   * 그 전제가 깨지는 날 이 검사가 먼저 넘어진다 — 그때 고칠 것은 경계 계약이다.
   */
  it("다종목 포지션은 전부 같은 종목군이다 — 포지션 하나로 좁혀도 되는 근거", () => {
    const groups = new Set(PORTFOLIO_POSITIONS.map((p) => p.group));
    expect(groups.size).toBe(1);
  });
});
