/**
 * 랜딩 — 유지비율이 어긋난 카드가 화면에 어떻게 나가는가
 * ---------------------------------------------------------------------------
 * 판정은 엔진(ratioAgreement), 문구는 lib/marginguard/ratio-view가 소유한다.
 * 여기가 소유하는 것은 **그 문구가 실제로 랜딩까지 도달하는가**다 — landing.tsx는
 * 엔진의 liquidationSkipped를 읽지 않고 게이트를 자기 코드로 재구현하므로, 엔진에
 * 사유를 추가해도 여기까지 오지 않으면 화면은 그대로 조용하다.
 *
 * ⚠ 프리셋 3장은 makeCard 팩토리 안의 리터럴 1.4를 공유해 **구조적으로 어긋날 수 없다.**
 *   그래서 스냅숏 모듈을 갈아 끼워 첫 프리셋만 1.7로 만든다(기본 선택 카드다).
 *   ACCOUNT.requiredRatio는 1.4 그대로 둔다 — 실제 어긋남의 모양이 그것이다.
 *
 * SSR 렌더(renderToStaticMarkup)로 본다. useEffect가 돌지 않으므로 asOf는 null이고
 * 신선도는 판정되지 않는다 — 그 상태에서도 r 대조는 떠야 한다는 것이 이 파일의 요점 중
 * 하나다(r 비교는 시계와 무관하다).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildInfo } from "../lib/build-info";

const BUILD = { sha: "test", builtAt: "2026-08-19T00:00:00Z" } as unknown as BuildInfo;

const SNAPSHOT = "../lib/marginguard/snapshot";

/** 첫 프리셋(기본 선택)의 유지비율만 갈아 끼운 랜딩을 SSR 렌더한다 */
async function renderWithCardRatio(ratio: number | null): Promise<string> {
  vi.resetModules();
  if (ratio !== null) {
    vi.doMock(SNAPSHOT, async () => {
      const actual = await vi.importActual<typeof import("../lib/marginguard/snapshot")>(SNAPSHOT);
      return {
        ...actual,
        CARDS: actual.CARDS.map((c, i) =>
          i === 0
            ? { ...c, card: { ...c.card, ratio_rules: [{ ...c.card.ratio_rules[0]!, ratio }] } }
            : c,
        ),
      };
    });
  }
  const { default: Landing } = await import("./landing");
  return renderToStaticMarkup(<Landing build={BUILD} />);
}

/**
 * 스냅숏 모듈 전체를 갈아 끼운 랜딩 — 룰이 여럿인 카드·비교 스트립처럼
 * 유지비율 하나만 바꿔서는 닿지 않는 모양을 만들 때 쓴다.
 */
async function renderWith(
  patch: (actual: typeof import("../lib/marginguard/snapshot")) => object,
): Promise<string> {
  vi.resetModules();
  vi.doMock(SNAPSHOT, async () => {
    const actual = await vi.importActual<typeof import("../lib/marginguard/snapshot")>(SNAPSHOT);
    return { ...actual, ...patch(actual) };
  });
  const { default: Landing } = await import("./landing");
  return renderToStaticMarkup(<Landing build={BUILD} />);
}

/** 첫 프리셋의 ratio_rules만 통째로 갈아 끼운다. ACCOUNT·positions는 손대지 않는다 */
const swapRules =
  (rules: Record<string, unknown>[], priceStart?: number) =>
  (actual: typeof import("../lib/marginguard/snapshot")) => ({
    ...(priceStart !== undefined ? { PRICE_START: priceStart } : {}),
    CARDS: actual.CARDS.map((c, i) =>
      i === 0
        ? {
            ...c,
            card: {
              ...c.card,
              ratio_rules: rules.map((r) => ({ ...c.card.ratio_rules[0]!, ...r })),
            },
          }
        : c,
    ),
  });

/** 근거 패널이 좌표·해시와 함께 크게 찍는 유지비율 */
const evidenceRatio = (html: string) => /class="evVal tnum">([^<]*)</.exec(html)?.[1];

afterEach(() => {
  vi.doUnmock(SNAPSHOT);
  vi.resetModules();
});

