// @vitest-environment jsdom
/**
 * 신선도가 **화면에 실제로 렌더되는지** 본다.
 * ---------------------------------------------------------------------------
 * 이 파일 전까지 웹 테스트는 전부 `renderToStaticMarkup`(SSR)이었다. SSR에서는
 * `useEffect`가 돌지 않아 `asOf`가 `null`이고(landing.tsx:89 `useSyncExternalStore`의
 * 서버 스냅숏), **신선도 판정 자체가 일어나지 않는다.** `landing-ratio.test.tsx:13`이
 * 그 한계를 스스로 적어 두었다.
 *
 * 그래서 다음이 한 번도 검증된 적이 없었다:
 *
 *   - draft 카드의 참고 모드 배너가 실제로 화면에 나오는가 (#63에서 문구를 고쳤는데
 *     그 문구가 렌더된다는 것은 아무도 확인하지 않았다)
 *   - 31일째부터 verified 카드가 재검증 배너를 내는가 (재검증 전엔 2026-09-09, #54 실측 사흘
 *     구간 — readiness 엔드포인트로는 503을 봤지만 **화면으로는 못 봤다**)
 *   - 카드 버튼을 눌러 상태가 바뀌는가
 *
 * ## 왜 playwright가 아닌가
 *
 * 위 셋은 전부 **상태와 문구**다. 브라우저 엔진이 필요한 것은 레이아웃·CSS인데
 * 그건 지금 우리가 물어야 하는 질문이 아니다. jsdom은 CI에 브라우저 바이너리를
 * 얹지 않고 이 경로를 덮는다.
 *
 * ⚠ **jsdom이 못 하는 것은 배포본이 실제로 뜨는지다.** 그건 이 검사의 범위가 아니고
 *   `apps/web/app/api/README.md` §3 리허설의 사람 확인 항목이다. 둘을 바꿔치기하면
 *   안 된다 — 여기가 초록이어도 배포가 죽어 있을 수 있다.
 *
 * ## 선택자는 `#cardBanner`다 — 문구로 찾으면 안 된다
 *
 * 처음에 `/참고 모드/`로 찾았다가 **푸터 고지문**("조건 카드가 draft(검수 전)면 참고
 * 모드로만 동작합니다")에 걸렸다. 그 문장은 배너 유무와 무관하게 항상 있으므로
 * `queryByText`가 절대 `null`이 되지 않는다 — 검사가 통과하는 것처럼 보이면서
 * 아무것도 안 보는 상태가 된다. 배너는 `landing.tsx:374`의 `id="cardBanner"`다.
 *
 * ## 시계를 고정한다
 *
 * `asOf`는 `todayISO(new Date())`다. 고정하지 않으면 이 파일은 **오늘이 며칠이냐에
 * 따라** 통과했다 안 했다 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import Landing from "./landing";
import { CARDS } from "../lib/marginguard/snapshot";
import type { BuildInfo } from "../lib/build-info";

const BUILD: BuildInfo = {
  sha: "0".repeat(40),
  shortSha: "0000000",
  branch: "main",
  source: "local",
};

/** 심사위원 시계는 KST다 — 그날 오전으로 잡는다(#56 readiness와 같은 기준). */
function atLocalDate(iso: string) {
  vi.setSystemTime(new Date(`${iso}T09:00:00+09:00`));
}

/**
 * 날짜를 카드에서 파생한다 — 2026-09-06 재검증에서 `"2026-08-23"`(신선한 날) 이 «미래
 * 검증일» 이 되고 `"2026-09-09"`(31일째) 가 신선한 날이 되어 검사 4개가 뒤집혔다.
 */
const VERIFIED_AT = CARDS.find((c) => c.card.status === "verified")!.card.verified_at!;
const dayAfter = (n: number) =>
  new Date(Date.parse(VERIFIED_AT) + n * 86_400_000).toISOString().slice(0, 10);
const FRESH_DAY = VERIFIED_AT; // 검증일 당일 — verified 카드가 신선한 날
const STALE_DAY = dayAfter(31); // 31일째 — 처음 막히는 날

