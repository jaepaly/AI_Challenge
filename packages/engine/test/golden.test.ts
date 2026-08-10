/**
 * 골든 테스트 — 한국투자증권 신용거래 설명서 공식 예시 + 타사 교차검증.
 * 이 파일의 기대값은 증권사 공개 자료에서 나온 "정답지"다.
 * 실패하면 코드를 고치는 것이지, 기대값을 고치는 게 아니다.
 * (기대값 변경은 원문 출처 첨부 + A 포함 2인 승인 필수)
 */
import { describe, it, expect } from "vitest";
import {
  shortfall,
  restorationCoefficient,
  liquidationQty,
  disposalAmount,
  residualDebt,
  marginRatioPct,
  resolutionPaths,
  equalShockLambda,
  leveragedEntryLambda,
} from "../src/index";

describe("골든 — 한국투자 공식 설명서", () => {
  it("case2: V 810만·L 600만 → D 30만 / 195주 / 처분 136.5만 / 배수 4.55", () => {
    const D = shortfall(8_100_000, 6_000_000, 1.4);
    expect(D).toBe(300_000);

    const liq = liquidationQty({ D, prevClose: 8_100, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.mode).toBe("PARTIAL");
    expect(liq.qty).toBe(195);
    expect(liq.k).toBe(0.19);

    // 체결가 7,000원은 설명서의 가정치 — 처분금액 계산에만 쓰이고 수량 산정엔 미관여
    const amount = disposalAmount(liq.qty, 7_000);
    expect(amount).toBe(1_365_000);
    expect(amount / D).toBeCloseTo(4.55, 2);
  });

  it("case1: V 615만 → n_raw 1,926 > 보유 1,000 → 전량 / 잔여채무 70만 / 총손실 470만", () => {
    const D = shortfall(6_150_000, 6_000_000, 1.4);
    expect(D).toBe(2_250_000);

    const liq = liquidationQty({ D, prevClose: 6_150, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.mode).toBe("FULL");
    expect(liq.reason).toBe("QTY_EXCEEDED");
    expect(liq.rawQty).toBe(1_926);
    expect(liq.qty).toBe(1_000);

    // 체결가 5,300원은 설명서의 가정치
    const debt = residualDebt(6_000_000, disposalAmount(1_000, 5_300));
    expect(debt).toBe(700_000);
    // 총손실 = 초기 자기자본 400만(진입 시 V=1,000만, L=600만) 전손 + 잔여채무
    expect(4_000_000 + debt).toBe(4_700_000);
  });

  it("담보비율 시리즈: 167 / 142 / 138 / 121 / 103 % (120.5→121, 102.5→103 사사오입 포함)", () => {
    const L = 6_000_000;
    const series = [10_000_000, 8_500_000, 8_300_000, 7_230_000, 6_150_000];
    expect(series.map((V) => marginRatioPct(V, L))).toEqual([167, 142, 138, 121, 103]);
  });
});

describe("골든 — 삼성 공식 설명서 (다른 계좌 구조 · 정수 스케일 가드)", () => {
  // 투자원금 450만 · 융자 550만 · 1,000주 @10,000원 · r=1.4, D+1일 종가 6,500원
  const V = 6_500_000;
  const L = 5_500_000;

  it("정수 스케일 회귀 가드: 1.4×5,500,000을 float로 곱하면 D가 과소(=낙관) 산정된다", () => {
    // 기존 골든 6건은 전부 L=6,000,000이고 1.4×6e6은 오차가 0이라 이 경로를 못 잡았다.
    expect(6_000_000 * 1.4).toBe(8_400_000); // 우연히 정확 — 그래서 무력했다
    expect(5_500_000 * 1.4).not.toBe(7_700_000); // 7,699,999.999999999

    const naive = Math.max(0, L * 1.4 - V); // 1,199,999.999999999
    expect(Number.isInteger(naive)).toBe(false);
    expect(naive).toBeLessThan(1_200_000); // 과소 = 처분 수량 과소 = 낙관 방향

    expect(shortfall(V, L, 1.4)).toBe(1_200_000); // 정수 스케일은 정확
  });

  it("h=0.15(기준가 5,525원) → 972주 부분 처분 / 처분 661만 / 배수 5.5", () => {
    const D = shortfall(V, L, 1.4);
    expect(D).toBe(1_200_000);
    expect(6_500 * 0.85).toBe(5_525); // 원문의 "반대매매 기준가격"

    const liq = liquidationQty({ D, prevClose: 6_500, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.mode).toBe("PARTIAL");
    expect(liq.qty).toBe(972); // 원문 "972"
    expect(liq.k).toBe(0.19);

    // 체결가 6,800원은 설명서의 가정치 — 수량 산정엔 미관여
    const amount = disposalAmount(liq.qty, 6_800);
    expect(amount).toBe(6_609_600); // 원문 "약 661만원"
    expect(amount / D).toBeCloseTo(5.508, 3); // 원문 "5.5배"
  });

  it("h=0.20(기준가 5,200원) → 필요 1,539주 > 보유 → 전량. 같은 계좌에서 h만 바뀌어 체제가 전환된다", () => {
    const D = shortfall(V, L, 1.4);
    expect(6_500 * 0.8).toBe(5_200);

    const liq = liquidationQty({ D, prevClose: 6_500, r: 1.4, h: 0.2, held: 1_000 });
    expect(liq.mode).toBe("FULL"); // 원문 "1,000주 모두 반대매매 필요"
    expect(liq.reason).toBe("QTY_EXCEEDED");
    expect(liq.qty).toBe(1_000);
    expect(liq.rawQty).toBe(1_539); // 원문에 없는 엔진 파생값
    expect(liq.k).toBe(0.12);

    expect(disposalAmount(1_000, 6_800)).toBe(6_800_000); // 원문 "680만원"
    // 손실 320만원 = 투자원금 450만 − (처분 680만 − 융자 550만). 원문 "원금의 71%"
    expect(4_500_000 - (6_800_000 - L)).toBe(3_200_000);
  });

  it("담보비율 시리즈: 182 / 131 / 118 % (사사오입 계층 — 삼성 p.11은 같은 값을 181%로 내림 표기)", () => {
    expect([10_000_000, 7_230_000, 6_500_000].map((v) => marginRatioPct(v, L))).toEqual([
      182, 131, 118,
    ]);
  });
});

describe("교차검증 — 산정 기준가(h)의 회사별 편차", () => {
  it("메리츠형 h=0.20 → k=0.12 → 309주 (같은 계좌가 회사만 다르면 195→309주)", () => {
    const liq = liquidationQty({ D: 300_000, prevClose: 8_100, r: 1.4, h: 0.2, held: 1_000 });
    expect(liq.mode).toBe("PARTIAL");
    expect(liq.qty).toBe(309);
    expect(liq.k).toBe(0.12);
  });

  it("하한가형 h=0.30 → k=−0.02 ≤ 0 → 부분 매도로 복원 불가, 전량 처분 폴백", () => {
    expect(restorationCoefficient(1.4, 0.3)).toBe(-0.02);
    const liq = liquidationQty({ D: 300_000, prevClose: 8_100, r: 1.4, h: 0.3, held: 1_000 });
    expect(liq.mode).toBe("FULL");
    expect(liq.reason).toBe("K_NON_POSITIVE");
    expect(liq.qty).toBe(1_000);
  });

  it("회귀 방지: k에 제비용 f를 섞으면 195주가 206주로 깨진다 — 과거 오류의 기록", () => {
    // 틀린 식 k' = r(1−h)(1−f) − 1 → 206주. f는 미수·자발매도 산식 전용이다.
    const wrongK = 1.4 * (1 - 0.15) * (1 - 0.008) - 1;
    expect(Math.ceil(300_000 / (8_100 * wrongK))).toBe(206);
    // 올바른 식은 195주
    const liq = liquidationQty({ D: 300_000, prevClose: 8_100, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.qty).toBe(195);
  });
});

describe("해소 4경로", () => {
  it("같은 D=30만: 입금 30만 / 상환 21.5만(−28.6%) / 자발 매도 96주", () => {
    const p = resolutionPaths({
      D: 300_000,
      r: 1.4,
      prevClose: 8_100,
      marketPrice: 8_100,
      f: 0.008,
    });
    expect(p.deposit).toBe(300_000);
    expect(p.repay).toBe(214_286); // ceil(300,000 / 1.4)
    expect(p.voluntarySellQty).toBe(96); // 강제 195주 대비 절반 — 사전 대응의 가격
    expect(p.collateral).toBeNull(); // α 미지정
    expect(p.voluntarySellReason).toBeUndefined();
  });

  it("held를 주면 도달 가능한 구간의 답은 그대로다 (96주 ≤ 보유 1,000주)", () => {
    const p = resolutionPaths({
      D: 300_000,
      r: 1.4,
      prevClose: 8_100,
      marketPrice: 8_100,
      f: 0.008,
      held: 1_000,
    });
    expect(p.voluntarySellQty).toBe(96);
    expect(p.voluntarySellReason).toBeUndefined();
  });

  it("전량을 팔아도 해소 안 되는 구간은 캡이 아니라 null — 캡하면 '덜 팔아도 된다'는 낙관이 된다", () => {
    // 주가 6,000원: D=240만, 필요 1,029주 > 보유 1,000주 (임계 6,048.4원)
    const D = shortfall(6_000_000, 6_000_000, 1.4);
    expect(D).toBe(2_400_000);

    const uncapped = resolutionPaths({
      D,
      r: 1.4,
      prevClose: 6_000,
      marketPrice: 6_000,
      f: 0.008,
    });
    expect(uncapped.voluntarySellQty).toBe(1_029); // held 미지정 = 구 동작

    const p = resolutionPaths({
      D,
      r: 1.4,
      prevClose: 6_000,
      marketPrice: 6_000,
      f: 0.008,
      held: 1_000,
    });
    expect(p.voluntarySellQty).toBeNull();
    expect(p.voluntarySellReason).toBe("QTY_EXCEEDED");
    // 실제로 전량을 팔아도 부족액이 남는다: 매도대금 1,000×6,000×0.992로 상환해도
    expect(shortfall(0, residualDebt(6_000_000, Math.floor(1_000 * 6_000 * 0.992)), 1.4)).toBe(
      67_200,
    );
    // 입금·상환은 여전히 유효한 경로다 — 4경로 전부를 죽이지 않는다
    expect(p.deposit).toBe(2_400_000);
    expect(p.repay).toBe(1_714_286);
  });

  it("경계 6,050원은 도달 가능(1,000주), 6,040원은 불가 — 임계 6,048.4원을 박제", () => {
    const at = (price: number) =>
      resolutionPaths({
        D: shortfall(1_000 * price, 6_000_000, 1.4),
        r: 1.4,
        prevClose: price,
        marketPrice: price,
        f: 0.008,
        held: 1_000,
      });
    expect(at(6_050).voluntarySellQty).toBe(1_000);
    expect(at(6_040).voluntarySellQty).toBeNull();
    expect(at(6_040).voluntarySellReason).toBe("QTY_EXCEEDED");
  });

  it("분모≤0이면 DENOM_NON_POSITIVE — 매도해도 비율이 오르지 않는다", () => {
    const p = resolutionPaths({
      D: 300_000,
      r: 1.0, // r·P_m(1−f) − P_prev = 8,100×0.992 − 8,100 < 0
      prevClose: 8_100,
      marketPrice: 8_100,
      f: 0.008,
      held: 1_000,
    });
    expect(p.voluntarySellQty).toBeNull();
    expect(p.voluntarySellReason).toBe("DENOM_NON_POSITIVE");
  });
});

describe("한계선 (진입 전 / 보유 중)", () => {
  it("진입 전 λ* = 1 − r(1−g): g 40/45/50% → 16/23/30% 하락까지 생존", () => {
    expect(leveragedEntryLambda(0.4)).toBeCloseTo(0.16, 10);
    expect(leveragedEntryLambda(0.45)).toBeCloseTo(0.23, 10);
    expect(leveragedEntryLambda(0.5)).toBeCloseTo(0.3, 10);
  });

  it("균등충격 λ*: V 1,000만·L 600만 → 16% (g=40% 진입과 교차 일치)", () => {
    expect(equalShockLambda(10_000_000, 6_000_000, 1.4)).toBeCloseTo(0.16, 10);
  });

  it("버퍼 소진(B≤0) 계좌는 λ*=0 — 골든 계좌 V 810만은 이미 관통 상태", () => {
    expect(equalShockLambda(8_100_000, 6_000_000, 1.4)).toBe(0);
  });
});