describe("어긋난 카드 — 화면이 그 사실을 낸다", () => {
  it("카드 1.7 / 원장 1.4: 두 숫자가 배너로 함께 나간다", async () => {
    const html = await renderWithCardRatio(1.7);

    expect(html).toContain('id="ratioBanner"');
    expect(html).toContain("유지비율이 두 곳에서 다릅니다");
    expect(html).toContain("조건카드 170%");
    expect(html).toContain("계좌 원장 140%");
  });

  it("근거 패널의 큰 170% 옆에도 나간다 — 이 결함이 눈에 보이는 자리", async () => {
    const html = await renderWithCardRatio(1.7);

    // 카드가 적은 값은 근거 좌표·해시와 함께 그대로 크게 찍힌다(가리지 않는다)
    expect(html).toContain("유지비율(ratio)");
    expect(html).toContain(">170%<");
    // 그리고 바로 그 자리에서 화면의 계산이 쓴 값을 밝힌다
    expect(html).toContain("계좌 원장의 유지비율 140%로 산출했습니다");
    expect(html).toContain("옆 값 170%와 같지 않습니다");
  });

  it("어느 쪽이 틀렸다고 말하지 않는다 — 화면 전체에 판정 어투가 없다", async () => {
    const html = await renderWithCardRatio(1.7);
    for (const word of ["카드가 틀", "원장이 틀", "잘못된", "오류", "확인됨", "대조됨"]) {
      expect(html).not.toContain(word);
    }
    expect(html).toContain("화면이 판정하지 않습니다");
  });

  /**
   * 이 배너는 관통 전에도 떠야 한다. 원장 r이 낡아 관통이 안 잡히는 구간이야말로
   * 어긋남이 가장 위험한 자리이고(원장 기준 D=0 · NO_SHORTFALL로 완전 침묵),
   * SSR 첫 페인트에서는 기본 가격 10,000원 > 임계가라 breached=false다.
   */
  it("관통 전(breached=false)에도, 신선도가 판정되기 전(SSR)에도 뜬다", async () => {
    const html = await renderWithCardRatio(1.7);

    expect(html).toContain('data-state="safe"'); // 아직 관통 전
    expect(html).not.toContain('id="liqBox"'); // 처분 블록 자체가 DOM에 없다
    expect(html).not.toContain('id="cardBanner"'); // asOf=null이라 신선도 배너는 없다
    expect(html).toContain('id="ratioBanner"'); // 그래도 이것은 있다
  });

  it("7월 재현을 막고 사유를 적는다 — 첫날 수량이 미정이면 20일이 전부 미정이다", async () => {
    const html = await renderWithCardRatio(1.7);

    expect(html).toContain("유지비율이 하나로 확인되지 않아 재현하지 않습니다");
    expect(html).toContain('id="julyBtn"');
    expect(html).toContain("disabled");
  });

  it("다종목 재생도 같은 사유로 막힌다 — 사유 문장이 두 곳에서 갈리지 않는다", async () => {
    const html = await renderWithCardRatio(1.7);
    // quantBlockReason은 계기판·선택지 비교·다종목이 공유한다. 다종목 블록은
    // 관통 여부와 무관하게 렌더되므로 SSR에서 확인 가능한 유일한 소비처다.
    expect(html).toContain('class="optWhy"');
    expect(html).toContain(
      "조건카드의 유지비율 170%와 계좌 원장의 유지비율 140%가 같지 않습니다 — 처분 수량을 추정하지 않습니다",
    );
  });

  /**
   * ⚠ 이 SSR 렌더로 **닿지 않는 것**: 가격이 useState(PRICE_START=10,000)이라 항상
   *   안전 구간이고, #liqBox("이대로면 — 산정 불가")·선택지 비교의 강제 처분 행은
   *   DOM에 없다. 그 두 블록의 문구는 lib/marginguard/ratio-view.test.ts가 문자열
   *   단위로 소유한다. 여기서 확인하는 것은 "게이트가 landing까지 도달한다"까지다.
   */
  it("어긋나면 부족액·담보비율은 그대로 나온다 — 접는 것은 처분 수량뿐이다", async () => {
    const html = await renderWithCardRatio(1.7);
    // 계기판 3칸(담보비율·λ*·카드 상태)은 어긋남과 무관하게 그대로다
    expect(html).toContain("담보비율");
    expect(html).toContain("전 종목 균등 하락 여유 λ*");
    expect(html).toContain("임계가 8,400원"); // 임계가는 원장 r로 정해진다 — 변하지 않는다
  });
});

