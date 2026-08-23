import { expect, test, type Page } from "@playwright/test";

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

/** 카드 verified_at(2026-08-09) 기준 경과일이 30을 넘는 날 */
const STALE_DAY = "2026-09-10T09:00:00+09:00";
/** 아직 신선한 날 — 경과 14일 */
const FRESH_DAY = "2026-08-23T09:00:00+09:00";

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
    await expect(banner).toContainText("32일 경과");
    await expect(banner).toContainText("허용 30일");
  });

  test("근거는 가리지 않는다 — 재검증하러 가려면 어느 문장인지가 더 필요하다", async ({
    page,
  }) => {
    await openAt(page, STALE_DAY);
    await dragToBreach(page);
    // 근거 패널의 유지비율 인용이 만료 상태에서도 살아 있어야 한다
    await expect(page.getByText("140%").first()).toBeVisible();
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
