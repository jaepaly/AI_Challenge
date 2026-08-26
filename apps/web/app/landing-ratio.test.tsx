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

/**
 * 원장이 말하는 유지비율. **실계좌를 가정한 제2 의견이다.**
 *
 * ⚠ `#67` A-1 (다) 채택 이후 합성 원장은 **카드에서 파생**된다. 그래서 아무것도 안
 *   하면 이 파일의 검사가 카드를 자기 자신과 맞대 보게 되고 **전부 통과한다** —
 *   실제로 그렇게 됐고 10건이 한꺼번에 초록이 됐다(배선하면서 확인).
 *
 *   이 파일이 지키는 요구사항은 사라지지 않았다: *"원장과 카드가 다른 값을 말하면
 *   화면이 둘 다 낸다."* 그건 **실계좌가 붙는 순간 다시 실재**한다. 그래서 원장을
 *   목으로 고정해 그 상황을 만든다 — 검사를 지우는 대신 전제를 명시한다.
 */
const LEDGER_R = 1.4;

/** 카드와 무관한 원장을 세운다 — 실계좌가 붙었을 때의 모양 */
function fixedLedger(actual: typeof import("../lib/marginguard/snapshot")) {
  return {
    ledger: () => ({ loan: actual.ACCOUNT.loan, cash: actual.ACCOUNT.cash, requiredRatio: LEDGER_R }),
    portfolioLedger: () => ({ loan: 6_000_000, cash: 0, requiredRatio: LEDGER_R }),
  };
}