describe("일치하는 카드 — 아무것도 달라지지 않는다", () => {
  it("프리셋 그대로면 배너도 문구도 생기지 않는다(회귀)", async () => {
    const html = await renderWithCardRatio(null);

    expect(html).not.toContain('id="ratioBanner"');
    expect(html).not.toContain("evRatioGap");
    expect(html).not.toContain("유지비율이 두 곳에서 다릅니다");
    // 통과에 배지를 만들지 않는다
    expect(html).not.toContain("유지비율 확인됨");
  });

  it("프리셋 카드 값을 1.4로 '갈아 끼워도' 원본과 같은 화면이다 — 목이 결과를 만들지 않는다", async () => {
    expect(await renderWithCardRatio(1.4)).toBe(await renderWithCardRatio(null));
  });
});

/**
 * 룰이 여럿인 카드 — **A가 실측한 3행 표의 2번 줄이 복원되지 않는가.**
 *
 * 게이트(ratioAgreement)는 좁혀서 고른 조항을 보는데 근거 패널이 `ratio_rules[0]`을
 * 고정으로 찍으면, 좁히기가 [0]이 아닌 행을 고르는 순간 둘이 다른 조항을 본다.
 * 그러면 좌표·해시가 붙은 유지비율과 부족액·수량이 **서로 다른 r에서 나온 채로**
 * 아무 표식 없이 함께 나간다 — 이 PR이 없애려던 그 그림 그대로다.
 *
 * 도달 가능성은 가정이 아니다: 한투 인용문에 융자 140 / 대주 120 / 대주전용 105
 * 세 행이 실재하고, `ratio_rules`에는 순서 계약이 없다.
 */
describe("룰이 여럿인 카드 — 근거와 계산이 같은 조항을 본다", () => {
  it("융자행이 [0]이 아니어도: 근거로 찍는 값이 부족액을 만든 값이다", async () => {
    // 카드 [대주 1.7, 융자 1.4] · 원장 1.4 · 8,100원 → 관통 구간
    const html = await renderWith(
      swapRules(
        [
          { product_type: "신용대주", symbol_group: "전체", ratio: 1.7 },
          { product_type: "신용융자", symbol_group: "전체", ratio: 1.4 },
        ],
        8_100,
      ),
    );

    expect(evidenceRatio(html)).toBe("140%"); // 원장과 맞대 본 그 값
    expect(html).not.toContain(">170%<"); // 대조가 배제한 조항이 근거로 나가지 않는다
    // 게이트는 정상 통과다 — 부족액·수량은 그대로 나오고 표식이 없는 것이 맞다
    expect(html).toContain("담보부족 300,000원");
    expect(html).toContain('id="liqQty"');
    expect(html).not.toContain('id="ratioBanner"');
    expect(html).not.toContain("evRatioGap");
  });

  it("종목군 축에서도 같다 — 적용 조항이 [0]이 아니어도 그 조항을 찍는다", async () => {
    // positions()의 group은 "일반"이다 — 둘째 줄로 좁혀진다
    const html = await renderWith(
      swapRules([
        { symbol_group: "A∙B군", ratio: 1.7 },
        { symbol_group: "일반", ratio: 1.4 },
      ]),
    );
    expect(evidenceRatio(html)).toBe("140%");
    expect(html).not.toContain('id="ratioBanner"');
  });

  it("어긋남이면 배너·행 문구·큰 숫자가 **한 숫자**를 말한다", async () => {
    const html = await renderWith(
      swapRules([
        { product_type: "신용대주", symbol_group: "전체", ratio: 1.2 },
        { product_type: "신용융자", symbol_group: "전체", ratio: 1.7 },
      ]),
    );
    expect(evidenceRatio(html)).toBe("170%");
    expect(html).toContain("조건카드 170%");
    expect(html).toContain("옆 값 170%와 같지 않습니다");
    expect(html).not.toContain(">120%<"); // 화면에 없는 값을 "옆 값"이라 부르지 않는다
  });

  it("대주행이 종목군과 맞아도 융자행으로 좁힌다 — 낙관 방향으로 뚫리지 않는다", async () => {
    // 카드 [{융자,전체,1.4}, {대주,일반,1.2}] · 포지션 group="일반".
    // 종목군을 먼저 걸면 후보가 대주 120 하나가 되어 원장 1.4가 **막히고**,
    // 원장이 낡아 1.2면 무표식 통과한다. 관련성(융자)을 먼저 거른다.
    const html = await renderWith(
      swapRules([
        { product_type: "신용거래융자", symbol_group: "전체", ratio: 1.4 },
        { product_type: "신용거래대주", symbol_group: "일반", ratio: 1.2 },
      ]),
    );
    expect(html).not.toContain('id="ratioBanner"'); // 원장 1.4는 융자행과 맞다
    expect(evidenceRatio(html)).toBe("140%");
  });
});

