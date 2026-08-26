/**
 * 스냅숏 픽스처의 **종목군 어휘**를 지킨다 — `#91` 결정(D)·조건①②의 기계 대응물.
 * ---------------------------------------------------------------------------
 * 결정된 것은 두 가지였다.
 *
 *   ① 업로드 문서에서 비율 축을 **자동 추출**하는 것은 여전히 `B-2` 컷이다.
 *   ② 사람이 원문과 대조해 만든 **사전 검증 픽스처**의 군별 분리는 자동 추출이
 *      아니므로 컷 범위 밖이다.
 *
 * ②가 ①로 미끄러지지 않게 하는 것이 이 파일이다. 픽스처가 "사람이 원문과 대조했다"는
 * 자격을 유지하려면 **적어 넣은 짝이 인용 스팬 안에 글자로 있어야** 한다. 추론이
 * 한 칸이라도 들어가는 순간 그것은 ②가 아니라 ①이다.
 *
 * ⚠ **`toContain` 이 동어반복이 아닌 이유** — 비교 대상이 카드가 아니라 `EVIDENCE`
 *   에서 온 **원문 인용문**이다. 카드에 `{ "E군", 1.7 }` 을 더하면 `"170%"` 가 인용문에
 *   없어서 발화하고, `A∙B군` 을 `1.45` 로 바꿔도 `"145%"` 가 없어서 발화한다. 카드끼리
 *   비교하면 그 둘 다 조용히 통과한다.
 */
import { describe, expect, it } from "vitest";
import { policyRatio } from "@marginguard/engine";
import type { Position } from "@marginguard/engine";
import { CARDS, PORTFOLIO_POSITIONS, positions, PRICE_START } from "./snapshot";
import { evidenceView } from "./evidence-view";

const cardOf = (key: string) => {
  const preset = CARDS.find((c) => c.key === key);
  if (preset === undefined) throw new Error(`프리셋 ${key} 가 없다`);
  return preset.card;
};

const at = (group: string | undefined): Position => ({
  ...positions(PRICE_START)[0]!,
  group,
});

describe("메리츠 — 문서가 군을 가르므로 카드도 가른다", () => {
  it("A∙B군 140% · C∙D군 150% 두 줄이다", () => {
    const rules = cardOf("meritz").ratio_rules;
    expect(rules.map((r) => [r.symbol_group, r.ratio])).toEqual([
      ["A∙B군", 1.4],
      ["C∙D군", 1.5],
    ]);
  });

  it("A∙B군 종목은 1.4 로 좁혀진다 — 기본 화면이 지금과 같은 값으로 돈다", () => {
    const p = policyRatio(cardOf("meritz"), at("A∙B군"));
    expect(p.resolved).toBe(true);
    expect(p.resolved && p.ratio).toBe(1.4);
  });

  it("C∙D군 종목은 1.5 로 좁혀진다 — 분할 전에는 낼 수 없던 값이다", () => {
    const p = policyRatio(cardOf("meritz"), at("C∙D군"));
    expect(p.resolved).toBe(true);
    expect(p.resolved && p.ratio).toBe(1.5);
  });

  /**
   * 문서에 없는 어휘로 물으면 **모른다고 답해야 한다.** 좁히기가 0 건이면
   * `narrowRatioRules` 는 후보를 그대로 두고(비우지 않는다) 값이 갈려 AMBIGUOUS 가
   * 된다. 예전 `"일반"` 이 정확히 이 자리였는데, 룰이 한 줄뿐이라 그 사실이
   * **화면에 드러나지 않고 1.4 로 조용히 계산됐다.**
   */
  it("문서에 없는 군으로 물으면 AMBIGUOUS 다 — 침묵하지 않는다", () => {
    const p = policyRatio(cardOf("meritz"), at("일반"));
    expect(p.resolved).toBe(false);
    expect(p.resolved === false && p.why).toBe("AMBIGUOUS");
    expect(p.resolved === false && p.candidates).toEqual([140, 150]);
  });

  it("종목군을 안 주면 좁힐 재료가 없다 — 역시 AMBIGUOUS", () => {
    const p = policyRatio(cardOf("meritz"), at(undefined));
    expect(p.resolved).toBe(false);
    expect(p.resolved === false && p.candidates).toEqual([140, 150]);
  });
});

describe("적어 넣은 짝이 인용 스팬 안에 글자로 있다 — ②가 ①로 안 미끄러지게", () => {
  it("메리츠 두 줄 다 군 이름과 % 표기가 인용문 안에 있다", () => {
    const card = cardOf("meritz");
    for (const rule of card.ratio_rules) {
      const quote = rule.evidence.quote;
      expect(quote).toContain(rule.symbol_group);
      expect(quote).toContain(`${Math.round(rule.ratio * 100)}%`);
    }
  });

  /**
   * 120% 는 **신용거래대주** 행이라 이 원장(융자)에 넣지 않았다. 같은 인용문 안에
   * 글자로 있으므로 위 검사만으로는 못 막는다 — 상품 축을 따로 본다.
   */
  it("융자 원장에 대주 조항을 끌어오지 않았다", () => {
    const products = new Set(cardOf("meritz").ratio_rules.map((r) => r.product_type));
    expect([...products]).toEqual(["신용거래융자"]);
  });
});