/** 첫 프리셋(기본 선택)의 유지비율만 갈아 끼운 랜딩을 SSR 렌더한다 */
async function renderWithCardRatio(
  ratio: number | null,
  /**
   * `independentLedger: false` 면 **실제 `ledger()` 를 그대로 쓴다** — 카드에서 파생되는
   * 진짜 동작이다. 기본값이 true 인 이유는 이 파일의 다른 검사들이 *"두 값이 다를 때"* 를
   * 재기 때문이고, 그 상황은 실계좌가 붙어야 생긴다(#67 A-1).
   */
  { independentLedger = true }: { independentLedger?: boolean } = {},
): Promise<string> {
  vi.resetModules();
  if (ratio !== null) {
    vi.doMock(SNAPSHOT, async () => {
      const actual = await vi.importActual<typeof import("../lib/marginguard/snapshot")>(SNAPSHOT);
      return {
        ...actual,
        ...(independentLedger ? fixedLedger(actual) : {}),
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
    // patch 를 뒤에 둔다 — 개별 검사가 원장까지 갈아 끼우고 싶으면 덮을 수 있어야 한다
    return { ...actual, ...fixedLedger(actual), ...patch(actual) };
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
    expect(html).toContain("조건카드의 유지비율 170%로 산출했습니다");
    expect(html).toContain("계좌 원장은 같은 자리에 140%를 적고 있어 같지 않습니다");
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
    /**
     * ⚠ **1.3 이다(전에는 1.7).** (다) 채택 후 카드가 임계가를 구동하므로 1.7 이면
     *   임계가가 10,200원이 되어 기본 가격 10,000원에서 **이미 관통**이다 — 그러면
     *   이 검사가 "관통 전"을 못 잰다. 1.3 이면 임계가 7,800원이라 관통 전이고,
     *   원장 1.4 와는 여전히 어긋나 배너가 뜬다. **재는 것은 그대로다.**
     */
    const html = await renderWithCardRatio(1.3);

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
    // ⚠ 임계가가 **카드 r 로 정해진다**(1.7 × 600만 ÷ 1,000주 = 10,200원). 전에는
    //   "원장 r로 정해진다 — 변하지 않는다"라고 적혀 있었고, 그게 (다)가 고친 결함이다.
    expect(html).toContain("임계가 10,200원");
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
    // positions()의 group은 "A∙B군"이다 — 둘째 줄로 좁혀진다.
    // 요지는 **적용 조항이 [0]이 아닌 상태**를 만드는 것이라 순서를 그렇게 둔다.
    const html = await renderWith(
      swapRules([
        { symbol_group: "C∙D군", ratio: 1.7 },
        { symbol_group: "A∙B군", ratio: 1.4 },
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
    expect(html).toContain("계좌 원장은 같은 자리에 140%를 적고 있어 같지 않습니다");
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
 * 어긋난 화면이 **어느 r에서 나왔는지** 말하는가.
 *
 * ⚠ **이 블록이 존재한 이유가 (다) 채택으로 해소됐다**(#67 A-1). 원래 주석은 이랬다::
 *
 *     기본 가격 10,000원에서는 담보부족액이 렌더되지 않는다. 그런데 임계가·여유·λ*는
 *     전부 원장 r로 만든 값이고, 어긋난 상태에서 카드 쪽이 맞다면 이 계좌는 이미
 *     부족이다(카드 1.7이면 임계가 10,200원 · 부족 200,000원).
 *
 * 즉 **위험이 화면 뒤에 숨어 있었다** — 원장 1.4 기준으로는 "아직 여유 있음"인데
 * 카드가 맞다면 이미 부족인 구간이다. 이제 카드가 구동하므로 그 부족이 **화면에
 * 그대로 뜬다.** 검사도 그것을 재도록 바꾼다: 숨은 위험을 배너로 설명하는 것에서,
 * **위험이 실제로 표시되는지** 확인하는 것으로.
 */
describe("어긋난 화면 — 카드가 위험하다면 그 위험이 보인다", () => {
  it("카드 기준으로 이미 부족이면 화면이 부족을 낸다 — 숨기지 않는다", async () => {
    const html = await renderWithCardRatio(1.7);

    // 원장 1.4 기준이면 "여유 있음"이던 자리다. 카드 1.7 이 구동하므로 관통이다.
    expect(html).toContain('data-state="breach"');
    expect(html).toContain("담보부족 200,000원");
    expect(html).toContain("임계가 10,200원");
    // 그 숫자가 어디서 왔는지도 함께 적는다
    expect(html).toContain("이 화면의 임계가·담보부족액·λ*는 조건카드의 170%로 산출했습니다");
  });

  it("근거 행 문구도 화면에 없는 값만 가리키지 않는다", async () => {
    const html = await renderWithCardRatio(1.7);
    expect(html).toContain("이 화면의 임계가·담보부족액은 조건카드의 유지비율 170%로 산출했습니다");
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

/**
 * (다) 채택이 **무엇을 고쳤는지** 재는 자리(#67 A-1, #64 P0-1).
 *
 * 이 검사들이 없으면 위의 다른 검사들은 전부 *"어긋났을 때 어떻게 보이는가"* 만 재고,
 * **카드가 계산을 구동한다**는 주장 자체는 아무도 안 본다.
 */
describe("카드가 계산을 구동한다", () => {
  it("🔴 업로드한 1.5 카드가 수량을 낸다 — 전에는 영구 차단이었다", async () => {
    /**
     * 2026-08-24 실측: 원장이 리터럴 1.4 이던 시절, r ≠ 1.4 카드는 **전부** 차단됐다.
     *
     *     카드 r=1.5  → "유지비율 150%와 계좌 원장의 140%가 같지 않습니다"
     *     카드 r=1.2  → 차단        카드 r=1.05 → 차단
     *
     * 우리가 확보한 원문 기준으로 **차단되는 쪽이 다수**였다(메리츠 C∙D군 150 · 한투
     * 대주 120·대주전용 105 · 신한 105·120·170 · 미래에셋 145·120·105). 즉 *"심사위원이
     * 자기 약관을 올려 본다"* 는 데모가 실제 문서 대부분에서 "산정 불가"를 냈다.
     */
    const html = await renderWithCardRatio(1.5, { independentLedger: false });
    expect(html).not.toContain("같지 않습니다");
    expect(html).not.toContain('id="ratioBanner"');
    // 1.5 × 600만 ÷ 1,000주 = 9,000원 — 기본가 10,000원이면 아직 관통 전
    expect(html).toContain("임계가 9,000원");
  });

  it("카드 r 을 바꾸면 임계가가 따라온다 — 되돌리면 원래 값", async () => {
    const at = async (ratio: number | null) =>
      /임계가 ([0-9,]+)원/.exec(await renderWithCardRatio(ratio, { independentLedger: false }))?.[1];
    // ⚠ `null` 로 되돌리지 않는다 — 헬퍼가 null 이면 doMock 을 안 걸어 **앞 검사의
    //   목이 남는다**(실제로 7,200 이 새어 나왔다). 값을 명시해 왕복을 잰다.
    expect(await at(1.4)).toBe("8,400");
    expect(await at(1.5)).toBe("9,000");
    expect(await at(1.2)).toBe("7,200");
    expect(await at(1.4)).toBe("8,400"); // 되돌아온다
  });

  it("카드가 r 을 하나로 못 정하면 숫자를 하나도 내지 않는다 — NaN 을 찍지 않는다", async () => {
    const html = await renderWith((actual) => ({
      CARDS: actual.CARDS.map((c, i) =>
        i === 0
          ? {
              ...c,
              card: {
                ...c.card,
                ratio_rules: [
                  { ...c.card.ratio_rules[0]!, ratio: 1.4, symbol_group: "A∙B군" },
                  { ...c.card.ratio_rules[0]!, ratio: 1.5, symbol_group: "C∙D군" },
                ],
              },
            }
          : c,
      ),
      // ⚠ 계좌 쪽 종목군도 함께 목한다. 스냅숏 기본값은 "A∙B군" 이라 그대로 두면
      //   첫 줄로 **좁혀져** 이 검사가 보려는 상태(못 정함)가 아예 안 나온다.
      positions: (prevClose: number) => [
        { ...actual.positions(prevClose)[0]!, group: "일반" },
      ],
      ledger: () => ({ loan: actual.ACCOUNT.loan, cash: actual.ACCOUNT.cash, requiredRatio: Number.NaN }),
      portfolioLedger: () => ({ loan: 6_000_000, cash: 0, requiredRatio: Number.NaN }),
    }));
    // 메리츠형 — 종목군이 '일반'이라 A∙B군/C∙D군 어느 쪽도 안 걸린다
    expect(html).not.toContain("NaN");
    expect(html).toContain("유지비율을 정하지 못했습니다");
    expect(html).toContain("임계가 —");
  });
});