/**
 * 관통 전 화면 — 떠 있는 수치가 **어느 r에서 나왔는지** 말하는가.
 *
 * 기본 가격 10,000원에서는 담보부족액이 렌더되지 않는다. 그런데 임계가·여유·λ*는
 * 전부 원장 r로 만든 값이고, 어긋난 상태에서 카드 쪽이 맞다면 이 계좌는 이미 부족이다
 * (카드 1.7이면 임계가 10,200원 · 부족 200,000원). 어긋남이 가장 위험한 구간이다.
 */
describe("관통 전 — 화면의 수치가 어느 기준인지 말한다", () => {
  it("배너가 기준을 밝힌다 — 화면에 없는 값만 가리키고 끝나지 않는다", async () => {
    const html = await renderWithCardRatio(1.7);

    expect(html).toContain('data-state="safe"');
    expect(html).not.toContain("담보부족 300,000원"); // 부족액은 렌더되지 않는다
    expect(html).toContain("임계가 8,400원");
    expect(html).toContain("임계가까지 여유");
    // 실제로 떠 있는 숫자들의 기준을 배너가 적는다
    expect(html).toContain("이 화면의 임계가·담보부족액·λ*는 계좌 원장 140% 기준으로 산출했습니다");
  });

  it("근거 행 문구도 화면에 없는 값만 가리키지 않는다", async () => {
    const html = await renderWithCardRatio(1.7);
    expect(html).toContain("이 화면의 임계가·담보부족액은 계좌 원장의 유지비율 140%로 산출했습니다");
  });

  it("담보비율은 기준 문장에 넣지 않는다 — V/L이라 r과 무관하다", async () => {
    const html = await renderWithCardRatio(1.7);
    expect(html).not.toContain("임계가·담보비율");
  });
});

/**
 * 회사별 비교 스트립 — 선택된 카드가 멀쩡할 때 **다른 카드의 어긋남**이 사유 없는
 * "산정 불가"로만 나가면, 캡션("같은 부족액, 회사만 다를 때")이 원인을 회사 차이로
 * 돌린다. 이 경우 #ratioBanner도 .evRatioGap도 뜨지 않아 화면 어디에도 사유가 없다.
 */
describe("회사별 비교 — 빠진 행의 사유를 적는다", () => {
  it("선택 카드가 멀쩡해도 어긋난 회사의 사유가 화면에 남는다", async () => {
    const html = await renderWith((actual) => ({
      PRICE_START: 8_100,
      CARDS: actual.CARDS.map((c, i) =>
        i === 1
          ? { ...c, card: { ...c.card, ratio_rules: [{ ...c.card.ratio_rules[0]!, ratio: 1.7 }] } }
          : c,
      ),
    }));

    expect(html).toContain("산정 불가");
    expect(html).not.toContain('id="ratioBanner"'); // 선택 카드(한투)는 멀쩡하다
    expect(html).toContain('class="cmpWhy"');
    expect(html).toContain(
      "조건카드의 유지비율 170%와 계좌 원장의 유지비율 140%가 같지 않습니다",
    );
  });

  it("빠진 행이 없으면 사유 블록도 없다", async () => {
    const html = await renderWith(() => ({ PRICE_START: 8_100 }));
    expect(html).not.toContain("산정 불가");
    expect(html).not.toContain('class="cmpWhy"');
  });
});