const bannerOf = (container: HTMLElement) =>
  container.querySelector("#cardBanner")?.textContent ?? null;

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("선택자 자체를 먼저 검사한다", () => {
  it("푸터 고지문이 '참고 모드'를 항상 담고 있다 — 문구로 찾으면 안 되는 이유", () => {
    atLocalDate(FRESH_DAY);
    const { container } = render(<Landing build={BUILD} />);
    expect(container.textContent).toMatch(/참고 모드로만 동작합니다/);
    expect(bannerOf(container)).toBeNull(); // 그런데 배너는 없다
  });
});

describe("verified 카드의 신선도가 화면에 렌더된다", () => {
  it("심사 첫날(9/7, 29일째)에는 배너가 없다", () => {
    atLocalDate("2026-09-07");
    const { container } = render(<Landing build={BUILD} />);
    expect(bannerOf(container)).toBeNull();
  });

  it("9/8(30일째)까지 배너가 없다 — 경계의 안쪽", () => {
    atLocalDate("2026-09-08");
    const { container } = render(<Landing build={BUILD} />);
    expect(bannerOf(container)).toBeNull();
  });

  /**
   * #54가 실측한 구간이다. readiness 엔드포인트로는 503을 봤지만 **화면이 실제로
   * 어떻게 되는지는 렌더로 확인한 적이 없었다.** 여기가 그 확인이다.
   */
  it("🔴 31일째부터 재검증 배너가 뜬다 — 게이트가 살아 있다", () => {
    atLocalDate(STALE_DAY);
    const { container } = render(<Landing build={BUILD} />);
    const banner = bannerOf(container);
    expect(banner).not.toBeNull();
    expect(banner).toMatch(/31일 경과/);
    expect(banner).toMatch(/재검증/);
  });

  it("9/11(심사 마지막 날)에는 배너가 없다 — 2026-09-06 재검증이 심사 창을 덮는다", () => {
    // 재검증 전엔 이 날 «여전히 배너가 있다» 를 확인하던 자리다. 제출물이 약속한 창이다.
    atLocalDate("2026-09-11");
    const { container } = render(<Landing build={BUILD} />);
    expect(bannerOf(container)).toBeNull();
  });
});

describe("draft 카드의 배너가 실제로 화면에 나온다 (#63)", () => {
  const draft = CARDS.find((c) => c.card.status === "draft");

  it("스냅숏에 draft 카드가 있다 — 없으면 아래 검사가 조용히 무의미해진다", () => {
    expect(draft).toBeDefined();
  });

  it("🔴 #63이 고친 문구가 그대로 렌더된다", () => {
    atLocalDate(FRESH_DAY); // verified 카드가 신선한 날 — draft만 배너를 낸다
    const { container } = render(<Landing build={BUILD} />);
    expect(bannerOf(container)).toBeNull(); // 기본 선택은 verified

    const button = Array.from(container.querySelectorAll("button")).find((element) =>
      element.textContent?.includes(draft!.label),
    );
    expect(button, `${draft!.label} 버튼을 찾지 못했다`).toBeDefined();
    fireEvent.click(button!);

    const banner = bannerOf(container);
    expect(banner).not.toBeNull();
    expect(banner).toMatch(/검수 전\(draft\)/);
    // #63의 정본 — "안 쓴다"가 아니라 "이 카드로 냈다"를 말해야 한다
    expect(banner).toMatch(/이 카드로 산출/);
    expect(banner).not.toMatch(/사용하지\s*않/);
  });

  it("draft 배너는 '경과'를 말하지 않는다 — STALE과 사유가 다르다", () => {
    atLocalDate(FRESH_DAY);
    const { container } = render(<Landing build={BUILD} />);
    const button = Array.from(container.querySelectorAll("button")).find((element) =>
      element.textContent?.includes(draft!.label),
    );
    fireEvent.click(button!);
    expect(bannerOf(container)).not.toMatch(/경과/);
  });
});
