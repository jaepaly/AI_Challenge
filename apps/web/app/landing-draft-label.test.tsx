// @vitest-environment jsdom
/**
 * **검수 전(draft) 표시가 숫자 옆에 있는가** — `#64` P0-3 결정의 조건.
 * ---------------------------------------------------------------------------
 * P0-3 은 *"draft 에서 계산을 막을 것인가"* 였고 결론은 **막지 않는다**(`#30` 유지)였다.
 * 인제스트 출력의 `status` 가 무조건 `draft` 라, 막으면 업로드 데모의 출력 화면이 통째로
 * *"산정 불가"* 가 되기 때문이다 — *"AI 가 어디 있나"* 에 답하는 그 화면이다.
 *
 * 대신 조건을 붙였다: **처분 수량 옆에 그 사실이 있어야 한다.**
 *
 * `options-compare.tsx:56` 이 자기 태그를 단 이유를 이미 적어 두었다 —
 * *"배너가 화면 위쪽에만 있으면 여기까지 스크롤한 사람은 미검수 카드인 줄 모른 채 숫자만
 * 본다."* 그런데 정작 **해소 4경로보다 무거운 강제처분 수량**에는 안 걸려 있었다.
 * 배너(`#cardBanner`)는 그보다 95줄 위다.
 *
 * 실측으로 카드가 틀리면 **195주 ↔ 583주**만큼 벌어진다. 화면에서 제일 무거운 숫자다.
 *
 * ## ⚠ 문구로 찾으면 안 된다
 *
 * `landing-freshness.test.tsx` 머리말이 이미 겪은 함정이다 — 푸터 고지문이
 * *"조건 카드가 draft(검수 전)면 참고 모드로만 동작합니다"* 를 **항상** 담고 있어서
 * `/참고 모드/` 로 찾으면 배너가 없어도 통과한다. 여기서는 **DOM 위치**로 본다:
 * 어느 섹션의 제목 안에 태그가 있는지.
 *
 * ## 기존 태그도 여기서 지킨다
 *
 * `options-compare` 의 태그에는 검사가 **하나도 없었다**(2026-08-25 확인). 지워도 아무도
 * 몰랐다. 새로 다는 것과 같은 파일에서 함께 본다.
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

/** verified 카드가 신선한 날 — draft 만 참고 모드가 되게 한다. */
/** 검증일 당일 — 재검증으로 날짜가 바뀌어도 따라온다(2026-09-06 에 실제로 바뀌었다) */
const FRESH_DAY = CARDS.find((c) => c.card.status === "verified")!.card.verified_at!;

const draftPreset = CARDS.find((c) => c.card.status === "draft");
const verifiedPreset = CARDS.find((c) => c.card.status === "verified");

function setup(label?: string) {
  vi.setSystemTime(new Date(`${FRESH_DAY}T09:00:00+09:00`));
  const { container } = render(<Landing build={BUILD} />);
  if (label !== undefined) {
    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      el.textContent?.includes(label),
    );
    expect(button, `${label} 버튼을 찾지 못했다`).toBeDefined();
    fireEvent.click(button!);
  }
  // 임계가 아래로 내려야 `#liqBox`(처분 수량)가 렌더된다.
  const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
  expect(slider, "가격 슬라이더를 찾지 못했다").not.toBeNull();
  fireEvent.change(slider!, { target: { value: "6000" } });
  return container;
}

/** 그 섹션의 **제목 안**에 태그가 있는지. 본문 어딘가가 아니라 제목이어야 눈에 붙는다. */
const tagIn = (container: HTMLElement, selector: string) =>
  container.querySelector(`${selector} h2 .draftTag`);

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("전제 — 이 검사가 볼 대상이 실제로 있다", () => {
  it("스냅숏에 draft 카드와 verified 카드가 둘 다 있다", () => {
    expect(draftPreset, "draft 카드가 없으면 아래가 전부 무의미해진다").toBeDefined();
    expect(verifiedPreset).toBeDefined();
  });

  it("임계가 아래로 내리면 처분 수량 섹션이 렌더된다", () => {
    const container = setup(draftPreset!.label);
    expect(
      container.querySelector("#liqBox"),
      "#liqBox 가 없다 — 가격을 더 내려야 하거나 quantOk 가 막혔다",
    ).not.toBeNull();
    expect(container.querySelector("#liqQty")).not.toBeNull();
  });
});

describe("🔴 draft 카드 — 검수 전 표시가 숫자 옆에 있다", () => {
  it("강제처분 수량 제목에 참고 모드 태그가 붙는다 (#64 P0-3)", () => {
    const container = setup(draftPreset!.label);
    expect(
      tagIn(container, "#liqBox"),
      "처분 수량 제목에 draftTag 가 없다 — 배너는 95줄 위라 여기까지 온 사람은 못 본다",
    ).not.toBeNull();
  });

  it("해소 4경로 제목에도 붙는다 — 기존 태그를 여기서 지킨다", () => {
    const container = setup(draftPreset!.label);
    expect(
      tagIn(container, ".opt"),
      "options-compare 의 draftTag 가 사라졌다",
    ).not.toBeNull();
  });

  it("태그 문구가 '미검수' 라고 말한다 — '참고 모드' 만으로는 이유가 안 보인다", () => {
    const container = setup(draftPreset!.label);
    expect(tagIn(container, "#liqBox")!.textContent).toMatch(/미검수/);
  });
});

describe("verified 카드 — 태그가 없다", () => {
  it("검수된 카드에는 어느 섹션에도 태그가 안 붙는다", () => {
    const container = setup(verifiedPreset!.label);
    expect(
      tagIn(container, "#liqBox"),
      "verified 카드인데 미검수 태그가 붙는다 — 사실이 아닌 표시다",
    ).toBeNull();
    expect(tagIn(container, ".opt")).toBeNull();
  });

  /**
   * ⚠ 이 검사가 위 검사를 지킨다. `.draftTag` 를 **항상** 그리는 구현으로 바꾸면 위 셋은
   *   전부 초록인데 화면은 거짓말을 한다. 반대 방향을 함께 봐야 한다.
   */
  it("푸터 고지문은 verified 에서도 '참고 모드' 를 담는다 — 문구로 찾으면 안 되는 이유", () => {
    const container = setup(verifiedPreset!.label);
    expect(container.textContent).toMatch(/참고 모드로만 동작합니다/);
    expect(container.querySelectorAll(".draftTag")).toHaveLength(0);
  });
});
