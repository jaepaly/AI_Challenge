/**
 * 선택지 비교 조립 테스트 — 골든 계좌 기준.
 * 값 자체는 engine이 만들고 여기서는 **표시 규약**을 고정한다:
 * 1차 출력 금액 / 보조 수량 / 근거 없으면 산정 안 함 / 고정 순서.
 */
import { describe, it, expect } from "vitest";
import { liquidationQty, resolutionPaths } from "@marginguard/engine";
import {
  buildOptions,
  comparisonVerdict,
  forcedDisposal,
  fullDisposalKind,
  fullDisposalLabel,
} from "./options";
import { ASSUMED_FEE_RATE, assumedFeePct } from "./snapshot";

/** 한투 골든: V=810만, L=600만, r=1.4, 전일종가 8,100, h=0.15, 보유 1,000주 */
const D = 300_000;
const PREV = 8_100;
const R = 1.4;
const HELD = 1_000;

const paths = () =>
  resolutionPaths({ D, r: R, prevClose: PREV, marketPrice: PREV, f: 0.008 });

describe("선택지 비교 — 4경로 조립", () => {
  it("고정 순서를 유지한다 (우열 순이 아니다)", () => {
    expect(buildOptions(paths(), PREV, HELD).map((o) => o.key)).toEqual([
      "deposit",
      "repay",
      "collateral",
      "voluntary",
    ]);
  });

  it("입금 30만 / 상환 214,286원 — 상환이 28.6% 적다", () => {
    const rows = buildOptions(paths(), PREV, HELD);
    const deposit = rows.find((o) => o.key === "deposit")!;
    const repay = rows.find((o) => o.key === "repay")!;
    expect(deposit.amount).toBe(300_000);
    expect(repay.amount).toBe(214_286);
    expect(1 - repay.amount! / deposit.amount!).toBeCloseTo(0.286, 3);
  });

  it("자발적 매도는 96주이고 1차 출력은 금액(777,600원)이다", () => {
    const v = buildOptions(paths(), PREV, HELD).find((o) => o.key === "voluntary")!;
    expect(v.qty).toBe(96);
    expect(v.amount).toBe(96 * PREV);
  });

  it("대용 인정비율이 카드에 없으면 추정하지 않고 사유를 남긴다", () => {
    const c = buildOptions(paths(), PREV, HELD).find((o) => o.key === "collateral")!;
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
    const c = buildOptions(withAlpha, PREV, HELD).find((o) => o.key === "collateral")!;
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
    const v = comparisonVerdict(forcedDisposal(liq(), PREV), buildOptions(paths(), PREV, HELD), HELD);
    expect(v.kind).toBe("ratio");
    if (v.kind !== "ratio") return;
    expect(v.ratio).toBeCloseTo(1_579_500 / 777_600, 6);
    expect(v.ratio).toBeGreaterThan(2);
  });

  it("하한가형(k≤0)은 전량 처분이고 배수가 훨씬 커진다 — 캡이 아니라 규정된 결과라 배수가 유효하다", () => {
    const full = liquidationQty({ D, prevClose: PREV, r: R, h: 0.3, held: HELD });
    const f = forcedDisposal(full, PREV);
    expect(f.mode).toBe("FULL");
    expect(f.reason).toBe("K_NON_POSITIVE");
    expect(f.qty).toBe(1_000);
    expect(f.rawQty).toBeNull(); // 잘린 값이 아니다 — 애초에 필요 수량이라는 개념이 없다
    const v = comparisonVerdict(f, buildOptions(paths(), PREV, HELD), HELD);
    expect(v.kind).toBe("ratio");
    if (v.kind !== "ratio") return;
    expect(v.ratio).toBeGreaterThan(10); // 8,100,000 / 777,600 ≈ 10.4
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
    expect(
      comparisonVerdict(forcedDisposal(liq(), PREV), buildOptions(noSale, PREV, HELD), HELD).kind,
    ).toBe("unresolvable");
  });
});

