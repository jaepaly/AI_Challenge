import { expect, test, type Page } from "@playwright/test";
import { MAX_FRESH_AGE_DAYS } from "@marginguard/engine";
import { CARDS } from "../lib/marginguard/snapshot";

/**
 * 신선도 게이트 — **브라우저에서** 카드가 만료되면 수량을 내지 않는가
 * ---------------------------------------------------------------------------
 * 이 파일이 jsdom(`app/landing-freshness.test.tsx`)과 겹치지 않는 이유는 하나다:
 * 신선도 판정의 입력이 **브라우저 시계**라는 것(`lib/marginguard/freshness-view.ts`).
 * jsdom 은 `vi.setSystemTime` 으로 모듈 안의 시계를 바꾸지만, **진짜 브라우저가
 * 그 날짜에 무엇을 그리는지**는 브라우저에서만 볼 수 있다.
 *
 * 그리고 이 시나리오는 가상이 아니다. `#73` 리뷰에서 A 가 실측한 것이다::
 *
 *     카드          9/7      9/8      9/9      9/10     9/11
 *     한국투자      195주    195주    null     null     null
 *
 * 카드 `verified_at` 은 2026-08-09 이고 `MAX_FRESH_AGE_DAYS` 는 30 이라, 재검증
 * 없이 심사 기간에 들어가면 **9/9 부터 사흘간 이 화면**이 된다. 아래 검사가 그
 * 화면을 고정한다 — 9/6 재검증(A-2)이 끝나면 심사 기간에는 안 나오지만, **나올 때
 * 어떻게 나와야 하는지**는 계속 지켜야 한다.
 */

/**
 * ⚠ 날짜를 **카드에서 파생시킨다.** 리터럴로 박으면 A-2(9/6 카드 재검증)가 이 파일을
 *   깨뜨린다 — `verified_at` 이 2026-09-06 이 되는 순간 2026-09-10 은 경과 4일이라
 *   FRESH 가 되고, "카드가 만료된 날" 두 건이 실패한다. 그때 A 는 이 결합을 모르는
 *   채로 "왜 깨졌지"부터 시작한다(#75 리뷰, A).
 *
 *   이 파일이 지키려는 것은 *"만료되면 어떻게 보이는가"* 이지 *"2026-09-10 에 어떻게
 *   보이는가"* 가 아니다. 재검증해도 검사는 그대로 참이어야 한다.
 */
const VERIFIED_AT = CARDS[0]!.card.verified_at!;
/** 경과일을 딱 2일 넘긴다 — 화면이 그 숫자를 그대로 찍으므로 아래에서 다시 쓴다 */
const STALE_AGE_DAYS = MAX_FRESH_AGE_DAYS + 2;

/**
 * `verified_at` 에서 N일 뒤의 KST 오전.
 *
 * ⚠ **순수 달력 연산이다.** 처음에 `new Date(iso + "T00:00:00+09:00")` 로 만들고
 *   `toISOString().slice(0,10)` 으로 잘랐는데, 그건 **UTC 날짜**라 +9 만큼 하루가
 *   밀렸다(32일 기대 → 화면은 31일). 날짜 문자열을 날짜로 다루고, 시간대는 마지막에
 *   붙이기만 한다.
 */
function kstMorningAfter(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${shifted.toISOString().slice(0, 10)}T09:00:00+09:00`;
}

const STALE_DAY = kstMorningAfter(VERIFIED_AT, STALE_AGE_DAYS);
/** 아직 신선한 날 — 허용 한도의 절반 */
const FRESH_DAY = kstMorningAfter(VERIFIED_AT, Math.floor(MAX_FRESH_AGE_DAYS / 2));

/** 임계가(8,400원) 아래로 내려 결론 블록이 뜨게 한다. 기본 10,000원은 관통 전이다. */
const BREACH_PRICE = "8100";

async function openAt(page: Page, iso: string) {
  await page.clock.install({ time: new Date(iso) });
  await page.goto("/");
  // 신선도는 useEffect 이후에 정해진다(SSR 에서는 asOf 가 null)
  await expect(page.locator("#headline")).not.toHaveText("—");
}

async function dragToBreach(page: Page) {
  // ⚠ exact 가 필요하다 — 바깥 section 이 aria-label="가격 시나리오 슬라이더" 라
  //   기본(부분일치)이면 둘이 잡혀 strict 위반이 난다.
  const slider = page.getByLabel("가격 시나리오", { exact: true });
  await slider.fill(BREACH_PRICE);
  await expect(page.locator("#liqBox")).toBeVisible();
}

test.describe("카드가 만료된 날", () => {
  test("수량을 내지 않고, 왜 못 내는지 말한다", async ({ page }) => {
    await openAt(page, STALE_DAY);
    await dragToBreach(page);

    // 결론 블록은 뜨되 수량이 아니라 사유가 들어 있다
    const liqBox = page.locator("#liqBox");
    await expect(liqBox).toContainText("산정 불가");
    await expect(liqBox).toContainText("재검증");
    await expect(page.locator("#liqQty")).toHaveCount(0);
  });

  test("배너가 경과일과 허용 한도를 함께 말한다", async ({ page }) => {
    await openAt(page, STALE_DAY);
    const banner = page.locator("#cardBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`${STALE_AGE_DAYS}일 경과`);
    await expect(banner).toContainText(`허용 ${MAX_FRESH_AGE_DAYS}일`);
  });

  test("근거는 가리지 않는다 — 재검증하러 가려면 어느 문장인지가 더 필요하다", async ({
    page,
  }) => {
    await openAt(page, STALE_DAY);
    await dragToBreach(page);
    /**
     * ⚠ **근거 패널 안으로 범위를 좁힌다.** 전에는 `getByText("140%").first()` 였는데,
     *   그게 잡던 것은 근거 패널이 아니라 상단 스냅숏 고지문(`가상 계좌(… 유지비율
     *   140%)`)이었다. 그 문장은 카드 상태·신선도와 **무관하게 항상** 있으므로,
     *   근거 패널이 통째로 사라져도 초록이었다(#75 리뷰, A — 140% 텍스트 노드 8건 중
     *   첫 매치가 그것이라는 것까지 실측해 주셨다).
     */
    const panel = page.locator("#evidencePanel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("담보유지 비율", { exact: false }).first()).toBeVisible();
    await expect(panel.getByText("140%").first()).toBeVisible();
  });
});

test.describe("아직 신선한 날", () => {
  test("같은 화면이 수량을 낸다 — 위 검사가 '항상 막는다'를 재는 게 아님을 보인다", async ({
    page,
  }) => {
    await openAt(page, FRESH_DAY);
    await dragToBreach(page);

    await expect(page.locator("#liqQty")).toBeVisible();
    await expect(page.locator("#liqQty")).toContainText("195");
    await expect(page.locator("#liqBox")).not.toContainText("산정 불가");
  });

  test("참고 모드 배너가 뜨지 않는다", async ({ page }) => {
    await openAt(page, FRESH_DAY);
    await expect(page.locator("#cardBanner")).toHaveCount(0);
  });
});

test("가로 스크롤이 없다 — 첨부2 §5 ③절이 주장하는 것", async ({ page }) => {
  await openAt(page, FRESH_DAY);
  await dragToBreach(page);
  const overflow = await page.evaluate(() => ({
    vw: window.innerWidth,
    doc: document.documentElement.scrollWidth,
  }));
  expect(overflow.doc, `viewport ${overflow.vw} < 문서 ${overflow.doc}`).toBeLessThanOrEqual(
    overflow.vw,
  );
});
