/**
 * 선택지 비교 조립 테스트 — 골든 계좌 기준.
 * 값 자체는 engine이 만들고 여기서는 **표시 규약**을 고정한다:
 * 1차 출력 금액 / 보조 수량 / 근거 없으면 산정 안 함 / 고정 순서.
 */
import { describe, it, expect } from "vitest";
import { liquidationQty, resolutionPaths } from "@marginguard/engine";
import { buildOptions, forcedDisposal, forcedToVoluntaryRatio } from "./options";

/** 한투 골든: V=810만, L=600만, r=1.4, 전일종가 8,100, h=0.15, 보유 1,000주 */
const D = 300_000;
const PREV = 8_100;
const R = 1.4;

const paths = () =>
  resolutionPaths({ D, r: R, prevClose: PREV, marketPrice: PREV, f: 0.008 });

describe("선택지 비교 — 4경로 조립", () => {
  it("고정 순서를 유지한다 (우열 순이 아니다)", () => {
    expect(buildOptions(paths(), PREV).map((o) => o.key)).toEqual([
      "deposit",
      "repay",
      "collateral",
      "voluntary",
    ]);
  });

  it("입금 30만 / 상환 214,286원 — 상환이 28.6% 적다", () => {
    const rows = buildOptions(paths(), PREV);
    const deposit = rows.find((o) => o.key === "deposit")!;
    const repay = rows.find((o) => o.key === "repay")!;
    expect(deposit.amount).toBe(300_000);
    expect(repay.amount).toBe(214_286);
    expect(1 - repay.amount! / deposit.amount!).toBeCloseTo(0.286, 3);
  });

  it("자발적 매도는 96주이고 1차 출력은 금액(777,600원)이다", () => {
    const v = buildOptions(paths(), PREV).find((o) => o.key === "voluntary")!;
    expect(v.qty).toBe(96);
    expect(v.amount).toBe(96 * PREV);
  });

  it("대용 인정비율이 카드에 없으면 추정하지 않고 사유를 남긴다", () => {
    const c = buildOptions(paths(), PREV).find((o) => o.key === "collateral")!;
    expect(c.amount).toBeNull();
    expect(c.unavailable).toMatch(/대용 인정비율/);
  });

  it("대용 인정비율이 주어지면 그때는 산정한다", () => {
    const withAlpha = resolutionPaths({
      D,
      r: R,
      prevClose: PREV,
      marketPrice: PREV,
      f: 0.008,
      substituteRatio: 0.7,
    });
    const c = buildOptions(withAlpha, PREV).find((o) => o.key === "collateral")!;
    expect(c.amount).toBe(Math.ceil(D / 0.7));
    expect(c.unavailable).toBeUndefined();
  });
});

describe("강제 처분 대조", () => {
  const liq = () => liquidationQty({ D, prevClose: PREV, r: R, h: 0.15, held: 1_000 });

  it("195주 · 평가액 기준 1,579,500원", () => {
    const f = forcedDisposal(liq(), PREV);
    expect(f.qty).toBe(195);
    expect(f.amount).toBe(1_579_500);
    expect(f.mode).toBe("PARTIAL");
  });

  it("사전 대응 대비 약 2.03배 — 화면의 결론이 되는 숫자", () => {
    const ratio = forcedToVoluntaryRatio(forcedDisposal(liq(), PREV), buildOptions(paths(), PREV));
    expect(ratio).toBeCloseTo(1_579_500 / 777_600, 6);
    expect(ratio).toBeGreaterThan(2);
  });

  it("하한가형(k≤0)은 전량 처분이고 배수가 훨씬 커진다", () => {
    const full = liquidationQty({ D, prevClose: PREV, r: R, h: 0.3, held: 1_000 });
    const f = forcedDisposal(full, PREV);
    expect(f.mode).toBe("FULL");
    expect(f.reason).toBe("K_NON_POSITIVE");
    expect(f.qty).toBe(1_000);
    const ratio = forcedToVoluntaryRatio(f, buildOptions(paths(), PREV))!;
    expect(ratio).toBeGreaterThan(10); // 8,100,000 / 777,600 ≈ 10.4
  });

  it("자발적 매도가 불가하면 배수를 만들지 않는다", () => {
    // 분모 r·P_m·(1−f) − P_prev ≤ 0 이 되도록 시장가를 낮춘다
    const noSale = resolutionPaths({
      D,
      r: R,
      prevClose: PREV,
      marketPrice: 5_000,
      f: 0.008,
    });
    expect(noSale.voluntarySellQty).toBeNull();
    expect(forcedToVoluntaryRatio(forcedDisposal(liq(), PREV), buildOptions(noSale, PREV))).toBeNull();
  });
});