/**
 * 이슈 #19 회귀 — 낙관 방향으로 뒤집히던 구간.
 *
 * 원인: engine.resolutionPaths가 보유수량을 받지 않아 자발적 매도 수량이 캡되지 않고,
 * 강제 처분 수량만 보유에서 캡된다. 캡된 분자 ÷ 캡 안 된 분모라 비가 작게 나온다.
 * 슬라이더를 끝까지 내리는 **가장 자연스러운 동작**에서 나오던 결함이다.
 *
 * 엔진 수정(A) 후에도 이 테스트는 남는다 — 화면이 무엇을 말해야 하는지의 규약이다.
 */
describe("#19 회귀 — 보유수량 캡", () => {
  /** 계좌: 1,000주 · 융자 600만 · r=1.4 · h=0.15. 가격만 움직인다 */
  const at = (price: number) => {
    const d = R * 6_000_000 - HELD * price;
    const p = resolutionPaths({ D: d, r: R, prevClose: price, marketPrice: price, f: 0.008 });
    const forced = forcedDisposal(
      liquidationQty({ D: d, prevClose: price, r: R, h: 0.15, held: HELD }),
      price,
    );
    return { d, rows: buildOptions(p, price, HELD), forced, raw: p.voluntarySellQty };
  };

  it("6,000원: 자발 1,029주 > 보유 1,000주 — 옛 코드는 0.97배를 표시했다", () => {
    const { raw, rows, forced } = at(6_000);
    expect(raw).toBe(1_029); // 엔진 원값은 아직 캡되지 않는다
    expect(forced.qty).toBe(1_000); // 강제만 캡된다 — 이 비대칭이 결함의 정체
    expect(forced.amount / (raw! * 6_000)).toBeLessThan(1); // 0.97 — "안 하는 쪽이 덜 판다"

    const v = rows.find((o) => o.key === "voluntary")!;
    expect(v.amount).toBeNull();
    expect(v.unavailable).toMatch(/전부 팔아도/);
    expect(comparisonVerdict(forced, rows, HELD).kind).toBe("unresolvable");
  });

  it("5,000원: 자발 1,749주 · 옛 코드는 1,000주 계좌에 8,745,000원을 표시했다", () => {
    const { raw, rows } = at(5_000);
    expect(raw).toBe(1_749);
    expect(raw! * 5_000).toBe(8_745_000); // 보유 전량 평가액 500만을 넘는 금액
    expect(rows.find((o) => o.key === "voluntary")!.amount).toBeNull();
  });

  it("6,100원: 뒤집히지 않아도 과소평가다 — 1.03배 대신 사실을 말한다", () => {
    const { rows, forced } = at(6_100);
    expect(forced.mode).toBe("FULL");
    expect(forced.reason).toBe("QTY_EXCEEDED");
    expect(forced.rawQty).toBe(1_985); // 필요 1,985주가 1,000주로 잘렸다 (2,300,000 ÷ 1,159, 올림)
    const v = comparisonVerdict(forced, rows, HELD);
    expect(v.kind).toBe("forced_capped"); // 배수(1.03)를 내지 않는다
    if (v.kind !== "forced_capped") return;
    expect(v.voluntaryQty).toBe(970); // 자발적 매도는 아직 가능
  });

  it("8,100원 골든은 영향을 받지 않는다 — 부분 처분 구간은 그대로", () => {
    const { rows, forced } = at(8_100);
    expect(forced.mode).toBe("PARTIAL");
    expect(forced.qty).toBe(195);
    expect(rows.find((o) => o.key === "voluntary")!.qty).toBe(96);
    expect(comparisonVerdict(forced, rows, HELD).kind).toBe("ratio");
  });
});

/**
 * #21 결선 — 판정 주체를 엔진으로 옮긴 뒤의 규약.
 *
 * 위 "#19 회귀" 블록은 일부러 `held` 없이 호출한다 — 그건 웹 안전망을 시험한다.
 * 여기서는 **랜딩이 실제로 하는 호출**(held 전달)을 시험한다. 이게 없으면
 * #21의 엔진 수정이 잠들어 있다는 사실을 아무도 못 잡는다.
 */
