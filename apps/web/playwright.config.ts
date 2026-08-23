import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — **브라우저에서만 확인되는 것**만 여기 둔다.
 * ---------------------------------------------------------------------------
 * 왜 필요한가: 2026-08-23 `#73` 리뷰에서 A 가 짚었다 — *"브라우저 매트릭스·E2E·수동
 * 점검 기록은 저장소 전체에 없다."* `#72` 가 붙인 것도 jsdom 이라 브라우저가 아니다.
 * 첨부2 §5 ③절이 브라우저 범위를 적어야 하는데, 잰 것이 없으면 적을 것이 없다.
 *
 * ⚠ **`next build` + `next start` 로 돈다.** `next dev` 로 재면 심사자가 보는 것과
 *   다른 것을 재게 된다 — 개발 서버는 최적화·프리렌더가 다르다.
 *
 * ⚠ **시간대를 고정한다.** 신선도 판정이 **열람 시각(브라우저 시계)** 기준이라
 *   (`lib/marginguard/freshness-view.ts`), 러너의 시간대가 바뀌면 같은 커밋이
 *   다른 판정을 낸다. KST 로 못 박는다 — 심사도 KST 다.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // 재시도로 가려지는 불안정은 고치는 편이 싸다
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    timezoneId: "Asia/Seoul",
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    /**
     * firefox 를 넣는 이유는 매트릭스 채우기가 아니다. `#73` 리뷰에서 A 가 짚은
     * 것이 *"파이어폭스로 열었다가 깨지면 §5 의 신뢰가 통째로 흔들린다"* 였고,
     * 그 문장을 지우거나 지키거나 둘 중 하나를 해야 했다. 여기서 지킨다.
     * 엔진이 다른 브라우저는 이것뿐이다(사파리/WebKit 는 아래 참조).
     */
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    /**
     * 375px — 첨부2 §5 ③절이 **이 폭**을 주장한다. 주장하면 그 폭을 잰다.
     * ⚠ `devices["Pixel 7"]` 을 쓰면 안 된다. 그건 412×915 라 **375 를 재지 않는다** —
     *   375 라고 적으면서 412 를 재는 것이 이 저장소가 계속 고쳐 온 그 오류다.
     *   iPhone SE 서술자는 375 지만 `defaultBrowserType: webkit` 이라 미설치
     *   브라우저를 부른다. 그래서 뷰포트만 직접 못 박는다.
     */
    {
      name: "mobile-375",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: false },
    },
    /**
     * ⚠ WebKit(사파리)은 **넣지 않았다.** 러너에 설치돼 있지 않고, 받지 않은 것을
     *   프로젝트로 선언해 두면 "돌고 있다"로 읽힌다. §5 에는 `확인하지 않았다`로
     *   적는다 — 없는 커버리지를 설정 파일로 흉내 내지 않는다.
     */
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