describe("한투·유진 — 문서에 군 축이 없으므로 가르지 않는다", () => {
  it.each(["hantoo", "lower"])("%s 는 룰이 한 줄이고 r=1.4 다", (key) => {
    expect(cardOf(key).ratio_rules).toHaveLength(1);
    const p = policyRatio(cardOf(key), at("A∙B군"));
    expect(p.resolved).toBe(true);
    expect(p.resolved && p.ratio).toBe(1.4);
  });

  /**
   * 룰이 하나면 라벨을 아예 안 본다(`policy-ratio.ts` narrowRatioRules ②는
   * `candidates.length > 1` 안에 있다). 그래서 이 두 카드는 **어떤 종목군으로 물어도**
   * 같은 답을 낸다 — 메리츠 분할이 이 둘을 건드리지 않았다는 회귀 검사다.
   */
  it.each(["hantoo", "lower"])("%s 는 종목군을 무엇으로 물어도 답이 같다", (key) => {
    const answers = ["A∙B군", "C∙D군", "일반", undefined].map((g) => {
      const p = policyRatio(cardOf(key), at(g));
      return p.resolved ? p.ratio : `unresolved:${p.why}`;
    });
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe(1.4);
  });
});

describe("픽스처끼리 어긋나지 않는다", () => {
  /**
   * `positions()` 의 군과 카드의 `symbol_group` 은 **함께** 움직여야 한다. 한쪽만
   * 옮기면 화면은 안 깨지고 조용히 AMBIGUOUS 로 떨어진다 — 그 어긋남을 여기서 잡는다.
   */
  it("positions() 의 종목군이 메리츠 카드에 실재하는 군이다", () => {
    const group = positions(PRICE_START)[0]!.group;
    const known = cardOf("meritz").ratio_rules.map((r) => r.symbol_group);
    expect(known).toContain(group);
  });

  it("기본 화면은 분할 뒤에도 r 을 하나로 정한다 — 세 프리셋 전부", () => {
    const pos = positions(PRICE_START)[0]!;
    for (const preset of CARDS) {
      const p = policyRatio(preset.card, pos);
      expect(p.resolved, `${preset.key} 가 r 을 못 정한다`).toBe(true);
    }
  });

  /**
   * `test_portfolio_single_group` — `snapshot.ts` 의 `portfolioLedger` 머리말이
   * *"그 전제를 이 검사가 지킨다"* 고 적고 있었는데 **검사는 없었다**(`#91` 조건②를
   * 받으면서 확인). 여기서 만든다.
   *
   * `CreditLedger.requiredRatio` 는 스칼라라 종목마다 다른 r 을 실을 자리가 없다.
   * 섞인 포트폴리오를 넣는 날 이 검사가 먼저 넘어져야 하고, 그때 고칠 것은
   * `portfolioLedger` 가 아니라 **경계 계약**이다(전원 승인 사항).
   */
  it("다종목 포지션은 전부 같은 종목군이다 — 원장 r 이 스칼라이므로", () => {
    const groups = new Set(PORTFOLIO_POSITIONS.map((p) => p.group));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBe(positions(PRICE_START)[0]!.group);
  });
});

/**
 * `evidenceView` 는 유지비율 행을 **하나만** 그린다 — 좁히기가 고른 조항(`selected`)
 * 이고, 안 넘기면 `ratio_rules[0]` 이다. 그러니 분할의 값어치는 "행이 둘이 된다"가
 * 아니라 **고른 조항과 그린 조항이 같다**는 데 있다. 어긋나면 계산은 150% 로 하고
 * 화면은 140% 를 근거로 찍는다.
 */
describe("화면 — 좁히기가 고른 조항을 그대로 그린다", () => {
  it.each([
    ["A∙B군", "140%"],
    ["C∙D군", "150%"],
  ])("%s 종목이면 근거 행이 %s 를 찍고 그 표기가 인용문 안에 있다", (group, figure) => {
    const p = policyRatio(cardOf("meritz"), at(group));
    expect(p.resolved).toBe(true);
    const view = evidenceView(cardOf("meritz"), p.resolved ? p.selected[0] : undefined);
    const row = view.rows.find((r) => r.role === "ratio");
    expect(row?.figure).toBe(figure);
    expect(row?.figureInQuote).toBe(true);
  });

  /**
   * 나눈 뒤에도 `otherFigures` 문단은 **남는다.** `own` 이 그 행이 찍은 표기 하나라,
   * 같은 인용문의 나머지 값이 그대로 "함께 있다"로 적힌다. 120% 는 어느 쪽을 그려도
   * 남는다 — 상품이 다른 행이라 카드가 담지 않기 때문이다.
   */
  it.each([
    ["A∙B군", ["150%", "120%"]],
    ["C∙D군", ["140%", "120%"]],
  ])("%s 를 그려도 인용문의 나머지 표기를 계속 적는다", (group, expected) => {
    const p = policyRatio(cardOf("meritz"), at(group));
    const view = evidenceView(cardOf("meritz"), p.resolved ? p.selected[0] : undefined);
    const row = view.rows.find((r) => r.role === "ratio");
    expect(row?.otherFigures).toEqual(expected);
  });
});