describe("#21 결선 — held를 넘기면 엔진이 판정한다", () => {
  const withHeld = (price: number, marketPrice = price) => {
    const d = R * 6_000_000 - HELD * price;
    return resolutionPaths({
      D: d,
      r: R,
      prevClose: price,
      marketPrice,
      f: ASSUMED_FEE_RATE,
      held: HELD,
    });
  };

  it("6,040원 — 엔진이 QTY_EXCEEDED로 null을 주고, 화면 문구가 그 사유를 따른다", () => {
    const p = withHeld(6_040);
    expect(p.voluntarySellQty).toBeNull();
    expect(p.voluntarySellReason).toBe("QTY_EXCEEDED");

    const v = buildOptions(p, 6_040, HELD).find((o) => o.key === "voluntary")!;
    expect(v.amount).toBeNull();
    expect(v.unavailable).toMatch(/전부 팔아도/);
  });

  it("held 없이 부르면 같은 가격에서 1,005주가 그대로 나온다 — 옵트인이 필요한 이유", () => {
    const d = R * 6_000_000 - HELD * 6_040;
    const noHeld = resolutionPaths({
      D: d,
      r: R,
      prevClose: 6_040,
      marketPrice: 6_040,
      f: ASSUMED_FEE_RATE,
    });
    expect(noHeld.voluntarySellQty).toBe(1_005); // 보유 1,000주를 넘는 불가능한 수량
    expect(noHeld.voluntarySellReason).toBeUndefined();
    // 이 경우에도 화면은 막힌다 — 웹 안전망이 남아 있기 때문
    expect(buildOptions(noHeld, 6_040, HELD).find((o) => o.key === "voluntary")!.amount).toBeNull();
  });

  it("6,050원은 경계 — 정확히 보유수량이라 아직 가능하다", () => {
    const p = withHeld(6_050);
    expect(p.voluntarySellQty).toBe(1_000);
    expect(p.voluntarySellReason).toBeUndefined();
    expect(buildOptions(p, 6_050, HELD).find((o) => o.key === "voluntary")!.qty).toBe(1_000);
  });

  it("분모≤0은 다른 사유이고 다른 문구다 — 두 경우를 섞지 않는다", () => {
    const p = withHeld(8_100, 5_000);
    expect(p.voluntarySellReason).toBe("DENOM_NON_POSITIVE");
    const v = buildOptions(p, 8_100, HELD).find((o) => o.key === "voluntary")!;
    expect(v.unavailable).toMatch(/매도로 비율을 복원할 수 없습니다/);
    expect(v.unavailable).not.toMatch(/전부 팔아도/);
  });
});

describe("출처 표기 규약", () => {
  it("제비용은 '가정'이라고 말한다 — 약관 재현값과 라벨을 공유하지 않는다", () => {
    const v = buildOptions(paths(), PREV, HELD).find((o) => o.key === "voluntary")!;
    expect(v.basis).toContain(`${assumedFeePct}% 가정`);
    expect(v.basis).toMatch(/약관 근거 없는/);
  });

  it("상수와 문구가 갈라지지 않는다 — 퍼센트는 상수에서 뽑는다", () => {
    expect(assumedFeePct).toBe("0.8");
    expect(ASSUMED_FEE_RATE).toBe(0.008);
  });

  /**
   * 처분금액 정의가 두 개라는 지적(#19 P2-1)에 대한 박제.
   * 골든은 **체결가** 기준, 화면은 **평가가(전일종가)** 기준이고 이는 의도된 차이다 —
   * 화면은 미래 체결가를 알 수 없다. 두 값을 섞어 쓰면 여기가 깨진다.
   */
  it("화면 처분금액은 평가가 기준이고, 골든의 체결가 기준과 의도적으로 다르다", () => {
    const liq = liquidationQty({ D, prevClose: PREV, r: R, h: 0.15, held: HELD });
    const screen = forcedDisposal(liq, PREV);

    expect(screen.qty).toBe(195);
    expect(screen.amount).toBe(195 * 8_100); // 1,579,500 — 평가가(전일종가)
    expect(screen.amount).not.toBe(195 * 7_000); // 1,365,000 — 골든의 체결가 기준
    // 수량은 두 정의에서 같다. 체결가는 수량 산정에 관여하지 않는다(세 가격 분리)
    expect(liq.qty).toBe(195);
  });
});

/**
 * 등호 경계 — `rawQty === held`.
 *
 * 엔진은 `rawQty >= held`에서 QTY_EXCEEDED를 내므로 **정확히 같은 경우가 그 안에 섞인다.**
 * 화면이 QTY_EXCEEDED만 보고 문구를 고르면 등호에서 세 문장이 동시에 거짓이 된다 —
 * "필요 수량이 보유 초과" / "보유 전량으로도 모자랍니다" / "전량 처분하고도 부족액이 남습니다".
 * 전량을 팔면 정확히 해소되기 때문이다.
 *
 * 스냅숏에서 도달한다: 메리츠 카드(h=0.20) · 7,500원.
 * 슬라이더 전 구간(5,000~12,000, 10원 단위)을 훑어 이 가격 하나만 등호다.
 */
describe("등호 경계 — 필요 수량이 보유와 정확히 같을 때", () => {
  const P = 7_500;
  const Dm = R * 6_000_000 - HELD * P; // 900,000
  const liqM = () => liquidationQty({ D: Dm, prevClose: P, r: R, h: 0.2, held: HELD });

  it("엔진이 등호에서도 QTY_EXCEEDED를 내고 rawQty가 보유와 같다", () => {
    const l = liqM();
    expect(l.mode).toBe("FULL");
    expect(l.reason).toBe("QTY_EXCEEDED");
    expect(l.rawQty).toBe(HELD); // 초과가 아니라 등호
    expect(l.qty).toBe(HELD);
  });

  it("전량 처분은 세 갈래로 갈린다 — 등호는 'exact'다", () => {
    expect(fullDisposalKind(forcedDisposal(liqM(), P))).toBe("exact");
    expect(fullDisposalLabel(forcedDisposal(liqM(), P))).toBe("전량 — 보유 전량이 정확히 필요");

    // 초과 케이스와 k≤0 케이스는 다른 갈래로 남는다
    // 6,100원의 실제 부족액은 230만원이다 — D를 상수로 넣으면 PARTIAL이 나온다
    const dOver = R * 6_000_000 - HELD * 6_100;
    const over = liquidationQty({ D: dOver, prevClose: 6_100, r: R, h: 0.15, held: HELD });
    expect(fullDisposalKind(forcedDisposal(over, 6_100))).toBe("exceeded");
    const kzero = liquidationQty({ D: 300_000, prevClose: 8_100, r: R, h: 0.3, held: HELD });
    expect(fullDisposalKind(forcedDisposal(kzero, 8_100))).toBe("k_non_positive");
  });

  it("등호에서는 배수를 숨기지 않는다 — 분자가 잘리지 않았으므로 유효하다", () => {
    const p = resolutionPaths({
      D: Dm,
      r: R,
      prevClose: P,
      marketPrice: P,
      f: ASSUMED_FEE_RATE,
      held: HELD,
    });
    const rows = buildOptions(p, P, HELD);
    expect(rows.find((o) => o.key === "voluntary")!.qty).toBe(309);

    const v = comparisonVerdict(forcedDisposal(liqM(), P), rows, HELD);
    expect(v.kind).toBe("ratio"); // 옛 코드는 forced_capped로 배수를 죽였다
    if (v.kind !== "ratio") return;
    expect(v.ratio).toBeCloseTo((HELD * P) / (309 * P), 10); // 약 3.24배
    expect(v.ratio).toBeGreaterThan(3);
  });

  it("실제로 잘린 경우(6,100원)는 여전히 배수를 죽인다 — 회귀 방지", () => {
    const d = R * 6_000_000 - HELD * 6_100;
    const p = resolutionPaths({
      D: d,
      r: R,
      prevClose: 6_100,
      marketPrice: 6_100,
      f: ASSUMED_FEE_RATE,
      held: HELD,
    });
    const forced = forcedDisposal(
      liquidationQty({ D: d, prevClose: 6_100, r: R, h: 0.15, held: HELD }),
      6_100,
    );
    expect(forced.rawQty).toBe(1_985); // 보유보다 크다 — 진짜 캡
    expect(comparisonVerdict(forced, buildOptions(p, 6_100, HELD), HELD).kind).toBe("forced_capped");
  });
});
